import { httpError } from './integrations/settings.js'

const CHAT_URL = () => process.env.AI_BASE_URL || 'https://ai.rokeshcloud.com/v1/assistant/chat'

const OPEN = new Set(['new', 'contacted', 'interested', 'store_visit', 'negotiation'])
const STAGE_WEIGHT = { contacted: 6, interested: 16, store_visit: 26, negotiation: 34 }
const DAY = 86_400_000

function stamp(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function istDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function temperature(lead, now) {
  let score = 20 + (STAGE_WEIGHT[lead.stage] || 0)
  const activities = lead.activities || []
  score += Math.min(2, activities.filter((item) => item.key === 'act.priceAsked').length) * 8
  if (activities.some((item) => item.key === 'act.visitedStore')) score += 10
  if ((lead.quantity || 0) >= 3) score += 8
  if ((lead.tags || []).includes('urgent')) score += 8
  if (lead.source === 'walk_in') score += 4
  if (lead.lastContactedAt) {
    const days = (now - Date.parse(lead.lastContactedAt)) / DAY
    if (days <= 2) score += 8
    else if (days >= 4) score -= Math.min(25, Math.round((days - 3) * 5))
  } else if (now - Date.parse(lead.createdAt) > 3_600_000) score -= 6
  if (lead.nextFollowUpAt && now - Date.parse(lead.nextFollowUpAt) > DAY) score -= 6
  score = Math.max(0, Math.min(100, score))
  if (score >= 65) return 'hot'
  if (score >= 40) return 'warm'
  return 'cold'
}

function followStatus(lead, now) {
  if (!OPEN.has(lead.stage) || !lead.nextFollowUpAt) return 'none'
  const due = Date.parse(lead.nextFollowUpAt)
  if (Number.isNaN(due)) return 'none'
  if (due < now) return 'overdue'
  return istDay(due) === istDay(now) ? 'today' : 'upcoming'
}

function leadLines(leads, users, products, now) {
  const weekAgo = now - 7 * DAY
  const open = leads.filter((lead) => OPEN.has(lead.stage))
  const lines = open
    .slice(0, 120)
    .map((lead) => {
      const product = (lead.productInterest || []).map((id) => products.get(id)).find(Boolean) || ''
      const created = Date.parse(lead.createdAt)
      return [
        lead.id,
        lead.name,
        lead.stage,
        lead.phone || '',
        lead.source || '',
        users.get(lead.assignedTo) || 'unassigned',
        temperature(lead, now),
        followStatus(lead, now),
        stamp(lead.nextFollowUpAt) || 'no follow-up',
        lead.firstContactedAt ? 'contacted' : 'untouched',
        Number.isFinite(created) && created >= weekAgo ? 'created-this-week' : 'older',
        product,
      ].join(' | ')
    })
    .join('\n')
  const extra = open.length > 120 ? `\n${open.length - 120} more open leads are not listed. The counts above include them.` : ''
  return (lines || 'No open leads.') + extra
}

/** Owner sees the whole shop. Staff see their own leads and the unassigned queue. */
function visible(body) {
  const role = body.viewerRole === 'owner' ? 'owner' : 'staff'
  const viewerId = String(body.viewerId || '')
  let leads = (Array.isArray(body.leads) ? body.leads : []).filter((lead) => lead && lead.id && lead.name)
  if (role !== 'owner') {
    leads = leads.filter((lead) => lead.assignedTo === viewerId || lead.assignedTo == null)
  }
  const leadIds = new Set(leads.map((lead) => lead.id))
  let customers = (Array.isArray(body.customers) ? body.customers : []).filter(
    (customer) => customer && customer.name,
  )
  if (role !== 'owner') {
    customers = customers.filter((customer) => customer.leadId && leadIds.has(customer.leadId))
  }
  return {
    role,
    viewerId,
    leads,
    customers,
    users: Array.isArray(body.users) ? body.users : [],
    products: Array.isArray(body.products) ? body.products : [],
  }
}

function startOfDayIST(t) {
  const offset = 5.5 * 3_600_000
  return Math.floor((t + offset) / DAY) * DAY - offset
}

function collectSales(leads, customers) {
  const byLead = new Map(leads.map((lead) => [lead.id, lead]))
  const sales = []
  for (const customer of customers) {
    const lead = customer.leadId ? byLead.get(customer.leadId) : undefined
    for (const purchase of customer.purchases || []) {
      const at = Date.parse(purchase.date)
      if (!Number.isFinite(at)) continue
      const items = Array.isArray(purchase.items) ? purchase.items : []
      sales.push({
        at,
        total: Number(purchase.total) || 0,
        units: items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
        staffId: lead?.assignedTo || '',
        source: lead?.source || '',
        customerName: customer.name,
        invoiceNo: purchase.invoiceNo || '',
        items,
      })
    }
  }
  return sales
}

function bump(map, key, revenue, count = 1) {
  const current = map.get(key) ?? { revenue: 0, count: 0 }
  current.revenue += revenue
  current.count += count
  map.set(key, current)
}

function ranked(map, labelOf, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, value]) => `${labelOf(key)} | ${money(value.revenue)} | ${value.count}`)
    .join('\n')
}

