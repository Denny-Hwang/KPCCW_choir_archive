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

/** 두 날짜 사이의 일수 (to - from). 홈의 "N일 남음" 표시용. */
export function daysBetween(fromKey: string, toKey: string): number | null {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
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

/**
 * 그 달의 N번째 특정 요일. 0=일 … 6=토.
 * 그 달에 N번째가 없으면(다섯째 주일이 없는 달 등) 마지막 것을 준다 — 빈손보다 낫다.
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0).getDate()
  let day = 1 + ((weekday - first.getDay() + 7) % 7) + (Math.max(1, nth) - 1) * 7
  while (day > lastDay) day -= 7
  return todayKey(new Date(year, month - 1, day))
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

/** 연습 구분별 기본 시각. 주일은 예배 후 1시 30분, 수요일은 저녁 8시. */
export const REHEARSAL_DEFAULT_TIME: Record<string, string> = { 주일: '13:30', 수요일: '20:00' }

/** 날짜의 요일이 정하는 연습 구분. 일요일 → 주일, 수요일 → 수요일, 그 밖은 특별. */
export function rehearsalKindOf(key: string): '주일' | '수요일' | '특별' | '' {
  const d = parseDateKey(key)
  if (!d) return ''
  if (d.getDay() === 0) return '주일'
  if (d.getDay() === 3) return '수요일'
  return '특별'
}

/**
 * 날짜와 구분이 어긋났는지. `구분`이 주일/수요일일 때만 요일을 대조한다 — 특별 연습은
 * 아무 요일이나 될 수 있다. 어긋나면 사람이 읽을 문장을, 맞으면 null을 돌려준다.
 */
export function rehearsalMismatch(r: { 연습일: string; 구분: string }): string | null {
  const actual = weekdayOf(r.연습일)
  if (!actual) return null
  if ((r.구분 === '주일' && actual !== '일') || (r.구분 === '수요일' && actual !== '수')) {
    return `${formatMonthDay(r.연습일)}은 ${actual}요일인데 구분이 "${r.구분}"입니다.`
  }
  return null
}

/**
 * 날짜에 맞춰 구분과 기본 시각을 채운 연습. 날짜를 바꿨을 때, 또는 "맞추기"를 눌렀을 때 쓴다.
 * 일요일·수요일이 아니면 특별로 두고 시각은 건드리지 않는다.
 */
export function alignRehearsal<T extends { 연습일: string; 구분: string; 시각: string }>(r: T): T {
  const kind = rehearsalKindOf(r.연습일)
  if (!kind) return r
  return { ...r, 구분: kind, 시각: REHEARSAL_DEFAULT_TIME[kind] ?? r.시각 }
}
