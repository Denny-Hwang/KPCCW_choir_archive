import { useMemo, useState } from 'react'
import { useArchive } from '../lib/useArchive'
import {
  buildCandidates,
  initialPlan,
  parseRehearsalPattern,
  planDifficultyLoad,
  suggestRehearsals,
  type PlannedDate,
} from '../lib/planner'
import { buildRehearsalPaste, buildServicePaste, findDuplicateServiceDates, pasteHeader, REHEARSAL_COLUMNS, SERVICE_COLUMNS } from '../lib/paste'
import { buildMonthlySummary, buildNotice } from '../lib/notice'
import { seasonHintFor, titleOf } from '../lib/derive'
import { formatKoreanTime, formatMonthDay, todayKey, weekdayOf } from '../lib/date'
import { SongPicker } from '../components/SongPicker'
import { CopyBlock, Badge, Section } from '../components/ui'

/**
 * 월간 선곡 (§6.7).
 *
 * 이 화면의 가치는 공지 자동 생성이 아니라 중복 선곡 방지다. 그래서 곡을 고르는
 * 자리에서 "마지막으로 부른 날"이 반드시 보여야 하고, 결과는 화면을 떠나기 전에
 * 붙여넣기 블록(§12.1)으로 손에 쥐어져야 한다. 앱은 시트에 쓰지 않는다.
 */
