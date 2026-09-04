/**
 * 월간 선곡 (§6.7).
 *
 * 이 화면의 가치는 공지 자동 생성이 아니라 중복 선곡 방지다.
 * "작년에 부른 곡을 기억 못 하고 다시 고르는" 실수를 데이터로 막는 것이 목적.
 */
import { previousWeekday, sundaysInMonth } from './date'
import { songUsage, sungHistory } from './derive'
import type { AppConfig, ArchiveData, PracticeLink, Rehearsal, Song } from './types'

export interface PlannedDate {
  id: string
  찬양일: string
  예배구분: string
  곡: string[]
  rehearsals: Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>>
}

/** "주일 13:30, 수요일 20:00" → 파싱된 패턴. 잘못된 항목은 조용히 버린다. */
export interface RehearsalPattern {
  구분: string
  weekday: number
  시각: string
}

const WEEKDAY_NAMES: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
  주일: 0, 일요일: 0, 월요일: 1, 화요일: 2, 수요일: 3, 목요일: 4, 금요일: 5, 토요일: 6,
}

export function parseRehearsalPattern(value: string): RehearsalPattern[] {
  const out: RehearsalPattern[] = []
  for (const chunk of (value ?? '').split(',')) {
    const m = chunk.trim().match(/^(\S+)\s+(\d{1,2}):(\d{2})$/)
    if (!m) continue
    const weekday = WEEKDAY_NAMES[m[1]]
    if (weekday === undefined) continue
    out.push({ 구분: m[1], weekday, 시각: `${m[2].padStart(2, '0')}:${m[3]}` })
  }
  return out
}

/** 찬양일 직전의 각 패턴 요일. 같은 날이 겹치면 하나만 남긴다. */
export function suggestRehearsals(
  찬양일: string,
  patterns: RehearsalPattern[],
): Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>> {
  const seen = new Set<string>()
  const out: Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>> = []
  for (const pattern of patterns) {
    const 연습일 = previousWeekday(찬양일, pattern.weekday)
    const key = `${연습일}|${pattern.시각}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ 연습일, 시각: pattern.시각, 구분: pattern.구분, 장소: '' })
  }
  return out.sort((a, b) => a.연습일.localeCompare(b.연습일))
}

/** 대상 월의 주일을 찬양일로 자동 생성한다. 특별예배는 화면에서 수동 추가. */
export function initialPlan(year: number, month: number, config: AppConfig, 예배구분 = '주일'): PlannedDate[] {
  const patterns = parseRehearsalPattern(config.연습기본패턴)
  return sundaysInMonth(year, month).map((찬양일) => ({
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
