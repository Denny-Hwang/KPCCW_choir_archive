import { useMemo, useState } from 'react'
import { useArchive } from '../lib/useArchive'
import { buildCandidates, filterCandidates, EMPTY_FILTER, type CandidateFilter } from '../lib/planner'
import { todayKey } from '../lib/date'
import { SongRow } from '../components/SongRow'
import { Empty, Spinner } from '../components/ui'

/** 곡 라이브러리 (§6.3). 검색 + 악보집/절기/성부/상태/난이도/검증 필터. */
export default function Library() {
  const { data, loading, links } = useArchive()
  const [filter, setFilter] = useState<CandidateFilter>(EMPTY_FILTER)

  const candidates = useMemo(() => buildCandidates(data, todayKey(), links), [data, links])
  const visible = useMemo(() => filterCandidates(candidates, filter), [candidates, filter])

  if (loading && !data.songs.length) return <Spinner />

  const 절기목록 = [...new Set(data.songs.map((s) => s.절기).filter(Boolean))].sort()
  const 상태목록 = [...new Set(data.songs.map((s) => s.상태).filter(Boolean))]
  const 난이도목록 = [...new Set(data.songs.map((s) => s.난이도).filter((d): d is number => d != null))].sort()

  function set<K extends keyof CandidateFilter>(key: K, value: CandidateFilter[K]) {
    setFilter((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={filter.query}
        onChange={(e) => set('query', e.target.value)}
        placeholder="제목·원제·작곡가·곡코드 검색"
        className="field"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className="field" value={filter.집코드} onChange={(e) => set('집코드', e.target.value)}>
          <option value="">악보집 전체</option>
          {data.books.map((b) => (
            <option key={b.집코드} value={b.집코드}>
              {b.시리즈} {b.권 ?? ''}집
            </option>
          ))}
        </select>
        <select className="field" value={filter.절기} onChange={(e) => set('절기', e.target.value)}>
          <option value="">절기 전체</option>
          {절기목록.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="field" value={filter.상태} onChange={(e) => set('상태', e.target.value)}>
          <option value="">상태 전체</option>
          {상태목록.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="field" value={filter.난이도} onChange={(e) => set('난이도', e.target.value)}>
          <option value="">난이도 전체</option>
          {난이도목록.map((d) => (
            <option key={d} value={String(d)}>난이도 {d}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-stone-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filter.검증만} onChange={(e) => set('검증만', e.target.checked)} />
          확인된 곡만
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filter.중복숨김} onChange={(e) => set('중복숨김', e.target.checked)} />
          최근 {data.config.중복경고개월}개월 내 부른 곡 숨기기
        </label>
        <span className="ml-auto text-stone-400">
          {visible.length} / {candidates.length}곡
        </span>
      </div>

      {visible.length ? (
        <ul className="card divide-y divide-stone-100">
          {visible.map((c) => (
            <SongRow key={`${c.song.곡코드}-${c.song.표시명}`} candidate={c} />
          ))}
        </ul>
      ) : (
        <Empty
          title="조건에 맞는 곡이 없습니다."
          hint={data.songs.length ? '필터를 넓혀 보세요.' : undefined}
        />
      )}
    </div>
  )
}
