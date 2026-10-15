import { Link } from 'react-router-dom'
import { useArchive } from '../lib/useArchive'
import { buildReadiness, type CheckStatus, type PartState } from '../lib/readiness'
import { buildNotice } from '../lib/notice'
import { buildServiceView, songPath } from '../lib/derive'
import { formatKoreanTime, formatLongDate, formatMonthDay, todayKey, weekdayOf } from '../lib/date'
import { getNoticeCopiedAt, markNoticeCopied } from '../lib/api'
import { AlertCircleIcon, CheckCircleIcon } from '../components/icons'
import { CopyBlock, Empty, Section, Spinner } from '../components/ui'
import { useState } from 'react'

const STATUS_COLOR: Record<CheckStatus, string> = {
  ok: 'text-emerald-600',
  warn: 'text-amber-500',
  todo: 'text-rose-500',
}

const PART_SKIN: Record<PartState, string> = {
  verified: 'bg-emerald-100 text-emerald-800',
  unverified: 'bg-amber-100 text-amber-800',
  missing: 'bg-stone-100 text-stone-400 line-through',
}

const PART_LABEL: Record<PartState, string> = { verified: '확인됨', unverified: '확인 대기', missing: '없음' }

/**
 * 이번 주 준비 상태 — 총무·지휘자가 매주 이것 하나만 보면 되게 한다.
 *
 * 곡이 정해졌는지, 파트 영상이 다섯 개 다 있고 확인됐는지, 연습 일정이 있는지,
 * 공지를 보냈는지(이 기기에서 복사했는지)를 한 장에. 손볼 것은 그 자리로 가는 링크를 단다.
 * 탭에 두지 않는다 — 대원에게는 의미 없는 화면이다. 홈의 공지 아래와 선곡 화면에서 연다.
 */
export default function Ready() {
  const { data, loading } = useArchive()
  const today = todayKey()
  const featured = data.services.filter((s) => s.찬양일 >= today).sort((a, b) => a.찬양일.localeCompare(b.찬양일))[0]
  const [copiedAt, setCopiedAt] = useState<string | null>(() => (featured ? getNoticeCopiedAt(featured.찬양일) : null))

  if (loading && !data.services.length) return <Spinner />

  const r = buildReadiness(data, today, featured ? copiedAt ?? getNoticeCopiedAt(featured.찬양일) : null)

  if (!r.service) {
    return (
      <div className="space-y-4">
        <Empty title="다음 찬양일이 아직 없습니다." hint="선곡 화면에서 다음 달 찬양을 정하면 여기에 준비 상태가 나옵니다." />
        <Link to="/planner" className="btn-primary w-full">선곡하러 가기</Link>
      </div>
    )
  }

  const service = r.service
  const view = buildServiceView(service, data)
  const notice = buildNotice({ service, rehearsals: view.rehearsals, songs: view.songs, config: data.config })

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className={`px-4 py-3 text-white ${r.open ? 'bg-stone-800' : 'bg-emerald-700'}`}>
          <p className="text-sm opacity-75">이번 주 준비 상태</p>
          <p className="text-xl font-extrabold">{formatLongDate(service.찬양일)}</p>
          <p className="text-sm opacity-85">
            {r.daysLeft === 0 ? '오늘' : `${r.daysLeft}일 남음`} ·{' '}
            {r.open ? `손볼 것 ${r.open}개` : '모두 준비됐습니다'}
          </p>
        </div>
        <ul className="divide-y divide-stone-100">
          {r.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 px-4 py-3">
              <span className={STATUS_COLOR[c.status]}>
                {c.status === 'ok' ? <CheckCircleIcon className="h-7 w-7" /> : <AlertCircleIcon className="h-7 w-7" />}
              </span>
              <div className="min-w-0">
                <p className="text-base font-bold">{c.label}</p>
                <p className="text-sm text-stone-600">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {r.songs.length > 0 && (
        <Section title="곡별 파트 영상">
          <ul className="space-y-3">
            {r.songs.map((s) => (
              <li key={s.표시명} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-lg font-bold">{s.제목}</p>
                  {s.song && (
                    <Link to={songPath(s.song)} className="shrink-0 text-sm text-stone-500 underline">
                      확인·추가하기
                    </Link>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.parts.map(({ part, state }) => (
                    <span key={part} className={`chip ${PART_SKIN[state]}`} title={PART_LABEL[state]}>
                      {part}
                      <span className="text-[12px] opacity-80">{PART_LABEL[state]}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="연습 일정">
        {r.rehearsals.length ? (
          <ul className="card divide-y divide-stone-100 text-[15px]">
            {r.rehearsals.map((x) => {
              const past = x.연습일 < today
              const next = r.nextRehearsal === x
              return (
                <li
                  key={`${x.연습일}-${x.시각}`}
                  className={`flex items-center justify-between px-4 py-2.5 ${past ? 'text-stone-400 line-through' : ''} ${next ? 'font-bold' : ''}`}
                >
                  <span>
                    {formatMonthDay(x.연습일)} ({weekdayOf(x.연습일)}) {x.구분} {formatKoreanTime(x.시각)}
                  </span>
                  {next && <span className="chip bg-stone-800 text-xs text-white">다음 연습</span>}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">
            연습 일정이 없습니다. 곡 화면의 <b>다음 찬양으로</b>나 선곡 화면에서 넣을 수 있습니다.
          </p>
        )}
      </Section>

      <Section title="공지">
        <CopyBlock
          text={notice}
          label="공지 복사"
          onCopied={() => {
            markNoticeCopied(service.찬양일)
            setCopiedAt(new Date().toISOString())
          }}
        />
      </Section>
    </div>
  )
}
