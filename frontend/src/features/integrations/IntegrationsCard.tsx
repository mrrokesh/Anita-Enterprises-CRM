import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Input } from '@/components/ui'
import { TallyOptions } from './TallyOptions'
import { isOwner } from '@/features/auth/permissions'
import { useCurrentUser } from '@/features/auth/useCurrentUser'
import { ApiError, integrationsApi, type IntegrationStatus } from '@/services/api'
import { useCrmStore } from '@/store/crmStore'
import { toast } from '@/store/toastStore'

type Busy = 'save' | 'pull' | null

export function IntegrationsCard() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<Busy>(null)

  useEffect(() => {
    if (!isOwner(user)) return
    let live = true
    void integrationsApi
      .status()
      .then((next) => {
        if (!live) return
        setStatus(next)
      })
      .catch(() => {
        if (live) toast.error(t('errors.generic'))
      })
    return () => {
      live = false
    }
  }, [t, user])

  if (!isOwner(user)) return null

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

  const saveBody = () => ({
    indiamartCrmKey: key.trim() || undefined,
  })

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">{t('settings.integrations.title')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t('settings.integrations.hint')}</p>
      </div>
      <Input
        label={t('settings.integrations.key')}
        hint={status?.indiamartKeySet ? t('settings.integrations.keySaved') : t('settings.integrations.keyHint')}
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={busy === 'save'}
          onClick={() =>
            void run('save', async () => {
              await integrationsApi.save(saveBody())
              setKey('')
              setStatus(await integrationsApi.status())
              toast.success(t('settings.integrations.saved'))
            })
          }
        >
          {t('settings.integrations.save')}
        </Button>
        <Button
          loading={busy === 'pull'}
          onClick={() =>
            void run('pull', async () => {
              const result = await integrationsApi.pullIndiaMart()
              await useCrmStore.getState().refresh()
              toast.success(
                t('settings.integrations.pull'),
                result.code === 'no_leads'
                  ? t('settings.integrations.noLeads')
                  : t('settings.integrations.pullText', {
                      created: result.created,
                      customers: result.customers,
                      duplicates: result.duplicates,
                    }),
              )
            })
          }
        >
          {t('settings.integrations.pull')}
        </Button>
      </div>
      <TallyOptions status={status} onStatus={setStatus} />
      {status?.webhookUrl && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t('settings.integrations.webhook')}</span>
          <div className="flex gap-2">
            <input
              readOnly
              value={status.webhookUrl}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(status.webhookUrl).then(() => {
                  toast.success(t('settings.integrations.copied'))
                })
              }
            >
              {t('settings.integrations.copy')}
            </Button>
          </div>
          <p className="text-xs text-fg-muted">{t('settings.integrations.webhookHint')}</p>
        </div>
      )}
    </Card>
  )
}
