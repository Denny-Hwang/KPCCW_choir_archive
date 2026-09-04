import { useState, type ReactNode } from 'react'
import { copyText } from '../lib/clipboard'

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600',
    warn: 'bg-amber-100 text-amber-800',
    danger: 'bg-rose-100 text-rose-700',
    ok: 'bg-emerald-100 text-emerald-700',
  }
  return <span className={`chip ${tones[tone]}`}>{children}</span>
}

/** 미검증 항목 배지 (§9.3). 흐리게 처리는 호출부에서 opacity로 함께 준다. */
export function UnverifiedBadge() {
  return <Badge tone="warn">미확인</Badge>
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm font-medium text-stone-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-stone-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * 복사 버튼. 클립보드 API가 막힌 환경(iOS 사파리 등)에서는 텍스트 영역을 펼쳐
 * 수동 복사를 유도한다 (§7.2).
 */
export function CopyBlock({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')

  async function handleCopy() {
    if (!text) return
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'manual')
    if (ok) window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={handleCopy} disabled={!text}>
          {state === 'copied' ? '복사됨' : label}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setState((s) => (s === 'manual' ? 'idle' : 'manual'))}
        >
          {state === 'manual' ? '접기' : '텍스트 보기'}
        </button>
      </div>
      {state === 'manual' && (
        <div className="mt-2">
          <p className="mb-1 text-xs text-stone-500">
            자동 복사가 막힌 브라우저입니다. 아래 내용을 길게 눌러 전체 선택 후 복사하세요.
          </p>
          <textarea
            readOnly
            value={text}
            rows={Math.min(24, text.split('\n').length + 1)}
            onFocus={(e) => e.currentTarget.select()}
            className="field font-mono text-xs leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500" />
      {label}
    </div>
  )
}

/**
 * 예배 실황 영상 링크 (§4.3 기록영상URL, §11의 "유튜브가 아닌 경우" 항목).
 *
 * 그 날의 기록영상이 있으면 그것을 쓰고, 없으면 교회 홈페이지의 예배 영상 페이지로 보낸다.
 * 유튜브가 아닌 주소도 그대로 링크한다 — 교회 홈페이지에 올라오는 것이 원래 형태다.
 */
export function RecordingLink({
  recordingUrl,
  fallbackUrl,
  className = '',
}: {
  recordingUrl?: string
  fallbackUrl?: string
  className?: string
}) {
  const own = (recordingUrl ?? '').trim()
  const site = (fallbackUrl ?? '').trim()
  const href = own || site
  if (!href) return null

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 underline decoration-stone-300 underline-offset-2 hover:text-stone-700 ${className}`}
    >
      {own ? '기록영상 보기' : '교회 홈페이지에서 예배 영상 보기'}
    </a>
  )
}
