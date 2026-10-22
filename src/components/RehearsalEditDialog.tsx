import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useArchive } from '../lib/useArchive'
import { getWriteKey, setWriteKey } from '../lib/api'
import { alignRehearsal, formatLongDate, rehearsalMismatch, weekdayOf } from '../lib/date'
import { updateRehearsals, validateRehearsalEdit, type UpdateRehearsalsResult } from '../lib/write'
import type { Rehearsal } from '../lib/types'
import { WriteKeyField } from './WriteKeyField'

type Draft = Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>

/** rehearsals.구분의 드롭다운 값 (Setup.gs). 밖의 값은 시트가 거부한다. */
const 구분_OPTIONS = ['주일', '수요일', '특별']

/**
 * 이미 등록·공지한 연습 일정 고치기.
 *
 * 날짜를 바꾸면 요일에 맞춰 구분과 기본 시각(수요일 8시, 주일 1시 30분)을 채우고,
 * 날짜와 구분이 어긋난 줄은 경고한다. 저장은 그 찬양일의 일정을 통째로 바꾼다.
 */
export function RehearsalEditDialog({
  찬양일,
  rehearsals,
  onClose,
}: {
  찬양일: string
  rehearsals: Rehearsal[]
  onClose: () => void
}) {
  const { reload } = useArchive()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    rehearsals.map((r) => ({ 연습일: r.연습일, 시각: r.시각, 구분: r.구분, 장소: r.장소 })),
  )
  const [key, setKey] = useState(() => getWriteKey())
  const [editingKey, setEditingKey] = useState(() => !getWriteKey())
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'failed'>('idle')
  const [result, setResult] = useState<UpdateRehearsalsResult | null>(null)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const problems = validateRehearsalEdit({ 찬양일, rehearsals: drafts })
  const busy = status === 'saving'
  const done = status === 'done' && result?.ok

  function update(i: number, patch: Draft) {
    setDrafts((prev) => prev.map((d, j) => (j === i ? patch : d)))
  }

  async function submit() {
    const trimmed = key.trim()
    if (!trimmed) {
      setEditingKey(true)
      setResult({ ok: false, error: '편집 키를 넣어야 시트에 쓸 수 있습니다.' })
      setStatus('failed')
      return
    }
    setWriteKey(trimmed)
    setStatus('saving')
    setResult(null)
    try {
      const r = await updateRehearsals({ 찬양일, rehearsals: drafts }, trimmed)
      setResult(r)
      setStatus(r.ok ? 'done' : 'failed')
      if (r.ok) reload()
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
      setStatus('failed')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-center bg-stone-900/30" role="dialog" aria-modal="true" aria-label="연습 일정 수정">
      <div className="flex h-full w-full max-w-2xl flex-col bg-paper shadow-xl">
        <div
          className="flex shrink-0 items-baseline justify-between gap-2 border-b border-stone-200 bg-paper p-3"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
          <h2 className="min-w-0 truncate text-base font-extrabold">
            연습 일정 수정
            <span className="ml-2 text-xs font-normal text-stone-500">{formatLongDate(찬양일)} 찬양</span>
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 px-2.5 py-1 text-xs">
            닫기
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {done ? (
            <div className="card space-y-3 p-4">
              <p className="font-bold">연습 일정을 고쳤습니다.</p>
              <p className="text-xs text-stone-500">홈의 공지 문구에도 바로 반영됩니다. 이미 보낸 공지는 다시 복사해서 올리세요.</p>
              <button type="button" className="btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          ) : (
            <>
              <section className="card space-y-3 p-4">
                <p className="text-xs text-stone-500">
                  날짜를 바꾸면 요일에 맞춰 구분과 시각이 자동으로 채워집니다. 수요일은 저녁 8시, 주일은 1시 30분이 기본입니다.
                </p>
                {drafts.length === 0 && <p className="text-xs text-stone-400">연습 일정이 없습니다. 저장하면 이 찬양일의 일정이 모두 지워집니다.</p>}
                <div className="space-y-2">
                  {drafts.map((r, i) => {
                    const mismatch = rehearsalMismatch(r)
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-1">
                        <input
                          type="date"
                          value={r.연습일}
                          onChange={(e) => update(i, alignRehearsal({ ...r, 연습일: e.target.value }))}
                          className="field w-auto"
                          disabled={busy}
                        />
                        <span className="text-xs text-stone-400">{weekdayOf(r.연습일)}</span>
                        <input
                          type="time"
                          value={r.시각}
                          onChange={(e) => update(i, { ...r, 시각: e.target.value })}
                          className="field w-32"
                          disabled={busy}
                        />
                        <select value={r.구분} onChange={(e) => update(i, { ...r, 구분: e.target.value })} className="field w-24" disabled={busy}>
                          {[...new Set([...구분_OPTIONS, r.구분].filter(Boolean))].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                          className="text-xs text-stone-400 hover:text-rose-600"
                          disabled={busy}
                        >
                          빼기
                        </button>
                        {mismatch && (
                          <p className="w-full text-xs text-rose-600">
                            {mismatch}{' '}
                            <button type="button" className="underline" onClick={() => update(i, alignRehearsal(r))} disabled={busy}>
                              요일에 맞추기
                            </button>
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setDrafts((prev) => [...prev, { 연습일: 찬양일, 시각: '13:30', 구분: '주일', 장소: '' }])}
                >
                  연습 추가
                </button>
              </section>

              <section className="card p-4">
                <WriteKeyField value={key} onChange={setKey} editing={editingKey} onEdit={() => setEditingKey(true)} disabled={busy} />
              </section>

              {problems.length > 0 && (
                <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  {problems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}

              {status === 'failed' && result && !result.ok && (
                <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                  <p className="font-semibold">시트에 쓰지 못했습니다.</p>
                  <p className="mt-1 break-all">{result.error}</p>
                  <p className="mt-1">Apps Script에 "updateRehearsals"가 들어간 새 버전을 배포했는지 확인하세요.</p>
                </div>
              )}

              <button type="button" className="btn-primary w-full" onClick={submit} disabled={busy || problems.length > 0}>
                {busy ? '저장 중…' : '시트에 저장'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
