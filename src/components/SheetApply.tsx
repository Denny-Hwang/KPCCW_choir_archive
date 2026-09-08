import { useState } from 'react'
import { useArchive } from '../lib/useArchive'
import { getWriteKey, setWriteKey } from '../lib/api'
import { applyPlan, planToPayloads, validatePlan, type PlanPayload, type WriteResult } from '../lib/write'
import { formatMonthDay } from '../lib/date'
import { titleOf } from '../lib/derive'
import type { PlannedDate } from '../lib/planner'
import type { Song } from '../lib/types'
import { Badge } from './ui'

type RowState = { payload: PlanPayload; state: 'pending' | 'saving' | 'done' | 'failed'; result?: WriteResult }

/**
 * 선곡 화면의 "시트에 반영" (§12.2).
 *
 * 한 달 계획을 찬양일별로 나눠 하나씩 쓴다 — 쓰기 엔드포인트는 한 찬양일만 받고,
 * 한 날이 거부돼도 나머지는 들어가야 한다. 결과는 날짜별로 보여주고, 실패한 날은
 * 아래 붙여넣기 블록으로 넣으면 된다(그 블록은 이 버튼과 무관하게 항상 있다).
 */
export function SheetApply({ plan, songs }: { plan: PlannedDate[]; songs: Map<string, Song> }) {
  const { reload } = useArchive()
  const [key, setKey] = useState(() => getWriteKey())
  const [editingKey, setEditingKey] = useState(() => !getWriteKey())
  const [rows, setRows] = useState<RowState[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const payloads = planToPayloads(plan)
  const problems = payloads.flatMap((p) => validatePlan(p).map((m) => `${formatMonthDay(p.찬양일)}: ${m}`))
  const skipped = plan.filter((d) => d.찬양일 && d.곡.length === 0).length

  async function run() {
    const trimmed = key.trim()
    if (!trimmed) {
      setEditingKey(true)
      setKeyError('편집 키를 넣어야 시트에 쓸 수 있습니다.')
      return
    }
    setKeyError(null)
    setWriteKey(trimmed)
    setBusy(true)
    const next: RowState[] = payloads.map((payload) => ({ payload, state: 'pending' }))
    setRows([...next])
    for (let i = 0; i < next.length; i++) {
      next[i] = { ...next[i], state: 'saving' }
      setRows([...next])
      try {
        const result = await applyPlan(next[i].payload, trimmed)
        next[i] = { ...next[i], state: result.ok ? 'done' : 'failed', result }
      } catch (e) {
        next[i] = { ...next[i], state: 'failed', result: { ok: false, error: e instanceof Error ? e.message : String(e) } }
      }
      setRows([...next])
    }
    setBusy(false)
    if (next.some((r) => r.state === 'done')) reload()
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="text-xs text-stone-500">
        곡이 있는 찬양일 {payloads.length}개를 services·rehearsals 시트에 <strong>추가</strong>합니다.
        같은 날 행이 있으면 빈 곡 칸만 채우고, 이미 있는 연습은 다시 넣지 않습니다.
        {skipped > 0 && ` 곡이 없는 ${skipped}개 날은 건너뜁니다.`}
      </p>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="label">편집 키</p>
          {!editingKey && (
            <button type="button" className="text-xs text-stone-400 underline" onClick={() => setEditingKey(true)}>
              바꾸기
            </button>
          )}
        </div>
        {editingKey ? (
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="시트 메뉴 [성가 아카이브 > 앱 편집 키 설정]의 키"
            className="field"
            autoComplete="off"
            disabled={busy}
          />
        ) : (
          <p className="text-xs text-stone-500">저장된 키를 씁니다.</p>
        )}
        {keyError && <p className="text-xs text-rose-700">{keyError}</p>}
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          {problems.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn-primary w-full"
        onClick={run}
        disabled={busy || payloads.length === 0 || problems.length > 0}
      >
        {busy ? '시트에 쓰는 중…' : payloads.length ? `찬양일 ${payloads.length}개 시트에 반영` : '반영할 선곡이 없습니다'}
      </button>

      {rows && (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 text-sm">
          {rows.map((row) => (
            <li key={`${row.payload.찬양일}-${row.payload.예배구분}`} className="space-y-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{formatMonthDay(row.payload.찬양일)}</span>
                  <span className="ml-1 text-xs text-stone-400">{row.payload.예배구분}</span>
                  <span className="ml-2 text-xs text-stone-500">{row.payload.곡.map((t) => titleOf(t, songs)).join(' / ')}</span>
                </span>
                {row.state === 'pending' && <Badge>대기</Badge>}
                {row.state === 'saving' && <Badge>쓰는 중…</Badge>}
                {row.state === 'done' && row.result?.ok && (
                  <Badge tone="ok">{row.result.service === 'created' ? '새 행' : '곡 추가'} · 연습 {row.result.rehearsalsAdded}건</Badge>
                )}
                {row.state === 'failed' && <Badge tone="danger">실패</Badge>}
              </div>
              {row.state === 'failed' && row.result && !row.result.ok && (
                <p className="break-all text-xs text-rose-700">{row.result.error}</p>
              )}
              {row.state === 'done' && row.result?.ok && row.result.songsSkipped.length > 0 && (
                <p className="text-xs text-stone-500">이미 있던 곡 {row.result.songsSkipped.length}개는 건너뛰었습니다.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && !busy && rows.some((r) => r.state === 'failed') && (
        <p className="text-xs text-stone-500">실패한 날은 아래 붙여넣기 블록에서 그 행만 골라 시트에 붙여넣으세요.</p>
      )}
    </div>
  )
}
