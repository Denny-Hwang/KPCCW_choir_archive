import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { getWriteKey, setWriteKey } from '../lib/api'
import { applyPlan, validatePlan, type PlanPayload, type WriteResult } from '../lib/write'
import { nextServiceDate, parseRehearsalPattern, suggestRehearsals } from '../lib/planner'
import { buildRehearsalPaste, buildServicePaste, pasteHeader, REHEARSAL_COLUMNS, SERVICE_COLUMNS } from '../lib/paste'
import { songUsage, titleOf } from '../lib/derive'
import { formatLongDate, formatMonthDay, todayKey, weekdayOf } from '../lib/date'
import type { Rehearsal, Song } from '../lib/types'
import { Badge, CopyBlock } from './ui'

type RehearsalDraft = Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>

/** rehearsals.구분의 드롭다운 값 (Setup.gs). 밖의 값은 시트가 거부한다. */
const 구분_OPTIONS = ['주일', '수요일', '특별']

/**
 * "다음 찬양으로" (§12.2).
 *
 * 곡 화면에서 한 곡을 고른 채로 찬양일과 연습 일정을 정하고 시트에 바로 쓴다.
 * 선곡 화면(§6.7)이 한 달을 통째로 짜는 자리라면, 여기는 "이 곡, 다음 찬양" 한 번이다.
 *
 * 쓰기가 실패하면(키 없음·네트워크·시트 거부) 같은 내용을 붙여넣기 블록(§12.1)으로
 * 내놓는다. 어느 쪽이든 화면을 떠나기 전에 결과가 손에 쥐어져야 한다.
 */
