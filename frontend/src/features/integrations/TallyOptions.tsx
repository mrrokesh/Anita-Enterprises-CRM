import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  ApiError,
  integrationsApi,
  type IntegrationStatus,
  type TallyImportResult,
  type TallyMode,
} from '@/services/api'
import { useCrmStore } from '@/store/crmStore'
import { toast } from '@/store/toastStore'

type Busy = 'mode' | 'save' | 'file' | 'test' | 'sync' | 'post' | null

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  })
}

export function TallyOptions({
  status,
  onStatus,
}: {
  status: IntegrationStatus | null
  onStatus: (next: IntegrationStatus) => void
}) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<TallyMode>('file')
  const [url, setUrl] = useState('http://127.0.0.1:9000')
  const [company, setCompany] = useState('')
  const [sales, setSales] = useState('Sales')
  const [daily, setDaily] = useState(false)
  const [pushDaily, setPushDaily] = useState(false)
  const [voucherType, setVoucherType] = useState('Sales')
  const [gstLedger, setGstLedger] = useState('')
  const [gstRate, setGstRate] = useState('0')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<Busy>(null)

  useEffect(() => {
    if (!status) return
    setMode(status.tallyMode)
    setUrl(status.tallyUrl)
    setCompany(status.tallyCompany)
    setSales(status.tallySalesLedger)
    setDaily(status.tallySchedule === 'daily')
    setPushDaily(status.tallyPushDaily)
    setVoucherType(status.tallyVoucherType)
    setGstLedger(status.tallyGstLedger)
    setGstRate(String(status.tallyGstRate || 0))
  }, [status])

  const payload = (nextMode = mode, nextDaily = daily, nextPush = pushDaily) => ({
    tallyUrl: url,
    tallyCompany: company,
    tallySalesLedger: sales || 'Sales',
    tallyMode: nextMode,
    tallySchedule: nextDaily ? ('daily' as const) : ('off' as const),
    tallyPushDaily: nextPush,
    tallyVoucherType: voucherType || 'Sales',
    tallyGstLedger: gstLedger,
    tallyGstRate: Number(gstRate) || 0,
  })

  const run = async (kind: Busy, task: () => Promise<void>) => {
    setBusy(kind)
    try {
      await task()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
    } finally {
      setBusy(null)
    }
  }

  const refreshBooks = async (result: TallyImportResult, title: string) => {
    await useCrmStore.getState().refresh()
    onStatus(await integrationsApi.status())
    toast.success(
      title,
      result.unmatched.length
        ? t('settings.integrations.unmatched', { names: result.unmatched.join(', ') })
        : result.errors?.[0],
    )
  }

  const modes: { id: TallyMode; title: string; text: string }[] = [
    { id: 'file', title: t('settings.integrations.modeFile'), text: t('settings.integrations.modeFileText') },
    { id: 'one-way', title: t('settings.integrations.modeOne'), text: t('settings.integrations.modeOneText') },
    { id: 'two-way', title: t('settings.integrations.modeTwo'), text: t('settings.integrations.modeTwoText') },
  ]

  const live = mode !== 'file'

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <p className="text-sm font-medium">{t('settings.integrations.tallyChoose')}</p>
      <div className="grid gap-2 lg:grid-cols-3">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('mode', async () => {
                await integrationsApi.save(payload(item.id))
                onStatus(await integrationsApi.status())
              })
            }
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              mode === item.id ? 'border-brand-600 bg-brand-600/5' : 'border-border hover:bg-surface-2',
            )}
          >
            <span className="text-sm font-semibold">{item.title}</span>
            <span className="mt-1 block text-xs text-fg-muted">{item.text}</span>
          </button>
        ))}
      </div>

      {mode === 'file' && (
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">{t('settings.integrations.fileHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.xls,.xlsx,.csv"
            className="hidden"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => fileRef.current?.click()}>{t('settings.integrations.chooseFile')}</Button>
            {fileName && <span className="text-xs text-fg-muted">{fileName}</span>}
            <Button
              variant="primary"
              loading={busy === 'file'}
              disabled={!fileName}
              onClick={() =>
                void run('file', async () => {
                  const file = fileRef.current?.files?.[0]
                  if (!file) return
                  const result = await integrationsApi.importTallyFile(file.name, await fileToBase64(file))
                  await refreshBooks(
                    result,
                    t('settings.integrations.loaded', {
                      invoices: result.invoices,
                      stock: result.stockUpdated,
                      customers: result.customers,
                    }),
                  )
                })
              }
            >
              {t('settings.integrations.loadFile')}
            </Button>
          </div>
        </div>
      )}

      {live && (
        <div className="space-y-4">
          <p className="text-xs text-fg-muted">{t('settings.integrations.tallyHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('settings.integrations.tallyUrl')} value={url} onChange={(e) => setUrl(e.target.value)} />
            <Input
              label={t('settings.integrations.tallyCompany')}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <Input
            label={t('settings.integrations.tallySales')}
            value={sales}
            onChange={(e) => setSales(e.target.value)}
          />
          {mode === 'two-way' && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label={t('settings.integrations.voucherType')}
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value)}
                />
                <Input
                  label={t('settings.integrations.gstLedger')}
                  value={gstLedger}
                  onChange={(e) => setGstLedger(e.target.value)}
                />
                <Input
                  label={t('settings.integrations.gstRate')}
                  type="number"
                  min={0}
                  max={28}
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                />
              </div>
              <p className="text-xs text-fg-muted">{t('settings.integrations.gstHint')}</p>
            </>
          )}
          <Switch
            label={t('settings.integrations.daily')}
            hint={t('settings.integrations.dailyHint')}
            checked={daily}
            onChange={(next) =>
              void run('save', async () => {
                setDaily(next)
                await integrationsApi.save(payload(mode, next))
                onStatus(await integrationsApi.status())
              })
            }
          />
          {mode === 'two-way' && (
            <Switch
              label={t('settings.integrations.pushDaily')}
              hint={t('settings.integrations.pushDailyHint')}
              checked={pushDaily}
              onChange={(next) =>
                void run('save', async () => {
                  setPushDaily(next)
                  await integrationsApi.save(payload(mode, daily, next))
                  onStatus(await integrationsApi.status())
                })
              }
            />
          )}
          <p className="text-xs text-fg-muted">
            {status?.tallyLastSync
              ? t('settings.integrations.lastSync', { when: new Date(status.tallyLastSync).toLocaleString() })
              : t('settings.integrations.neverSynced')}
          </p>
          {status?.tallyLastError && <p className="text-xs text-danger">{status.tallyLastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy === 'save'}
              onClick={() =>
                void run('save', async () => {
                  await integrationsApi.save(payload())
                  onStatus(await integrationsApi.status())
                  toast.success(t('settings.integrations.saved'))
                })
              }
            >
              {t('settings.integrations.save')}
            </Button>
            <Button
              loading={busy === 'test'}
              onClick={() =>
                void run('test', async () => {
                  await integrationsApi.save(payload())
                  const result = await integrationsApi.testTally()
                  if (!result.ok) throw new ApiError(502, result.message)
                  toast.success(
                    t('settings.integrations.tallyOk', {
                      company: result.company ? ` — ${result.company}` : '',
                    }),
                  )
                })
              }
            >
              {t('settings.integrations.test')}
            </Button>
            <Button
              loading={busy === 'sync'}
              onClick={() =>
                void run('sync', async () => {
                  const result = await integrationsApi.syncTally()
                  await refreshBooks(
                    result,
                    t('settings.integrations.synced', {
                      invoices: result.invoices,
                      stock: result.stockUpdated,
                      customers: result.customers,
                    }),
                  )
                })
              }
            >
              {t('settings.integrations.syncNow')}
            </Button>
            {mode === 'two-way' && (
              <Button
                loading={busy === 'post'}
                onClick={() =>
                  void run('post', async () => {
                    const result = await integrationsApi.pushTally()
                    await useCrmStore.getState().refresh()
                    if (!result.sent && !result.customers && result.errors.length) {
                      throw new ApiError(502, result.errors[0])
                    }
                    toast.success(
                      t('settings.integrations.posted', { sent: result.sent, customers: result.customers }),
                      result.errors[0],
                    )
                  })
                }
              >
                {t('settings.integrations.postNow')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
