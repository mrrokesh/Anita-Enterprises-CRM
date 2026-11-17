import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card } from '@/components/ui'
import { useChat } from '../useChat'
import { AiThinking } from './AiThinking'
import { ChatBubble } from './ChatBubble'

const SUGGESTIONS = ['hot', 'overdue', 'untouched', 'website', 'unassigned'] as const

export function AssistantChat({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { msgs, suggestions, busy, send } = useChat()
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs, busy])

  const submit = (q: string) => {
    setText('')
    void send(q)
  }
  return (
    <Card className={compact ? 'flex h-full min-h-0 flex-col rounded-none border-0' : 'flex h-[calc(100dvh-13rem)] min-h-96 flex-col'}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        <div className="max-w-[85%] rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm">
          {t('assistant.welcome')}
        </div>
        {msgs.map((m) => (
          <ChatBubble key={m.id} msg={m} />
        ))}
        {busy && <AiThinking />}
        <div ref={end} />
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pt-3">
        {(suggestions.length ? suggestions : SUGGESTIONS.map((s) => t(`assistant.suggest.${s}`))).map((label) => (
          <button
            key={label}
            type="button"
            disabled={busy}
            onClick={() => submit(label)}
            className="rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('assistant.placeholder')}
          placeholder={t('assistant.placeholder')}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm focus:border-brand-500 focus:outline-2 focus:outline-brand-500/30"
        />
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
          <Send className="size-4" />
          <span className="hidden sm:inline">{t('assistant.send')}</span>
        </Button>
      </form>
    </Card>
  )
}