export default function Planner() {
  const { data, links, songs } = useArchive()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2)
  const [plan, setPlan] = useState<PlannedDate[]>(() =>
    initialPlan(now.getFullYear(), now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2, data.config),
  )
  const [picking, setPicking] = useState<string | null>(null)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const referenceDate = `${monthStr}-01`
  const candidates = useMemo(() => buildCandidates(data, referenceDate, links), [data, links, referenceDate])
  const seasonHint = seasonHintFor(month, data.config)
  const duplicates = findDuplicateServiceDates(plan, data.services)
  const difficultyLoad = planDifficultyLoad(plan, songs)

  function regenerate(nextYear: number, nextMonth: number) {
    setYear(nextYear)
    setMonth(nextMonth)
    setPlan(initialPlan(nextYear, nextMonth, data.config))
  }

  function update(id: string, patch: Partial<PlannedDate>) {
    setPlan((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function addSpecialDate() {
    const 찬양일 = `${monthStr}-01`
    const id = `special-${Date.now()}`
    setPlan((prev) =>
      [
        ...prev,
        {
          id,
          찬양일,
          예배구분: '특별예배',
          곡: [],
          rehearsals: suggestRehearsals(찬양일, parseRehearsalPattern(data.config.연습기본패턴)),
        },
      ].sort((a, b) => a.찬양일.localeCompare(b.찬양일)),
    )
  }

  const noticeEntries = plan.map((date) => ({
    date,
    songs: date.곡.map((표시명) => ({
      표시명,
      제목: titleOf(표시명, songs),
      links: links.get(표시명) ?? [],
    })),
  }))

  const notices = noticeEntries.map((entry) => ({
    찬양일: entry.date.찬양일,
    예배구분: entry.date.예배구분,
    text: buildNotice({
      service: { 찬양일: entry.date.찬양일, 예배구분: entry.date.예배구분 },
      rehearsals: entry.date.rehearsals.map((r) => ({ ...r, 찬양일: entry.date.찬양일, 메모: '' })),
      songs: entry.songs,
      config: data.config,
    }),
  }))

  const summary = buildMonthlySummary(
    monthStr,
    noticeEntries.map((e) => ({ service: e.date, songs: e.songs })),
  )
  const servicePaste = buildServicePaste(plan)
  const rehearsalPaste = buildRehearsalPaste(
    plan.flatMap((d) => d.rehearsals.map((r) => ({ ...r, 찬양일: d.찬양일 }))),
  )

  return (
    <div className="space-y-6">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="plan-year">연도</label>
            <input
              id="plan-year"
              type="number"
              value={year}
              onChange={(e) => regenerate(Number(e.target.value) || year, month)}
              className="field w-24"
            />
          </div>
          <div>
            <label className="label" htmlFor="plan-month">월</label>
            <select
              id="plan-month"
              value={month}
              onChange={(e) => regenerate(year, Number(e.target.value))}
              className="field w-24"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => regenerate(year, month)} className="btn-ghost">
            찬양일 다시 생성
          </button>
          <button type="button" onClick={addSpecialDate} className="btn-ghost">
            특별예배 추가
          </button>
        </div>

        <div className="flex flex-wrap gap-1 text-xs">
          {seasonHint && <Badge>이 달의 절기 힌트: {seasonHint}</Badge>}
          {difficultyLoad != null && (
            <Badge tone={difficultyLoad >= 4 ? 'warn' : 'neutral'}>평균 난이도 {difficultyLoad.toFixed(1)}</Badge>
          )}
          <Badge tone={duplicates.length ? 'danger' : 'neutral'}>
            {duplicates.length ? `시트에 이미 있는 찬양일 ${duplicates.length}건` : '찬양일 중복 없음'}
          </Badge>
        </div>

        {duplicates.length > 0 && (
          <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
            {duplicates.join(', ')} 은(는) 이미 services 시트에 있습니다. 그대로 붙여넣으면 중복 행이 생깁니다.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {plan.map((date) => (
          <PlanCard
            key={date.id}
            date={date}
            onUpdate={(patch) => update(date.id, patch)}
            onPick={() => setPicking(date.id)}
            songTitle={(표시명) => titleOf(표시명, songs)}
            candidates={candidates}
            onRemove={() => setPlan((prev) => prev.filter((d) => d.id !== date.id))}
          />
        ))}
      </div>

      <Section title="공지 (찬양일별)">
        <div className="space-y-3">
          {notices.map((notice) => (
            <div key={notice.찬양일} className="card p-3">
              <p className="mb-2 text-sm font-bold">
                {formatMonthDay(notice.찬양일)} {notice.예배구분}
              </p>
              <pre className="mb-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-mono text-xs leading-relaxed">
                {notice.text}
              </pre>
              <CopyBlock text={notice.text} label="이 공지 복사" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="월 전체 요약">
        <pre className="mb-2 whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-mono text-xs leading-relaxed">
          {summary}
        </pre>
        <CopyBlock text={summary} label="요약 복사" />
      </Section>

      <Section title="시트 붙여넣기 블록">
        <p className="mb-2 text-xs text-stone-500">
          해당 시트의 <strong>마지막 행 다음 칸</strong>을 선택하고 붙여넣으세요.
        </p>
        <div className="space-y-3">
          <PasteBlock title="services" columns={SERVICE_COLUMNS} text={servicePaste} />
          <PasteBlock title="rehearsals" columns={REHEARSAL_COLUMNS} text={rehearsalPaste} />
        </div>
      </Section>

      {picking && (
        <SongPicker
          candidates={candidates}
          books={data.books}
          seasonHint={seasonHint}
          warnMonths={data.config.중복경고개월}
          subtitle={(() => {
            const d = plan.find((x) => x.id === picking)
            return d ? `${formatMonthDay(d.찬양일)} ${d.예배구분}`.trim() : undefined
          })()}
          onClose={() => setPicking(null)}
          onPick={(표시명) => {
            setPlan((prev) =>
              prev.map((d) =>
                d.id === picking && !d.곡.includes(표시명) && d.곡.length < 3 ? { ...d, 곡: [...d.곡, 표시명] } : d,
              ),
            )
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}

function PasteBlock({ title, columns, text }: { title: string; columns: readonly string[]; text: string }) {
  return (
    <div className="card p-3">
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-1 truncate text-[11px] text-stone-400">열 순서: {pasteHeader(columns).replace(/\t/g, ' · ')}</p>
      <pre className="my-2 max-h-40 overflow-auto whitespace-pre rounded-xl bg-stone-50 p-3 font-mono text-[11px]">
        {text || '(선곡을 하면 여기에 나타납니다)'}
      </pre>
      <CopyBlock text={text} label={`${title} 블록 복사`} />
    </div>
  )
}

function PlanCard({
  date,
  onUpdate,
  onPick,
  onRemove,
  songTitle,
  candidates,
}: {
  date: PlannedDate
  onUpdate: (patch: Partial<PlannedDate>) => void
  onPick: () => void
  onRemove: () => void
  songTitle: (표시명: string) => string
  candidates: ReturnType<typeof buildCandidates>
}) {
  const byName = useMemo(() => new Map(candidates.map((c) => [c.song.표시명, c])), [candidates])

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date.찬양일}
          onChange={(e) => onUpdate({ 찬양일: e.target.value })}
          className="field w-auto"
        />
        <span className="text-xs text-stone-400">{weekdayOf(date.찬양일)}요일</span>
        <input
          type="text"
          value={date.예배구분}
          onChange={(e) => onUpdate({ 예배구분: e.target.value })}
          placeholder="예배구분"
          className="field w-32"
        />
        <button type="button" onClick={onRemove} className="ml-auto text-xs text-stone-400 hover:text-rose-600">
          삭제
        </button>
      </div>

      <div className="space-y-2">
        {date.곡.map((표시명, i) => {
          const candidate = byName.get(표시명)
          return (
            <div key={표시명} className="flex items-start justify-between gap-2 rounded-xl bg-stone-50 p-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {date.곡.length > 1 && <span className="mr-1 text-stone-400">{i + 1}.</span>}
                  {songTitle(표시명)}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {candidate?.recent && (
                    <Badge tone="danger">최근 {candidate.monthsAgo}개월 내 부름 · {candidate.lastSung}</Badge>
                  )}
                  {candidate && !candidate.recent && candidate.lastSung && (
                    <Badge>마지막 {candidate.lastSung}</Badge>
                  )}
                  {candidate && !candidate.hasParts && <Badge tone="warn">파트 영상 없음</Badge>}
                  {candidate && !candidate.song.검증 && <Badge tone="warn">미확인 곡</Badge>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onUpdate({ 곡: date.곡.filter((t) => t !== 표시명) })}
                className="shrink-0 text-xs text-stone-400 hover:text-rose-600"
              >
                빼기
              </button>
            </div>
          )
        })}

        {/* 슬롯 3개를 나란히 보여주지 않는다. 3개가 기본인 것처럼 보이면 안 하던 것을 하게 된다 (§7.1). */}
        {date.곡.length < 3 && (
          <button type="button" onClick={onPick} className="btn-ghost w-full">
            {date.곡.length === 0 ? '곡 선택' : '곡 추가'}
          </button>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-stone-500">
          연습 일정 {date.rehearsals.length}회
          {date.rehearsals.length > 0 &&
            ` · ${date.rehearsals.map((r) => `${formatMonthDay(r.연습일)} ${formatKoreanTime(r.시각)}`).join(', ')}`}
        </summary>
        <div className="mt-2 space-y-2">
          {date.rehearsals.map((r, i) => (
            <div key={`${r.연습일}-${i}`} className="flex flex-wrap items-center gap-1">
              <input
                type="date"
                value={r.연습일}
                onChange={(e) =>
                  onUpdate({
                    rehearsals: date.rehearsals.map((x, j) => (j === i ? { ...x, 연습일: e.target.value } : x)),
                  })
                }
                className="field w-auto"
              />
              <input
                type="time"
                value={r.시각}
                onChange={(e) =>
                  onUpdate({
                    rehearsals: date.rehearsals.map((x, j) => (j === i ? { ...x, 시각: e.target.value } : x)),
                  })
                }
                className="field w-24"
              />
              <input
                type="text"
                value={r.구분}
                onChange={(e) =>
                  onUpdate({
                    rehearsals: date.rehearsals.map((x, j) => (j === i ? { ...x, 구분: e.target.value } : x)),
                  })
                }
                placeholder="구분"
                className="field w-20"
              />
              <button
                type="button"
                onClick={() => onUpdate({ rehearsals: date.rehearsals.filter((_, j) => j !== i) })}
                className="text-stone-400 hover:text-rose-600"
              >
                빼기
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              onUpdate({
                rehearsals: [...date.rehearsals, { 연습일: date.찬양일, 시각: '13:30', 구분: '주일', 장소: '' }],
              })
            }
          >
            연습 추가
          </button>
        </div>
      </details>
    </div>
  )
}

export { todayKey }
