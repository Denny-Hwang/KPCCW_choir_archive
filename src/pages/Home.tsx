import { Link } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { buildNotice, noticeWarnings } from '../lib/notice'
import { buildServiceView, pickFeaturedService, totalAttendance } from '../lib/derive'
import { formatKoreanTime, formatLongDate, formatMonthDay, todayKey } from '../lib/date'
import { PartLinks } from '../components/PartLinks'
import { CopyBlock, Empty, RecordingLink, Section, Spinner } from '../components/ui'

/**
 * 홈 — 다가오는 찬양일 (§6.1).
 * 대원 입장에서 필요한 건 사실상 이 화면뿐이다. 곡, 연습 일정, 파트 버튼, 공지 복사.
 */
export default function Home() {
  const { data, loading, songs, links, rehearsals } = useArchive()
  const today = todayKey()

  if (loading && !data.services.length) return <Spinner />

  const featured = pickFeaturedService(data.services, today)
  if (!featured) {
    return (
      <Empty
        title="아직 등록된 찬양일이 없습니다."
        hint="구글 시트의 services 시트에 찬양일을 한 줄 넣으면 여기에 나타납니다."
      />
    )
  }

  const view = buildServiceView(featured, data)
  const notice = buildNotice({
    service: featured,
    rehearsals: view.rehearsals,
    songs: view.songs,
    config: data.config,
  })
  const warnings = noticeWarnings(view.songs)
  const upcoming = featured.찬양일 >= today

  // 다가오는 찬양이면 이후 3개를 가까운 순으로, 지나간 것뿐이면 직전 3개를 최근 순으로.
  // (양쪽 다 오름차순으로 자르면 지난 찬양에서 가장 오래된 것이 올라온다.)
  const others = data.services
    .filter((s) => (upcoming ? s.찬양일 > featured.찬양일 : s.찬양일 < featured.찬양일))
    .sort((a, b) => (upcoming ? a.찬양일.localeCompare(b.찬양일) : b.찬양일.localeCompare(a.찬양일)))
    .slice(0, 3)

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="bg-stone-800 px-4 py-3 text-white">
          <p className="text-xs opacity-70">{upcoming ? '다가오는 찬양' : '가장 최근 찬양'}</p>
          <p className="text-lg font-extrabold">{formatLongDate(featured.찬양일)}</p>
          {featured.예배구분 && <p className="text-xs opacity-80">{featured.예배구분}</p>}
        </div>

        <div className="space-y-4 p-4">
          {view.songs.length ? (
            view.songs.map((song, i) => (
              <div key={song.표시명} className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  {view.songs.length > 1 && <span className="text-sm font-bold text-stone-400">{i + 1}.</span>}
                  {song.song ? (
                    <Link to={`/song/${encodeURIComponent(song.song.곡코드)}`} className="text-lg font-bold underline decoration-stone-300 underline-offset-4">
                      {song.제목}
                    </Link>
                  ) : (
                    <span className="text-lg font-bold">{song.제목}</span>
                  )}
                  {song.song?.곡코드 && <span className="text-xs text-stone-400">{song.song.곡코드}</span>}
                </div>
                <PartLinks links={song.links} order={data.config.공지_파트순서} />
              </div>
            ))
          ) : (
            <p className="text-sm text-stone-400">선곡이 아직 입력되지 않았습니다.</p>
          )}

          {view.rehearsals.length > 0 && (
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="mb-1 text-xs font-bold text-stone-500">{data.config.공지_연습헤더}</p>
              <ul className="space-y-0.5 text-sm">
                {view.rehearsals.map((r) => (
                  <li key={`${r.연습일}-${r.시각}`}>
                    {formatMonthDay(r.연습일)} {r.구분} {formatKoreanTime(r.시각)}
                    {r.장소 && <span className="text-stone-400"> · {r.장소}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.total != null && (
            <p className="text-xs text-stone-500">
              참석 S{featured.S인원 ?? 0} A{featured.A인원 ?? 0} T{featured.T인원 ?? 0} B{featured.B인원 ?? 0} · 총{' '}
              {view.total}명
            </p>
          )}

          <RecordingLink
            recordingUrl={featured.기록영상URL}
            fallbackUrl={data.config.예배영상URL}
            className="text-xs text-stone-500"
          />
        </div>
      </div>

      <Section title="공지">
        {warnings.length > 0 && (
          <ul className="mb-2 space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            {warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
        <CopyBlock text={notice} label="공지 복사" />
      </Section>

      {others.length > 0 && (
        <Section title={upcoming ? '이후 일정' : '지난 찬양'}>
          <ul className="card divide-y divide-stone-100">
            {others.map((s) => {
              const total = totalAttendance(s)
              const rehearsalCount = (rehearsals.get(s.찬양일) ?? []).length
              return (
                <li key={s.찬양일} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{formatMonthDay(s.찬양일)}</p>
                    <p className="truncate text-xs text-stone-500">
                      {s.곡.map((title) => songs.get(title)?.제목 ?? title).join(' / ') || '선곡 미정'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-stone-400">
                    {total != null
                      ? `총 ${total}명`
                      : rehearsalCount > 0
                        ? `${rehearsalCount}회 연습`
                        : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {!links.size && (
        <p className="text-center text-xs text-stone-400">
          practice_links 시트에 파트 영상을 넣으면 파트 버튼과 공지 링크가 채워집니다.
        </p>
      )}
    </div>
  )
}
