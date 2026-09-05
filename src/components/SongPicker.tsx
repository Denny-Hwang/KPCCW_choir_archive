import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { filterCandidates, EMPTY_FILTER, type CandidateFilter, type SongCandidate } from '../lib/planner'
import type { Book } from '../lib/types'
import { SongMeta } from './SongRow'

/**
 * 선곡용 곡 선택 (§6.7).
 *
 * 마지막으로 부른 날·최근 경고·파트 영상 보유·검증 상태·난이도를 고르는 자리에서 바로 보여준다.
 * 목록에서 나가서 확인해야 한다면 아무도 확인하지 않는다.
 *
 * **필터는 아무것도 켜지 않은 채로 연다.** 전에는 그 달의 절기 힌트를 미리 걸어 두었는데,
 * 채널에서 등록한 곡들은 절기가 비어 있어서 서가에 있는 곡 대부분이 처음부터 안 보였다.
 * 힌트는 한 번 눌러 거는 칩으로 두고, 기본은 서가 전체를 보여준다.
 */
export function SongPicker({
  candidates,
  books,
  seasonHint,
  warnMonths,
  subtitle,
  onPick,
  onClose,
}: {
  candidates: SongCandidate[]
  books: Book[]
  seasonHint: string
  /** `config`의 중복경고개월. "최근"이 몇 달인지 라벨에 그대로 쓴다. */
  warnMonths: number
  /** 어느 찬양일에 곡을 고르는 중인지. 전체 화면으로 덮으므로 이게 없으면 맥락을 잃는다. */
  subtitle?: string
  onPick: (표시명: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<CandidateFilter>(EMPTY_FILTER)

  // 화면을 덮는 동안 뒤 페이지가 같이 스크롤되면 닫았을 때 엉뚱한 자리에 가 있다. Esc로도 닫는다.
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

  const visible = useMemo(() => {
    const list = filterCandidates(candidates, filter)
    const hinted = (c: SongCandidate) => Number(!!seasonHint && c.song.절기 === seasonHint)
    return [...list]
      .sort(
        (a, b) =>
          // 최근에 부른 곡은 뒤로. 위쪽이 고르기 쉬운 자리이므로 안전한 후보에게 준다.
          Number(a.recent) - Number(b.recent) ||
          // 절기 힌트에 맞는 곡을 앞으로. 거르지는 않는다 — 절기가 빈 곡이 훨씬 많다.
          hinted(b) - hinted(a) ||
          (a.lastSung ?? '').localeCompare(b.lastSung ?? ''),
      )
      .slice(0, 300)
  }, [candidates, filter, seasonHint])

  const 절기목록 = useMemo(
    () => [...new Set(candidates.map((c) => c.song.절기).filter(Boolean))].sort(),
    [candidates],
  )
  const 보유책 = useMemo(() => books.filter((b) => b.보유).sort((a, b) => (a.권 ?? 0) - (b.권 ?? 0)), [books])

  const anyFilter = !!filter.query || !!filter.집코드 || !!filter.절기 || filter.검증만 || filter.중복숨김

  function set<K extends keyof CandidateFilter>(key: K, value: CandidateFilter[K]) {
    setFilter((f) => ({ ...f, [key]: value }))
  }

  // body에 직접 붙인다. 부모 안에 두면 그 부모의 레이아웃을 그대로 뒤집어쓴다 —
  // 실제로 선곡 화면의 `space-y-6`이 margin-top 24px를 얹어서, inset-0인데도
  // 24px 내려앉아 앱 헤더가 위로 삐져나왔다. 조상에 transform이 생겨도 같은 일이 난다.
  return createPortal(
    // 앱 본문이 max-w-2xl로 가운데 정렬이라, 이 화면만 뷰포트 전체를 쓰면 폭이 어긋난다.
    // 바깥은 덮개, 안쪽은 본문과 같은 폭으로 맞춘다.
    <div
      className="fixed inset-0 z-40 flex justify-center bg-stone-900/30"
      role="dialog"
      aria-modal="true"
      aria-label="곡 선택"
    >
      <div className="flex h-full w-full max-w-2xl flex-col bg-paper shadow-xl">
        <div
          className="shrink-0 space-y-2 border-b border-stone-200 bg-paper p-3"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
          {/* 앱 헤더를 덮으므로 여기에 제목이 없으면 무슨 화면인지 알 수 없다. */}
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 truncate text-base font-extrabold">
              곡 선택
              {subtitle && <span className="ml-2 text-xs font-normal text-stone-500">{subtitle}</span>}
            </h2>
            <button type="button" onClick={onClose} className="btn-ghost shrink-0 px-2.5 py-1 text-xs">
              닫기
            </button>
          </div>

          <input
            autoFocus
            type="search"
            value={filter.query}
            onChange={(e) => set('query', e.target.value)}
            placeholder="제목·작곡가·곡코드 검색"
            className="field"
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              className="field py-1.5 text-xs"
              value={filter.집코드}
              onChange={(e) => set('집코드', e.target.value)}
            >
              <option value="">서가 전체</option>
              {보유책.map((b) => (
                <option key={b.집코드} value={b.집코드}>
                  {b.시리즈} {b.권 ?? ''}집
                </option>
              ))}
            </select>
            <select className="field py-1.5 text-xs" value={filter.절기} onChange={(e) => set('절기', e.target.value)}>
              <option value="">절기 전체</option>
              {절기목록.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={filter.중복숨김} onChange={(e) => set('중복숨김', e.target.checked)} />
              최근 {warnMonths}개월 내 부른 곡 숨기기
            </label>
            <label className="flex items-center gap-1" title="songs 시트의 검증 칸을 체크한 곡만 봅니다.">
              <input type="checkbox" checked={filter.검증만} onChange={(e) => set('검증만', e.target.checked)} />
              시트에서 확인 체크한 곡만
            </label>
            {seasonHint && filter.절기 !== seasonHint && (
              <button
                type="button"
                onClick={() => set('절기', seasonHint)}
                className="chip bg-stone-100 text-stone-600 hover:bg-stone-200"
              >
                이 달의 절기: {seasonHint}
              </button>
            )}
            {anyFilter && (
              <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className="text-stone-400 underline">
                필터 지우기
              </button>
            )}
            {/* 전체 대비 몇 곡인지 보여야 "왜 이것밖에 없지"를 바로 알 수 있다. */}
            <span className={`ml-auto ${anyFilter ? 'text-stone-600' : 'text-stone-400'}`}>
              {visible.length} / {candidates.length}곡
            </span>
          </div>
        </div>

        <ul
          className="flex-1 divide-y divide-stone-100 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
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
          {!visible.length && (
            <li className="p-8 text-center text-sm text-stone-400">
              조건에 맞는 곡이 없습니다.
              {anyFilter && ' 필터를 지워 보세요.'}
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
