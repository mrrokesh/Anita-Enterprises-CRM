import { useState } from 'react'
import { useCurrentUser, useScopedLeads } from '@/features/auth/useCurrentUser'
import { useScopedCustomers } from '@/features/customers/useCustomers'
import { ApiError } from '@/services/api'
import { ask } from '@/services/ai'
import { useClockStore } from '@/store/clockStore'
import { useCrmStore } from '@/store/crmStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useLang } from './useLeadCtx'

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export function useChat() {
  const leads = useScopedLeads()
  const user = useCurrentUser()
  const { users, products } = useCrmStore()
  const customers = useScopedCustomers()
  const slaMinutes = useSettingsStore((s) => s.slaMinutes)
  const lang = useLang()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || busy || !user) return
    const history = msgs.map((msg) => ({ role: msg.role, content: msg.text }))
    setMsgs((m) => [...m, { id: m.length, role: 'user', text: q }])
    setBusy(true)
    try {
      const { output } = await ask({
        task: 'chatWithCRM',
        input: {
          question: q,
          history,
          leads,
          users,
          products,
          customers,
          viewerName: user.name,
          viewerRole: user.role,
          viewerId: user.id,
          now: useClockStore.getState().now,
          lang,
          slaMinutes,
        },
      })
      setMsgs((m) => [...m, { id: m.length, role: 'assistant', text: output.reply }])
      setSuggestions(output.suggestions ?? [])
    } catch (error) {
      const text = error instanceof ApiError ? error.message : 'The assistant did not answer.'
      setMsgs((m) => [...m, { id: m.length, role: 'assistant', text }])
    } finally {
      setBusy(false)
    }
  }
  return { msgs, suggestions, busy, send }
}