function windowSales(sales, days, now) {
  if (days == null) return sales
  const from = startOfDayIST(now) - (days - 1) * DAY
  return sales.filter((sale) => sale.at >= from && sale.at <= now)
}

function salesReport(sales, users, products) {
  const staff = new Map()
  const sources = new Map()
  const sold = new Map()
  const categories = new Map()
  const buyers = new Map()
  const categoryOf = new Map(products.map((product) => [product.id, product.category || '']))
  let units = 0
  for (const sale of sales) {
    units += sale.units
    bump(staff, sale.staffId || 'unassigned', sale.total)
    if (sale.source) bump(sources, sale.source, sale.total)
    bump(buyers, sale.customerName, sale.total)
    for (const item of sale.items) {
      const qty = Number(item.qty) || 0
      const revenue = qty * (Number(item.unitPrice) || 0) || Number(item.revenue) || 0
      bump(sold, item.name || 'item', revenue, qty)
      const category = categoryOf.get(item.productId)
      if (category) bump(categories, category, revenue, qty)
    }
  }
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0)
  const staffName = (id) => (id === 'unassigned' ? 'unassigned' : users.get(id) || id)
  return [
    `total ${money(revenue)} | ${sales.length} orders | ${units} units | ${buyers.size} buyers`,
    'By staff. Columns: name | revenue | orders',
    ranked(staff, staffName, 20) || 'none',
    'By source. Columns: source | revenue | orders',
    ranked(sources, (key) => key, 10) || 'none',
    'By product. Columns: name | revenue | units',
    ranked(sold, (key) => key, 8) || 'none',
    'By category. Columns: category | revenue | units',
    ranked(categories, (key) => key, 16) || 'none',
    'Top customers. Columns: name | revenue | orders',
    ranked(buyers, (key) => key, 8) || 'none',
  ].join('\n')
}

