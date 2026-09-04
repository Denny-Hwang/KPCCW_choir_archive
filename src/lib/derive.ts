/** 여러 시트를 가로질러야 나오는 값들. 화면과 공지 생성이 공유한다. */
import { normalizeLink } from './youtube'
import { monthsBetween, monthKey } from './date'
import type { AppConfig, ArchiveData, Part, PracticeLink, Rehearsal, Service, Song } from './types'
import { PART_ORDER } from './types'

/** 표시명 → 곡. 같은 표시명이 둘이면 먼저 나온 행이 이긴다. */
export function songIndex(songs: Song[]): Map<string, Song> {
  const map = new Map<string, Song>()
  for (const song of songs) if (!map.has(song.표시명)) map.set(song.표시명, song)
  return map
}

/** 표시명 → 파트별 링크. 파트 순서는 공지 출력 순서(§4.5)를 따른다. */
export function linkIndex(links: PracticeLink[]): Map<string, PracticeLink[]> {
  const map = new Map<string, PracticeLink[]>()
  for (const link of links) {
    const list = map.get(link.표시명) ?? []
    list.push(link)
    map.set(link.표시명, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => partRank(a.파트) - partRank(b.파트))
  }
  return map
}

export function partRank(part: string): number {
  const i = (PART_ORDER as string[]).indexOf(part)
  return i === -1 ? PART_ORDER.length : i
}

/** 찬양일 → 연습 행들 (날짜순). */
export function rehearsalIndex(rehearsals: Rehearsal[]): Map<string, Rehearsal[]> {
  const map = new Map<string, Rehearsal[]>()
  for (const r of rehearsals) {
    const list = map.get(r.찬양일) ?? []
    list.push(r)
    map.set(r.찬양일, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.연습일.localeCompare(b.연습일) || a.시각.localeCompare(b.시각))
  }
  return map
}

/** 표시명 → 그 곡을 부른 찬양일 목록 (최신순). 중복 선곡 경고의 근거 (§6.7). */
export function sungHistory(services: Service[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const service of services) {
    for (const title of service.곡) {
      const list = map.get(title) ?? []
      list.push(service.찬양일)
      map.set(title, list)
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.localeCompare(a))
  return map
}

export interface SongUsage {
  lastSung: string | null
  count: number
  /** 중복경고개월 이내에 부른 적이 있는가. */
  recent: boolean
  monthsAgo: number | null
}

export function songUsage(
   표시명: string,
  history: Map<string, string[]>,
  referenceDate: string,
  warnMonths: number,
): SongUsage {
  const dates = history.get(표시명) ?? []
  // 기준일 이후(=아직 부르지 않은 예정)는 이력으로 세지 않는다.
  const past = dates.filter((d) => d <= referenceDate)
  const lastSung = past[0] ?? null
  const monthsAgo = lastSung ? monthsBetween(lastSung, referenceDate) : null
  return {
    lastSung,
    count: past.length,
    recent: monthsAgo != null && monthsAgo < warnMonths,
    monthsAgo,
  }
}

/** 공지에 실을 수 있는 링크만. 미검증은 제외한다 (§9.3). */
export function verifiedLinks(links: PracticeLink[]): PracticeLink[] {
  return links.filter((l) => l.검증 && !!l.URL)
}

/** 파트별로 첫 번째 링크 하나씩. 같은 파트에 여러 개면 검증된 것을 먼저 쓴다. */
export function linksByPart(links: PracticeLink[], order: Part[]): Array<{ part: Part; link: PracticeLink }> {
  const out: Array<{ part: Part; link: PracticeLink }> = []
  for (const part of order) {
    const hit = links.find((l) => l.파트 === part)
    if (hit) out.push({ part, link: hit })
  }
  return out
}

export function totalAttendance(service: Service): number | null {
  const parts = [service.S인원, service.A인원, service.T인원, service.B인원]
  if (parts.every((p) => p == null)) return null
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0)
}

/** 표시명에서 곡 제목만. songs에 없는 표시명(오타·삭제)도 읽을 수 있게 한다. */
export function titleOf(표시명: string, songs: Map<string, Song>): string {
  const song = songs.get(표시명)
  if (song?.제목) return song.제목
  return 표시명.replace(/\s*\([^()]*\)\s*$/, '').trim() || 표시명
}

export interface ServiceView {
  service: Service
  rehearsals: Rehearsal[]
  songs: Array<{
    표시명: string
    제목: string
    song: Song | null
    links: PracticeLink[]
    /** 검증되지 않아 공지에서 빠진 링크 수 (§7.2 경고용). */
    unverifiedCount: number
  }>
  total: number | null
}

export function buildServiceView(service: Service, data: ArchiveData): ServiceView {
  const songs = songIndex(data.songs)
  const links = linkIndex(data.practiceLinks)
  const rehearsals = rehearsalIndex(data.rehearsals).get(service.찬양일) ?? []
  return {
    service,
    rehearsals,
    songs: service.곡.map((표시명) => {
      const all = links.get(표시명) ?? []
      return {
        표시명,
        제목: titleOf(표시명, songs),
        song: songs.get(표시명) ?? null,
        links: all,
        unverifiedCount: all.filter((l) => !l.검증).length,
      }
    }),
    total: totalAttendance(service),
  }
}

/** 다가오는 찬양일. 없으면 가장 최근 것 (§6.1). */
export function pickFeaturedService(services: Service[], todayKey: string): Service | null {
  if (!services.length) return null
  const sorted = [...services].sort((a, b) => a.찬양일.localeCompare(b.찬양일))
  return sorted.find((s) => s.찬양일 >= todayKey) ?? sorted[sorted.length - 1]
}

/** 월별로 묶어 최신 달이 위로. */
export function groupServicesByMonth(services: Service[]): Array<{ month: string; services: Service[] }> {
  const map = new Map<string, Service[]>()
  for (const s of services) {
    const key = monthKey(s.찬양일)
    const list = map.get(key) ?? []
    list.push(s)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => ({
      month,
      services: list.sort((a, b) => b.찬양일.localeCompare(a.찬양일)),
    }))
}

export function seasonHintFor(month: number, config: AppConfig): string {
  return config.절기힌트[month] ?? ''
}

/** 링크 중 유튜브 ID를 못 뽑은 것 (§8 경고 목록). */
export function brokenLinks(links: PracticeLink[]): PracticeLink[] {
  return links.filter((l) => normalizeLink(l.URL, l.시작초).unrecognized)
}
