import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { buildCandidates } from '../lib/planner'
import { todayKey } from '../lib/date'
import { SongRow } from '../components/SongRow'
import { Empty, Spinner } from '../components/ui'

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
  if (!books.length) return <Empty title="등록된 악보집이 없습니다." hint="books 시트에 보유한 악보집을 넣어 주세요." />

  const selected = bookCode ? books.find((b) => b.집코드 === decodeURIComponent(bookCode)) : undefined

  if (selected) {
    const songs = candidates.filter((c) => c.song.집코드 === selected.집코드)
    const sorted = [...songs].sort((a, b) => (a.song.수록번호 ?? 0) - (b.song.수록번호 ?? 0))
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => navigate('/shelf')} className="text-xs text-stone-500 underline">
          ← 서가로
        </button>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 text-white" style={{ backgroundColor: selected.표지색 || '#57534e' }}>
            <p className="text-lg font-extrabold">
              {selected.시리즈} {selected.권 ?? ''}집
            </p>
            <p className="text-xs opacity-80">
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

        {sorted.length ? (
          <ul className="card divide-y divide-stone-100">
            {sorted.map((c) => (
              <SongRow key={c.song.곡코드} candidate={c} />
            ))}
          </ul>
        ) : (
          <Empty
            title="이 악보집의 수록곡이 아직 없습니다."
            hint="채널 미러링·목차 붙여넣기로 채우거나, 선곡할 때마다 한 곡씩 추가해도 됩니다."
          />
        )}
      </div>
    )
  }

  const counts = new Map<string, number>()
  for (const song of data.songs) counts.set(song.집코드, (counts.get(song.집코드) ?? 0) + 1)

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {books.map((book) => (
        <Link
          key={book.집코드}
          to={`/shelf/${encodeURIComponent(book.집코드)}`}
          className={`flex aspect-[2/3] flex-col justify-between rounded-lg p-2 text-white shadow-sm transition hover:brightness-110 ${
            book.보유 ? '' : 'opacity-40 ring-1 ring-inset ring-stone-300'
          }`}
          style={{ backgroundColor: book.보유 ? book.표지색 || '#57534e' : 'transparent' }}
        >
          <span className={`text-xs font-bold ${book.보유 ? '' : 'text-stone-500'}`}>{book.시리즈}</span>
          <span className={`text-2xl font-black leading-none ${book.보유 ? '' : 'text-stone-500'}`}>
            {book.권 ?? '—'}
          </span>
          <span className={`text-[10px] ${book.보유 ? 'opacity-80' : 'text-stone-400'}`}>
            {book.보유 ? `${counts.get(book.집코드) ?? 0}곡` : '미보유'}
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
