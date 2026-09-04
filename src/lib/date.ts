/** 날짜·시각 표기. 공지 텍스트(§7.2)와 화면이 같은 규칙을 쓴다. */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export function parseDateKey(key: string): Date | null {
  const m = (key ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  // 로컬 자정으로 만든다. new Date('2026-08-23')은 UTC라 KST에서 하루 밀린다.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function monthKey(dateKey: string): string {
  return (dateKey ?? '').slice(0, 7)
}

/** "2026-08-23" → "8월 23일" */
export function formatMonthDay(key: string): string {
  const d = parseDateKey(key)
  return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : key
}

/** "2026-08-23" → "2026년 8월 23일 (일)" */
export function formatLongDate(key: string): string {
  const d = parseDateKey(key)
  if (!d) return key
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`
}

/** "2026-08" → "2026년 8월" */
export function formatMonth(key: string): string {
  const m = (key ?? '').match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}년 ${Number(m[2])}월` : key
}

export function weekdayOf(key: string): string {
  const d = parseDateKey(key)
  return d ? WEEKDAYS[d.getDay()] : ''
}

/**
 * "13:30" → "1시 30분", "20:00" → "8시" (§7.2: 정각은 분 생략).
 * 12시간제로 바꾸되 오전/오후는 붙이지 않는다 — 기존 메모 포맷이 그렇다.
 */
export function formatKoreanTime(hhmm: string): string {
  const m = (hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return (hhmm ?? '').trim()
  const h24 = Number(m[1])
  const minute = Number(m[2])
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return minute === 0 ? `${h12}시` : `${h12}시 ${minute}분`
}

/** 두 날짜 사이의 개월 수 (중복 경고 판정용, §6.7). */
export function monthsBetween(fromKey: string, toKey: string): number | null {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (!from || !to) return null
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/** 해당 월의 모든 주일(일요일) 날짜키. 월간 선곡의 찬양일 자동 생성에 쓴다. */
export function sundaysInMonth(year: number, month: number): string[] {
  const out: string[] = []
  const d = new Date(year, month - 1, 1)
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  while (d.getMonth() === month - 1) {
    out.push(todayKey(d))
    d.setDate(d.getDate() + 7)
  }
  return out
}

/** 기준일에서 N일 전/후. */
export function shiftDays(key: string, delta: number): string {
  const d = parseDateKey(key)
  if (!d) return key
  d.setDate(d.getDate() + delta)
  return todayKey(d)
}

/** 기준일 직전(또는 당일 제외)의 특정 요일. 0=일 … 6=토 */
export function previousWeekday(key: string, weekday: number): string {
  const d = parseDateKey(key)
  if (!d) return key
  let delta = (d.getDay() - weekday + 7) % 7
  if (delta === 0) delta = 7
  d.setDate(d.getDate() - delta)
  return todayKey(d)
}
