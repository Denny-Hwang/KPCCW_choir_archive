import { useMemo, useState } from 'react'
import { filterCandidates, EMPTY_FILTER, type CandidateFilter, type SongCandidate } from '../lib/planner'
import { SongMeta } from './SongRow'

/**
 * 선곡용 곡 선택 (§6.7).
 * 마지막으로 부른 날·최근 경고·파트 영상 보유·검증 상태·난이도를 고르는 자리에서 바로 보여준다.
 * 목록에서 나가서 확인해야 한다면 아무도 확인하지 않는다.
 */
export function SongPicker({
  candidates,
  seasonHint,
  onPick,
  onClose,
}: {
  candidates: SongCandidate[]
  seasonHint: string
  onPick: (표시명: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<CandidateFilter>(() => ({ ...EMPTY_FILTER, 절기: seasonHint }))

  const visible = useMemo(() => {
    const list = filterCandidates(candidates, filter)
    // 최근에 부른 곡은 뒤로 민다. 위쪽이 고르기 쉬운 자리이므로 그 자리를 안전한 후보에게 준다.
    return [...list]
      .sort((a, b) => Number(a.recent) - Number(b.recent) || (a.lastSung ?? '').localeCompare(b.lastSung ?? ''))
      .slice(0, 200)
  }, [candidates, filter])

  const 절기목록 = useMemo(
    () => [...new Set(candidates.map((c) => c.song.절기).filter(Boolean))].sort(),
    [candidates],
  )

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper">
      <div className="sticky top-0 space-y-2 border-b border-stone-200 bg-paper p-3">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="search"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="곡 검색"
            className="field"
          />
          <button type="button" onClick={onClose} className="btn-ghost shrink-0">
            닫기
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="rounded-lg border border-stone-300 px-2 py-1"
            value={filter.절기}
            onChange={(e) => setFilter((f) => ({ ...f, 절기: e.target.value }))}
          >
            <option value="">절기 전체</option>
            {절기목록.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={filter.중복숨김}
              onChange={(e) => setFilter((f) => ({ ...f, 중복숨김: e.target.checked }))}
            />
            최근에 부른 곡 숨기기
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={filter.검증만}
              onChange={(e) => setFilter((f) => ({ ...f, 검증만: e.target.checked }))}
            />
            확인된 곡만
          </label>
          <span className="ml-auto text-stone-400">{visible.length}곡</span>
        </div>
        {seasonHint && filter.절기 === seasonHint && (
          <p className="text-xs text-stone-500">이 달의 절기 힌트로 &lsquo;{seasonHint}&rsquo;를 먼저 걸어 두었습니다.</p>
        )}
      </div>

      <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
        {visible.map((c) => (
          <li key={`${c.song.곡코드}-${c.song.표시명}`}>
            <button
              type="button"
              onClick={() => onPick(c.song.표시명)}
              className={`w-full px-4 py-3 text-left hover:bg-stone-50 ${c.song.검증 ? '' : 'opacity-60'}`}
            >
              <p className="font-semibold">{c.song.제목 || c.song.표시명}</p>
              <SongMeta candidate={c} />
            </button>
          </li>
        ))}
        {!visible.length && <li className="p-8 text-center text-sm text-stone-400">조건에 맞는 곡이 없습니다.</li>}
      </ul>
    </div>
  )
}
