/**
 * 월간 선곡 (§6.7).
 *
 * 이 화면의 가치는 공지 자동 생성이 아니라 중복 선곡 방지다.
 * "작년에 부른 곡을 기억 못 하고 다시 고르는" 실수를 데이터로 막는 것이 목적.
 */
import { nthWeekdayOfMonth, previousWeekday, sundaysInMonth } from './date'
import { songUsage, sungHistory } from './derive'
import type { AppConfig, ArchiveData, PracticeLink, Rehearsal, Song } from './types'

export interface PlannedDate {
  id: string
  찬양일: string
  예배구분: string
  곡: string[]
  rehearsals: Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>>
}

/**
 * 연습 기본 패턴. 두 가지 형태를 받는다.
 *
 *   `2주 주일 13:30`  — 그 달의 **둘째 주일**. 연습이 달력에 고정된 경우.
 *   `주일 13:30`      — 찬양일 **직전 주일**. 찬양일이 매주 바뀌던 시절의 형태.
 *
 * 둘을 함께 써도 된다. 앞의 숫자가 있으면 달 기준, 없으면 찬양일 기준이다.
 */
export interface RehearsalPattern {
  구분: string
  weekday: number
  시각: string
  /** 그 달의 몇 번째 요일인지. 없으면 찬양일 직전 요일을 쓴다. */
  주차?: number
}

const WEEKDAY_NAMES: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
  주일: 0, 일요일: 0, 월요일: 1, 화요일: 2, 수요일: 3, 목요일: 4, 금요일: 5, 토요일: 6,
}

export function parseRehearsalPattern(value: string): RehearsalPattern[] {
  const out: RehearsalPattern[] = []
  for (const chunk of (value ?? '').split(',')) {
    const m = chunk.trim().match(/^(?:(\d)\s*주\s+)?(\S+)\s+(\d{1,2}):(\d{2})$/)
    if (!m) continue
    const weekday = WEEKDAY_NAMES[m[2]]
    if (weekday === undefined) continue
    out.push({
      구분: m[2],
      weekday,
      시각: `${m[3].padStart(2, '0')}:${m[4]}`,
      주차: m[1] ? Number(m[1]) : undefined,
    })
  }
  return out
}

/**
 * 찬양일에 딸린 연습일 제안. 같은 날·같은 시각이 겹치면 하나만 남긴다.
 * 찬양일보다 뒤에 오는 날은 버린다 — 부르고 나서 연습할 일은 없다.
 */
export function suggestRehearsals(
  찬양일: string,
  patterns: RehearsalPattern[],
): Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>> {
  const [year, month] = 찬양일.split('-').map(Number)
  const seen = new Set<string>()
  const out: Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>> = []
  for (const pattern of patterns) {
    const 연습일 =
      pattern.주차 && year && month
        ? nthWeekdayOfMonth(year, month, pattern.weekday, pattern.주차)
        : previousWeekday(찬양일, pattern.weekday)
    if (연습일 >= 찬양일) continue
    const key = `${연습일}|${pattern.시각}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ 연습일, 시각: pattern.시각, 구분: pattern.구분, 장소: '' })
  }
  return out.sort((a, b) => a.연습일.localeCompare(b.연습일))
}

/**
 * 대상 월의 찬양일을 자동 생성한다. 특별예배는 화면에서 수동 추가.
 *
 * `config`의 `찬양주일`이 1~5면 그 주의 주일 하나만 만든다(기본 4 = 넷째 주일).
 * 0이나 빈 값이면 그 달의 모든 주일을 만든다 — 매주 부르는 교회를 위한 폴백이다.
 */
export function initialPlan(year: number, month: number, config: AppConfig, 예배구분 = '주일'): PlannedDate[] {
  const patterns = parseRehearsalPattern(config.연습기본패턴)
  const nth = config.찬양주일
  const dates =
    nth >= 1 && nth <= 5 ? [nthWeekdayOfMonth(year, month, 0, nth)] : sundaysInMonth(year, month)
  return dates.map((찬양일) => ({
    id: `${찬양일}-${예배구분}`,
    찬양일,
    예배구분,
    곡: [],
    rehearsals: suggestRehearsals(찬양일, patterns),
  }))
}

export interface SongCandidate {
  song: Song
  lastSung: string | null
  monthsAgo: number | null
  /** 최근 N개월 내 중복. 붉은 배지의 조건 (§6.7). */
  recent: boolean
  linkCount: number
  verifiedLinkCount: number
  /** 선곡 시점에 "연습 자료를 직접 만들어야 함"을 인지시키기 위한 값. */
  hasParts: boolean
}

export function buildCandidates(
  data: ArchiveData,
  referenceDate: string,
  links?: Map<string, PracticeLink[]>,
): SongCandidate[] {
  const history = sungHistory(data.services)
  const linkMap = links ?? new Map<string, PracticeLink[]>()
  return data.songs.map((song) => {
    const usage = songUsage(song.표시명, history, referenceDate, data.config.중복경고개월)
    const songLinks = linkMap.get(song.표시명) ?? []
    const verified = songLinks.filter((l) => l.검증)
    return {
      song,
      lastSung: usage.lastSung,
      monthsAgo: usage.monthsAgo,
      recent: usage.recent,
      linkCount: songLinks.length,
      verifiedLinkCount: verified.length,
      // 반주만 있는 것은 파트 연습 자료가 있다고 보지 않는다.
      hasParts: verified.some((l) => l.파트 !== '반주'),
    }
  })
}

export interface CandidateFilter {
  query: string
  집코드: string
  절기: string
  상태: string
  난이도: string
  검증만: boolean
  중복숨김: boolean
}

export const EMPTY_FILTER: CandidateFilter = {
  query: '',
  집코드: '',
  절기: '',
  상태: '',
  난이도: '',
  검증만: false,
  중복숨김: false,
}

/** 검색어는 제목·원제·작곡·곡코드를 모두 훑는다. 공백은 무시한다. */
function matchesQuery(song: Song, query: string): boolean {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!q) return true
  return [song.제목, song.원제, song.작곡, song.편곡, song.곡코드, song.표시명]
    .join(' ')
    .replace(/\s+/g, '')
    .toLowerCase()
    .includes(q)
}

export function filterCandidates(candidates: SongCandidate[], filter: CandidateFilter): SongCandidate[] {
  return candidates.filter((c) => {
    if (!matchesQuery(c.song, filter.query)) return false
    if (filter.집코드 && c.song.집코드 !== filter.집코드) return false
    if (filter.절기 && c.song.절기 !== filter.절기) return false
    if (filter.상태 && c.song.상태 !== filter.상태) return false
    if (filter.난이도 && String(c.song.난이도 ?? '') !== filter.난이도) return false
    if (filter.검증만 && !c.song.검증) return false
    if (filter.중복숨김 && c.recent) return false
    return true
  })
}

/** 한 달에 어려운 곡이 몰리지 않았는지 (§6.7 난이도 표시의 목적). */
export function planDifficultyLoad(plan: PlannedDate[], songs: Map<string, Song>): number | null {
  const values: number[] = []
  for (const date of plan) {
    for (const 표시명 of date.곡) {
      const level = songs.get(표시명)?.난이도
      if (level != null) values.push(level)
    }
  }
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}
