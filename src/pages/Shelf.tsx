import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { buildCandidates } from '../lib/planner'
import { todayKey } from '../lib/date'
import { SongRow } from '../components/SongRow'
import { Empty, Spinner } from '../components/ui'
import { normalizeHex, textOn } from '../lib/color'
import { SearchIcon } from '../components/icons'
import type { Part, PracticeLink, Song } from '../lib/types'

/** 서가 점검에서 세는 파트. 반주는 영상이 없는 권이 많아 뺀다. */
const COVER_PARTS: Part[] = ['합창', '소프라노', '알토', '테너', '베이스']

/**
 * 권 하나의 파트 영상 채움 정도. 영상이 실제로는 있는데 앱에 안 보이던 권(36집 등)은
 * 곡 하나를 열어 봐야 드러났다. 서가에서 바로 보이게 한다. 미확인 링크도 "있음"으로 센다.
 */
function coverage(songs: Song[], links: Map<string, PracticeLink[]>) {
  const byPart = new Map<Part, number>(COVER_PARTS.map((p) => [p, 0]))
  for (const song of songs) {
    const list = links.get(song.표시명) ?? []
    for (const part of COVER_PARTS) if (list.some((l) => l.파트 === part)) byPart.set(part, byPart.get(part)! + 1)
  }
  const filled = [...byPart.values()].reduce((a, b) => a + b, 0)
  const ratio = songs.length ? filled / (songs.length * COVER_PARTS.length) : 0
  return { byPart, ratio, total: songs.length }
}

/** 서가 뷰 (§6.4). 표지색으로 칠한 책등을 권 번호순으로, 미보유 권은 빈 슬롯. */
export default function Shelf() {
  const { bookCode } = useParams()
  const navigate = useNavigate()
  const { data, loading, links } = useArchive()

  const books = useMemo(
    () => [...data.books].sort((a, b) => (a.권 ?? 0) - (b.권 ?? 0) || a.집코드.localeCompare(b.집코드)),
    [data.books],
  )
  const candidates = useMemo(() => buildCandidates(data, todayKey(), links), [data, links])

  if (loading && !books.length) return <Spinner />
  if (!books.length) return <Empty title="등록된 악보집이 없습니다." />

  const selected = bookCode ? books.find((b) => b.집코드 === decodeURIComponent(bookCode)) : undefined

  if (selected) {
    const songs = candidates.filter((c) => c.song.집코드 === selected.집코드)
    const sorted = [...songs].sort((a, b) => (a.song.수록번호 ?? 0) - (b.song.수록번호 ?? 0))
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => navigate('/shelf')} className="text-sm text-stone-500 underline">
          ← 서가로
        </button>

        <div className="card overflow-hidden">
          <div
            className="px-4 py-3"
            style={{ backgroundColor: normalizeHex(selected.표지색), color: textOn(selected.표지색) }}
          >
            <p className="text-lg font-extrabold">
              {selected.시리즈} {selected.권 ?? ''}집
            </p>
            <p className="text-xs opacity-75">
              {[selected.편저 && `편저 ${selected.편저}`, selected.출판사, selected.성부, selected.출판연도]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="space-y-1 p-4 text-xs text-stone-600">
            {selected.보관위치 && <p>보관 {selected.보관위치}</p>}
            {!selected.보유 && <p className="text-amber-700">미보유 (구입 계획)</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              {selected.공식상품URL && <ExternalLink href={selected.공식상품URL}>공식 상품</ExternalLink>}
              {selected.미리듣기URL && <ExternalLink href={selected.미리듣기URL}>미리듣기</ExternalLink>}
              {selected.파트연습실URL && <ExternalLink href={selected.파트연습실URL}>파트연습실</ExternalLink>}
              {selected.참고문서URL && <ExternalLink href={selected.참고문서URL}>참고 문서</ExternalLink>}
            </div>
          </div>
        </div>

        {sorted.length > 0 && <CoverageCard book={selected} songs={sorted.map((c) => c.song)} links={links} />}

        {sorted.length ? (
          <ul className="card divide-y divide-stone-100">
            {sorted.map((c) => (
              <SongRow key={c.song.곡코드} candidate={c} />
            ))}
          </ul>
        ) : (
          <Empty
            title="이 악보집의 수록곡이 아직 없습니다."
          />
        )}
      </div>
    )
  }

  const songsByBook = new Map<string, Song[]>()
  for (const song of data.songs) songsByBook.set(song.집코드, [...(songsByBook.get(song.집코드) ?? []), song])

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {books.map((book) => (
        <Link
          key={book.집코드}
          to={`/shelf/${encodeURIComponent(book.집코드)}`}
          className={`flex aspect-[2/3] flex-col justify-between rounded-lg p-2 shadow-sm transition hover:brightness-110 ${
            book.보유 ? '' : 'text-stone-500 opacity-40 ring-1 ring-inset ring-stone-300'
          }`}
          style={
            book.보유
              ? { backgroundColor: normalizeHex(book.표지색), color: textOn(book.표지색) }
              : { backgroundColor: 'transparent' }
          }
        >
          <span className="text-xs font-bold">{book.시리즈}</span>
          <span className="text-2xl font-black leading-none">{book.권 ?? '—'}</span>
          <span className={`text-xs leading-tight ${book.보유 ? 'opacity-80' : 'text-stone-400'}`}>
            {book.보유 ? <SpineCount songs={songsByBook.get(book.집코드) ?? []} links={links} /> : '미보유'}
          </span>
        </Link>
      ))}
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline">
      {children}
    </a>
  )
}

function SpineCount({ songs, links }: { songs: Song[]; links: Map<string, PracticeLink[]> }) {
  if (!songs.length) return <>0곡</>
  const { ratio } = coverage(songs, links)
  return (
    <>
      {songs.length}곡
      <br />
      영상 {Math.round(ratio * 100)}%
    </>
  )
}

function CoverageCard({
  book,
  songs,
  links,
}: {
  book: { 시리즈: string; 권: number | null }
  songs: Song[]
  links: Map<string, PracticeLink[]>
}) {
  const { byPart, total } = coverage(songs, links)
  const thin = COVER_PARTS.filter((p) => (byPart.get(p) ?? 0) < total)
  const query = book.권 != null ? `${book.시리즈} ${book.권}집` : book.시리즈
  return (
    <div className="card space-y-3 p-4">
      <p className="text-base font-bold">파트 영상</p>
      <ul className="space-y-1.5">
        {COVER_PARTS.map((part) => {
          const n = byPart.get(part) ?? 0
          return (
            <li key={part} className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 font-semibold">{part}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                <span
                  className={`block h-full rounded-full ${n === total ? 'bg-emerald-500' : n === 0 ? 'bg-rose-400' : 'bg-amber-400'}`}
                  style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-stone-500">
                {n}/{total}
              </span>
            </li>
          )
        })}
      </ul>
      {thin.length > 0 && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {thin.join('·')} 영상이 빠진 곡이 있습니다. 유튜브에는 있을 수 있습니다 — 곡을 열면 파트마다
            찾기 버튼이 있고, 찾은 주소를 그 자리에서 넣을 수 있습니다.
          </p>
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`[중앙아트] ${query}`)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost"
          >
            <SearchIcon className="h-5 w-5" />
            유튜브에서 {query} 찾기
          </a>
        </div>
      )}
    </div>
  )
}
