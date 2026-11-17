import { useEffect, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { AssistantChat } from './AssistantChat'

export function AskAiButton() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (pathname === '/ai-assistant') return null

  const toggle = () => {
    setMounted(true)
    setOpen((value) => !value)
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end">
      {mounted && (
        <div
          className={
            open
              ? 'mb-3 flex h-[min(34rem,calc(100dvh-7.5rem))] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border shadow-2xl'
              : 'hidden'
          }
        >
          <div className="flex items-center gap-2 bg-brand-600 px-3 py-2.5 text-white">
            <span className="text-sm font-semibold">{t('assistant.title')}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('assistant.close')}
              className="ml-auto grid size-8 place-items-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-surface">
            <AssistantChat compact />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? t('assistant.close') : t('assistant.ask')}
        className="flex items-center gap-2"
      >
        {!open && (
          <span className="rounded-full bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg">
            {t('assistant.ask')}
          </span>
        )}
        <span className="relative grid size-16 place-items-center rounded-full bg-brand-600 text-lg font-bold tracking-wide text-white shadow-lg">
          AI
          <span className="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full bg-white text-brand-600 ring-2 ring-bg">
            {open ? <X className="size-3.5" /> : <MessageCircle className="size-3.5" fill="currentColor" />}
          </span>
        </span>
      </button>
    </div>
  )
}