function money(value) {
  const amount = Number(value) || 0
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

function salesHeadline(sales, users) {
  const byStaff = new Map()
  for (const sale of sales) {
    const id = sale.staffId || 'unassigned'
    const current = byStaff.get(id) ?? { revenue: 0, orders: 0 }
    current.revenue += sale.total
    current.orders += 1
    byStaff.set(id, current)
  }
  const ranked = [...byStaff.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
  const total = sales.reduce((sum, sale) => sum + sale.total, 0)
  if (!ranked.length) return `Last 30 days sales: ${money(0)} from 0 orders.`
  const nameOf = (id) => (id === 'unassigned' ? 'unassigned' : users.get(id) || id)
  const [topId, top] = ranked[0]
  const list = ranked
    .slice(0, 8)
    .map(([id, value]) => `${nameOf(id)} ${money(value.revenue)} (${value.orders} orders)`)
    .join('; ')
  return `Last 30 days sales: ${money(total)} from ${sales.length} orders. Highest: ${nameOf(topId)}, ${money(top.revenue)}, ${top.orders} orders. Staff ranking: ${list}.`
}

function snapshot(body, now) {
  const view = visible(body)
  const { leads, customers, products } = view
  const users = new Map(view.users.map((user) => [user.id, user.name]))
  const productNames = new Map(products.map((product) => [product.id, product.name]))
  const open = leads.filter((lead) => OPEN.has(lead.stage))
  const overdue = open.filter((lead) => followStatus(lead, now) === 'overdue')
  const hot = open.filter((lead) => temperature(lead, now) === 'hot')
  const untouched = open.filter((lead) => !lead.firstContactedAt)
  const unassigned = open.filter((lead) => !lead.assignedTo)
  const weekAgo = now - 7 * DAY
  const websiteWeek = leads.filter(
    (lead) => lead.source === 'website' && Date.parse(lead.createdAt) >= weekAgo,
  )
  const sales = collectSales(leads, customers)
  const sales30 = windowSales(sales, 30, now)
  const people = view.role === 'owner' ? view.users : view.users.filter((user) => user.id === view.viewerId)
  const team = people
    .map((user) => {
      const mine = open.filter((lead) => lead.assignedTo === user.id)
      const late = mine.filter((lead) => followStatus(lead, now) === 'overdue').length
      const won = leads.filter((lead) => lead.stage === 'won' && lead.assignedTo === user.id).length
      const lost = leads.filter((lead) => lead.stage === 'lost' && lead.assignedTo === user.id).length
      const ownSales = sales30.filter((sale) => sale.staffId === user.id)
      const revenue = ownSales.reduce((sum, sale) => sum + sale.total, 0)
      return `${user.name} | ${user.role} | open ${mine.length} | overdue ${late} | won ${won} | lost ${lost} | last 30 days ${money(revenue)} from ${ownSales.length} orders`
    })
    .join('\n')
  const stages = ['new', 'contacted', 'interested', 'store_visit', 'negotiation', 'won', 'lost']
    .map((stage) => `${stage} ${leads.filter((lead) => lead.stage === stage).length}`)
    .join(', ')
  const won = leads
    .filter((lead) => lead.stage === 'won')
    .slice(0, 30)
    .map((lead) => `${lead.id} | ${lead.name} | ${users.get(lead.assignedTo) || 'unassigned'} | ${productNames.get(lead.productInterest?.[0]) || ''}`)
    .join('\n')
  const lost = leads
    .filter((lead) => lead.stage === 'lost')
    .slice(0, 30)
    .map((lead) => `${lead.id} | ${lead.name} | ${lead.lostReason || ''} | ${users.get(lead.assignedTo) || 'unassigned'}`)
    .join('\n')
  const customerLines = [...customers]
    .sort((a, b) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0))
    .slice(0, 20)
    .map((customer) => {
      const orders = customer.purchases || []
      const last = orders[orders.length - 1]
      return `${customer.name} | ${customer.city || ''} | ${orders.length} orders | ${money(customer.totalSpent)} | ${last?.invoiceNo || 'no invoice'}`
    })
    .join('\n')
  const stock = products
    .filter((product) => product && (product.stockQty <= 3 || product.stockStatus !== 'in_stock'))
    .slice(0, 40)
    .map((product) => `${product.name} | qty ${product.stockQty} | ${product.stockStatus} | ${money(product.sellingPrice)}`)
    .join('\n')
  const catalog = products
    .slice(0, 250)
    .map((product) => `${product.name} | ${product.category || ''} | ${money(product.sellingPrice)} | qty ${product.stockQty} | ${product.stockStatus}`)
    .join('\n')
  const periods = [
    ['Last 7 days', 7],
    ['Last 30 days', 30],
    ['Last 90 days', 90],
    ['All time', null],
  ]
    .map(([label, days]) => `## ${label}\n${salesReport(windowSales(sales, days, now), users, products)}`)
    .join('\n\n')
  const invoices = [...sales]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map((sale) => `${stamp(sale.at)} | ${sale.invoiceNo} | ${sale.customerName} | ${users.get(sale.staffId) || 'unassigned'} | ${money(sale.total)}`)
    .join('\n')
  return [
    salesHeadline(sales30, users),
    `Pipeline: ${stages}.`,
    `Counts: open ${open.length}, overdue ${overdue.length}, hot ${hot.length}, untouched ${untouched.length}, unassigned ${unassigned.length}, website this week ${websiteWeek.length}.`,
    'Sales. These are the CRM invoice totals, matching Reports. A sale belongs to the staff member who owned that customer\'s lead.',
    periods,
    'Team the viewer may see. Columns: name | role | open | overdue | won | lost | last 30 days sales',
    team || 'No team.',
    'Latest invoices. Columns: time | invoice | customer | staff | total',
    invoices || 'None.',
    'Top customers the viewer may see. Columns: name | city | orders | spent | last invoice',
    customerLines || 'None.',
    'Open leads. Columns: id | name | stage | phone | source | assignee | temperature | follow-up status | follow-up time | contact | age | product',
    leadLines(leads, users, productNames, now),
    'Won leads. Columns: id | name | staff | product',
    won || 'None.',
    'Lost leads. Columns: id | name | reason | staff',
    lost || 'None.',
    'Low or out-of-stock products. Columns: name | qty | status | price',
    stock || 'None.',
    'Product catalog. Columns: name | category | price | qty | status',
    catalog || 'No products.',
    products.length > 250 ? `${products.length - 250} more products are not listed.` : '',
  ].filter(Boolean).join('\n')
}

function systemPrompt(body) {
  const now = Number(body.now) || Date.now()
  const lang = body.lang === 'ta' ? 'Reply in spoken Tamil.' : 'Reply in English.'
  const view = visible(body)
  const who = body.viewerName ? `${body.viewerName} is` : 'The person asking is'
  const access = view.role === 'owner'
    ? `${who} the owner. This snapshot is the whole shop they can see.`
    : `${who} staff. This snapshot includes only their own leads, the unassigned queue, and sales from those customers. Other people's sales are not in it.`
  const prompt = [
    'You are the assistant inside the Anita Enterprises CRM, a Salem shop that sells printers, speakers, and computers.',
    'Answer only from the snapshot below. It is already limited to what this person is allowed to see.',
    access,
    lang,
    `Now is ${stamp(now)} IST. The response-time target is ${Number(body.slaMinutes) || 15} minutes.`,
    'A lead moves through new, contacted, interested, store visit, and negotiation, then won or lost. Hot, warm, and cold come from the temperature column. A follow-up is overdue when its status is overdue. Untouched means nobody has contacted them yet. Unassigned means no staff member owns the lead. Sources include phone, WhatsApp, walk-in, website, and IndiaMART.',
    'The snapshot starts with the last 30 days sales ranking. Use that line for who sold the most. When no period is named, use last 30 days and say that period. Last week means Last 7 days. Last quarter means Last 90 days. Overall or all time means All time.',
    'When you mention a lead, write it as [[lead:ID|Name]]. List the matching leads, not only a count.',
    'Do not say the figures are missing when they are in this snapshot. Do not invent people, invoices, or stock.',
    snapshot(body, now),
    'Use what this person has already said, including earlier messages. Keep any person, product, city, or time period they named. Do not ask for it again.',
    'If their latest message answers your previous question, or corrects it, answer from that. Do not repeat the old answer.',
    'If one detail is still missing, or several people or products match their words, ask one short question about that detail only. Do not offer an unrelated menu.',
    'Answer only the part they asked about, in a few sentences. Do not dump the whole snapshot.',
    'When the answer is clear, add one next question they are likely to ask, written only as [[ask:question]] in the same language as the reply. Do not also write that question in the answer. It must continue the same subject. Leave [[ask]] out when you are still clarifying.',
  ].join('\n')
  return prompt
}

function messagesFrom(body) {
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .slice(-8)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) }))
  const question = String(body.question || '').trim().slice(0, 2000)
  if (!question) throw httpError(400, 'Ask a question first.', 'empty')
  return [{ role: 'system', content: systemPrompt(body) }, ...history, { role: 'user', content: question }]
}

/** Calls Rokesh Cloud. The server key never leaves this process. */
export async function answerCrm(body) {
  const key = process.env.SERVER_KEY
  if (!key) throw httpError(503, 'The assistant key is not set on the server.', 'no_key')
  let response
  try {
    response = await fetch(CHAT_URL(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: messagesFrom(body) }),
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    throw httpError(502, 'The assistant did not answer. Try again in a moment.', 'ai_down')
  }
  const payload = await response.json().catch(() => null)
  const reply = payload?.choices?.[0]?.message?.content
  if (!response.ok || typeof reply !== 'string' || !reply.trim()) {
    const message = payload?.error?.message || payload?.message || 'The assistant did not answer.'
    throw httpError(response.ok ? 502 : response.status, message, 'ai')
  }
  const leadIds = [...reply.matchAll(/\[\[lead:([^|\]]+)\|/g)].map((match) => match[1])
  const suggestions = [...reply.matchAll(/\[\[ask:([^\]]+)\]\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 2)
  const text = reply.replace(/\s*\[\[ask:[^\]]+\]\]/g, '').trim()
  return { reply: text, leadIds, suggestions }
}
