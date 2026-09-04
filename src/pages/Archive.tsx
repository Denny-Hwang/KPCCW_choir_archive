import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { groupServicesByMonth, totalAttendance } from '../lib/derive'
import { formatMonth, formatMonthDay, monthKey, todayKey, weekdayOf } from '../lib/date'
import { normalizeLink } from '../lib/youtube'
import { Empty, RecordingLink, Spinner } from '../components/ui'
import { PartLinkChips } from '../components/PartLinks'

/** 월별 아카이브 (§6.2). 연도 경계는 저장이 평면이라 자연히 넘어간다 (§3). */
export default function Archive() {
  const { data, loading, songs, links } = useArchive()
  const groups = useMemo(() => groupServicesByMonth(data.services), [data.services])
  const [open, setOpen] = useState<Set<string>>(() => new Set([monthKey(todayKey())]))
  const [year, setYear] = useState<string>('')

  if (loading && !data.services.length) return <Spinner />
  if (!groups.length) return <Empty title="아직 기록된 찬양이 없습니다." hint="services 시트에 행을 추가해 주세요." />

  const years = [...new Set(groups.map((g) => g.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a))
  const visible = year ? groups.filter((g) => g.month.startsWith(year)) : groups

  function toggle(month: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {data.config.예배영상URL && (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          예배 실황 영상은 교회 홈페이지에 올라옵니다.{' '}
          <RecordingLink fallbackUrl={data.config.예배영상URL} className="font-semibold" />
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setYear('')}
          className={`chip ${year === '' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600'}`}
        >
          전체
        </button>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={`chip ${year === y ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600'}`}
          >
            {y}년
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((group) => {
          const expanded = open.has(group.month)
          return (
            <div key={group.month} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(group.month)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="font-bold">{formatMonth(group.month)}</span>
                <span className="text-xs text-stone-400">
                  {group.services.length}회 {expanded ? '▾' : '▸'}
                </span>
              </button>

              {expanded && (
                <ul className="divide-y divide-stone-100 border-t border-stone-100">
                  {group.services.map((service) => {
                    const total = totalAttendance(service)
                    const record = service.기록영상URL ? normalizeLink(service.기록영상URL, null) : null
                    return (
                      <li key={`${service.찬양일}-${service.예배구분}`} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold">
                            {formatMonthDay(service.찬양일)} ({weekdayOf(service.찬양일)})
                            {service.예배구분 && <span className="ml-1 text-xs font-normal text-stone-400">{service.예배구분}</span>}
                          </p>
                          {total != null && (
                            <p className="shrink-0 text-xs text-stone-500">
                              S{service.S인원 ?? 0} A{service.A인원 ?? 0} T{service.T인원 ?? 0} B{service.B인원 ?? 0} · 총{' '}
                              {total}
                            </p>
                          )}
                        </div>

                        <ul className="mt-1 space-y-0.5">
                          {service.곡.length ? (
                            service.곡.map((표시명) => {
                              const song = songs.get(표시명)
                              return (
                                <li key={표시명} className="text-sm">
                                  {song ? (
                                    <Link to={`/song/${encodeURIComponent(song.곡코드)}`} className="underline decoration-stone-300 underline-offset-2">
                                      {song.제목}
                                    </Link>
                                  ) : (
                                    표시명
                                  )}
                                  {song?.곡코드 && <span className="ml-1 text-xs text-stone-400">{song.곡코드}</span>}
                                  <PartLinkChips
                                    links={links.get(표시명) ?? []}
                                    order={data.config.공지_파트순서}
                                  />
                                </li>
                              )
                            })
                          ) : (
                            <li className="text-sm text-stone-400">선곡 기록 없음</li>
                          )}
                        </ul>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                          {service.세션 && <span>세션 {service.세션}</span>}
                          {record && (
                            <a
                              href={record.shareUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="chip bg-rose-600 text-white hover:brightness-110"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden className="h-2.5 w-2.5 fill-current opacity-80">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              실황영상
                            </a>
                          )}

                          {service.메모 && <span className="text-stone-400">{service.메모}</span>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
