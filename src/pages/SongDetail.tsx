import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { songUsage } from '../lib/derive'
import { formatLongDate, todayKey } from '../lib/date'
import { PartLinkList } from '../components/PartLinks'
import { Badge, Empty, Section, Spinner, UnverifiedBadge } from '../components/ui'

/** 곡 상세 (§6.5). 메타데이터 + 파트별 영상 + 이 곡을 부른 날짜 이력. */
export default function SongDetail() {
  const { songCode } = useParams()
  const navigate = useNavigate()
  const { data, loading, links, history } = useArchive()

  const song = useMemo(() => {
    const key = decodeURIComponent(songCode ?? '')
    if (!key) return null
    // 곡코드가 없는 곡(악보집 미상)은 표시명으로 찾는다.
    return data.songs.find((s) => s.곡코드 === key) ?? data.songs.find((s) => s.표시명 === key) ?? null
  }, [data.songs, songCode])

  if (loading && !data.songs.length) return <Spinner />
  if (!song) return <Empty title="곡을 찾을 수 없습니다." />

  const book = data.books.find((b) => b.집코드 === song.집코드)
  const songLinks = links.get(song.표시명) ?? []
  const usage = songUsage(song.표시명, history, todayKey(), data.config.중복경고개월)
  const 이력 = history.get(song.표시명) ?? []

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => navigate(-1)} className="text-xs text-stone-500 underline">
        ← 뒤로
      </button>

      <div className={`card p-4 ${song.검증 ? '' : 'opacity-75'}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-extrabold">{song.제목}</h2>
          <span className="text-xs text-stone-400">{song.곡코드}</span>
          {!song.검증 && <UnverifiedBadge />}
        </div>
        {song.원제 && <p className="text-sm text-stone-500">{song.원제}</p>}

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="악보집">
            {book ? (
              <Link to={`/shelf/${encodeURIComponent(book.집코드)}`} className="underline">
                {book.시리즈} {book.권 ?? ''}집 {song.수록번호 != null && `${song.수록번호}번`}
              </Link>
            ) : (
              song.집코드 || '—'
            )}
          </Field>
          <Field label="페이지">{song.페이지 || '—'}</Field>
          <Field label="작사">{song.작사 || '—'}</Field>
          <Field label="작곡">{song.작곡 || '—'}</Field>
          <Field label="편곡">{song.편곡 || '—'}</Field>
          <Field label="성부 · 조성">{[song.성부, song.조성].filter(Boolean).join(' · ') || '—'}</Field>
          <Field label="절기">{song.절기 || '—'}</Field>
          <Field label="난이도">{song.난이도 != null ? `${song.난이도} / 5` : '—'}</Field>
        </dl>

        <div className="mt-3 flex flex-wrap gap-1">
          {song.상태 && <Badge>{song.상태}</Badge>}
          {song.출처 && <Badge>출처 {song.출처}</Badge>}
          {usage.recent && <Badge tone="danger">최근 {usage.monthsAgo}개월 내 부름</Badge>}
        </div>

        {(song.악보스캔URL || song.참고음원URL || song.비고) && (
          <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
            {song.악보스캔URL && (
              <a href={song.악보스캔URL} target="_blank" rel="noreferrer noopener" className="block underline">
                악보 보기
              </a>
            )}
            {song.참고음원URL && (
              <a href={song.참고음원URL} target="_blank" rel="noreferrer noopener" className="block underline">
                참고 음원
              </a>
            )}
            {song.비고 && <p className="text-stone-500">{song.비고}</p>}
          </div>
        )}
      </div>

      <Section title="파트별 영상">
        <PartLinkList links={songLinks} />
      </Section>

      <Section title={`부른 이력 (${이력.length}회)`}>
        {이력.length ? (
          <ul className="card divide-y divide-stone-100 text-sm">
            {이력.map((date) => {
              const service = data.services.find((s) => s.찬양일 === date)
              return (
                <li key={date} className="flex items-center justify-between px-4 py-2">
                  <span>{formatLongDate(date)}</span>
                  <span className="text-xs text-stone-400">{service?.예배구분}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-400">아직 부른 기록이 없습니다.</p>
        )}
      </Section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