export function PlanDialog({ song, onClose }: { song: Song; onClose: () => void }) {
  const { data, songs, rehearsals: rehearsalIndex, history, reload } = useArchive()
  const navigate = useNavigate()
  const today = todayKey()
  const patterns = useMemo(() => parseRehearsalPattern(data.config.연습기본패턴), [data.config.연습기본패턴])

  // 시트에 그 날 연습이 이미 있으면 그것을 보여준다. 없을 때만 기본 패턴으로 제안한다.
  function rehearsalsFor(date: string): { drafts: RehearsalDraft[]; fromSheet: boolean } {
    const existing = rehearsalIndex.get(date) ?? []
    if (existing.length) {
      return { drafts: existing.map((r) => ({ 연습일: r.연습일, 시각: r.시각, 구분: r.구분, 장소: r.장소 })), fromSheet: true }
    }
    return { drafts: suggestRehearsals(date, patterns), fromSheet: false }
  }

  const [찬양일, set찬양일] = useState(() => nextServiceDate(today, data.config, data.services))
  const [예배구분, set예배구분] = useState('주일')
  const [rehearsals, setRehearsals] = useState<{ drafts: RehearsalDraft[]; fromSheet: boolean }>(() => rehearsalsFor(찬양일))
  const [key, setKey] = useState(() => getWriteKey())
  const [editingKey, setEditingKey] = useState(() => !getWriteKey())
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'failed'>('idle')
  const [result, setResult] = useState<WriteResult | null>(null)

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

  const existing = data.services.find((s) => s.찬양일 === 찬양일 && s.예배구분 === 예배구분) ?? null
  const alreadyThere = !!existing?.곡.includes(song.표시명)
  const full = !!existing && !alreadyThere && existing.곡.length >= 3
  const usage = songUsage(song.표시명, history, 찬양일, data.config.중복경고개월)

  const payload: PlanPayload = { 찬양일, 예배구분: 예배구분.trim() || '주일', 곡: [song.표시명], rehearsals: rehearsals.drafts }
  const problems = validatePlan(payload)
  if (alreadyThere) problems.push('이 날에는 이미 이 곡이 있습니다.')
  if (full) problems.push('이 날은 곡 3개가 이미 차 있습니다. 시트에서 직접 고치세요.')

  const busy = status === 'saving'
  const done = status === 'done' && result?.ok

  function changeDate(next: string) {
    set찬양일(next)
    if (next) setRehearsals(rehearsalsFor(next))
  }

  function updateDraft(i: number, patch: Partial<RehearsalDraft>) {
    setRehearsals((prev) => ({ ...prev, drafts: prev.drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)) }))
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
      const r = await applyPlan(payload, trimmed)
      setResult(r)
      setStatus(r.ok ? 'done' : 'failed')
      if (r.ok) reload()
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
      setStatus('failed')
    }
  }

  const servicePaste = buildServicePaste([{ 찬양일, 예배구분: payload.예배구분, 곡: existing ? [...existing.곡, song.표시명] : [song.표시명] }])
  const rehearsalPaste = buildRehearsalPaste(rehearsals.drafts.map((r) => ({ ...r, 찬양일 })))

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-center bg-stone-900/30" role="dialog" aria-modal="true" aria-label="다음 찬양으로">
      <div className="flex h-full w-full max-w-2xl flex-col bg-paper shadow-xl">
        <div
          className="flex shrink-0 items-baseline justify-between gap-2 border-b border-stone-200 bg-paper p-3"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
          <h2 className="min-w-0 truncate text-base font-extrabold">
            다음 찬양으로
            <span className="ml-2 text-xs font-normal text-stone-500">{song.제목 || song.표시명}</span>
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 px-2.5 py-1 text-xs">
            닫기
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="card p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-lg font-bold">{song.제목 || song.표시명}</p>
              {song.곡코드 && <span className="text-xs text-stone-400">{song.곡코드}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {usage.recent ? (
                <Badge tone="danger">최근 {usage.monthsAgo}개월 내 부름 · {usage.lastSung}</Badge>
              ) : usage.lastSung ? (
                <Badge>마지막 {usage.lastSung}</Badge>
              ) : (
                <Badge>부른 적 없음</Badge>
              )}
              {!song.검증 && <Badge tone="warn">미확인 곡</Badge>}
            </div>
          </div>

          {done ? (
            <DoneCard result={result} 찬양일={찬양일} 예배구분={payload.예배구분} />
          ) : (
            <>
              <section className="card space-y-3 p-4">
                <p className="text-sm font-bold text-stone-600">찬양일</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={찬양일} onChange={(e) => changeDate(e.target.value)} className="field w-auto" disabled={busy} />
                  <span className="text-xs text-stone-400">{weekdayOf(찬양일) && `${weekdayOf(찬양일)}요일`}</span>
                  <input
                    type="text"
                    value={예배구분}
                    onChange={(e) => set예배구분(e.target.value)}
                    placeholder="예배구분"
                    className="field w-28"
                    disabled={busy}
                  />
                </div>
                {existing && (
                  <p className={`rounded-xl p-3 text-xs ${alreadyThere || full ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                    {formatMonthDay(찬양일)} {payload.예배구분}은(는) 이미 시트에 있습니다
                    {existing.곡.length > 0 && ` (${existing.곡.map((t) => titleOf(t, songs)).join(' / ')})`}.
                    {alreadyThere
                      ? ' 이 곡이 이미 들어 있습니다.'
                      : full
                        ? ' 빈 곡 칸이 없습니다.'
                        : ` 이 곡이 곡${existing.곡.length + 1}(으)로 추가됩니다.`}
                  </p>
                )}
              </section>

              <section className="card space-y-3 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-stone-600">연습 일정</p>
                  <button
                    type="button"
                    className="text-xs text-stone-400 underline"
                    onClick={() => setRehearsals({ drafts: suggestRehearsals(찬양일, patterns), fromSheet: false })}
                    disabled={busy}
                  >
                    기본 패턴으로
                  </button>
                </div>
                {rehearsals.fromSheet && (
                  <p className="text-xs text-stone-500">시트에 있는 일정을 불러왔습니다. 같은 날·시각은 다시 넣지 않습니다.</p>
                )}
                {rehearsals.drafts.length === 0 && <p className="text-xs text-stone-400">연습 일정이 없습니다. 아래에서 추가하세요.</p>}
                <div className="space-y-2">
                  {rehearsals.drafts.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1">
                      <input type="date" value={r.연습일} onChange={(e) => updateDraft(i, { 연습일: e.target.value })} className="field w-auto" disabled={busy} />
                      <input type="time" value={r.시각} onChange={(e) => updateDraft(i, { 시각: e.target.value })} className="field w-32" disabled={busy} />
                      <select value={r.구분} onChange={(e) => updateDraft(i, { 구분: e.target.value })} className="field w-24" disabled={busy}>
                        {[...new Set([...구분_OPTIONS, r.구분].filter(Boolean))].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setRehearsals((prev) => ({ ...prev, drafts: prev.drafts.filter((_, j) => j !== i) }))}
                        className="text-xs text-stone-400 hover:text-rose-600"
                        disabled={busy}
                      >
                        빼기
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    setRehearsals((prev) => ({
                      ...prev,
                      drafts: [...prev.drafts, { 연습일: 찬양일, 시각: '13:30', 구분: '주일', 장소: '' }],
                    }))
                  }
                >
                  연습 추가
                </button>
              </section>

              <section className="card space-y-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-stone-600">편집 키</p>
                  {!editingKey && (
                    <button type="button" className="text-xs text-stone-400 underline" onClick={() => setEditingKey(true)}>
                      바꾸기
                    </button>
                  )}
                </div>
                {editingKey ? (
                  <>
                    <input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="시트 메뉴 [성가 아카이브 > 앱 편집 키 설정]의 키"
                      className="field"
                      autoComplete="off"
                      disabled={busy}
                    />
                    <p className="text-xs text-stone-400">이 브라우저에만 저장됩니다. 총무·지휘자만 알고 있으면 됩니다.</p>
                  </>
                ) : (
                  <p className="text-xs text-stone-500">저장된 키를 씁니다.</p>
                )}
              </section>

              {problems.length > 0 && (
                <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  {problems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}

              {status === 'failed' && result && !result.ok && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                    <p className="font-semibold">시트에 쓰지 못했습니다.</p>
                    <p className="mt-1 break-all">{result.error}</p>
                  </div>
                  <div className="card p-3">
                    <p className="text-sm font-bold">대신 시트에 붙여넣기</p>
                    <p className="mt-1 text-xs text-stone-500">
                      각 시트의 <strong>마지막 행 다음 칸</strong>을 선택하고 붙여넣으세요.
                      {existing && ' services는 이미 있는 행이니 곡 칸만 채우면 됩니다.'}
                    </p>
                    <PasteBlock title="services" columns={SERVICE_COLUMNS} text={servicePaste} />
                    <PasteBlock title="rehearsals" columns={REHEARSAL_COLUMNS} text={rehearsalPaste} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-2 border-t border-stone-200 bg-paper p-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {done ? (
            <>
              <button type="button" className="btn-ghost" onClick={onClose}>
                닫기
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onClose()
                  navigate('/')
                }}
              >
                홈에서 보기
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn-primary" onClick={submit} disabled={busy || problems.length > 0}>
                {busy ? '시트에 쓰는 중…' : `${formatMonthDay(찬양일)} 찬양으로 적용`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function DoneCard({ result, 찬양일, 예배구분 }: { result: WriteResult | null; 찬양일: string; 예배구분: string }) {
  if (!result || !result.ok) return null
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-bold">
        {formatLongDate(찬양일)} {예배구분} 찬양으로 시트에 넣었습니다.
      </p>
      <ul className="mt-2 space-y-0.5 text-xs">
        <li>
          · services: {result.service === 'created' ? '새 행 추가' : '있던 행에 곡 추가'}
          {result.songsSkipped.length > 0 && ` (이미 있던 곡 ${result.songsSkipped.length} 건너뜀)`}
        </li>
        <li>
          · rehearsals: {result.rehearsalsAdded}건 추가
          {result.rehearsalsSkipped > 0 && ` (이미 있던 ${result.rehearsalsSkipped}건 건너뜀)`}
        </li>
      </ul>
      <p className="mt-2 text-xs">홈 화면에 바로 나타나고, 거기서 공지를 복사할 수 있습니다.</p>
    </div>
  )
}

function PasteBlock({ title, columns, text }: { title: string; columns: readonly string[]; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-bold">{title}</p>
      <p className="truncate text-[11px] text-stone-400">열 순서: {pasteHeader(columns).replace(/\t/g, ' · ')}</p>
      <pre className="my-2 max-h-32 overflow-auto whitespace-pre rounded-xl bg-stone-50 p-3 font-mono text-[11px]">{text || '(없음)'}</pre>
      <CopyBlock text={text} label={`${title} 블록 복사`} />
    </div>
  )
}
