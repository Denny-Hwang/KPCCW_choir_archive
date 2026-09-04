/**
 * 공지 텍스트 생성 (§7).
 *
 * 기존 메모 포맷을 글자 단위로 재현하는 것이 목표다. 대원들이 포맷 변화를
 * 느끼면 안 되므로, 여기서의 "개선"은 전부 회귀다. 형식을 바꾸려면 config를 통해야 한다.
 */
import { formatKoreanTime, formatMonthDay, parseDateKey } from './date'
import { linksByPart, verifiedLinks } from './derive'
import { normalizeLink } from './youtube'
import type { AppConfig, Part, PracticeLink, Rehearsal, Service, Song } from './types'

export interface NoticeSongInput {
  표시명: string
  제목: string
  links: PracticeLink[]
}

export interface NoticeInput {
  service: Pick<Service, '찬양일' | '예배구분'>
  rehearsals: Rehearsal[]
  songs: NoticeSongInput[]
  config: AppConfig
}

/**
 * 제목 형식의 치환자.
 * 기본값 `{M}월 {D}일 주일 찬양`은 그대로 두고, 성탄·부활처럼 예배구분이 다른 날은
 * config에서 `{M}월 {D}일 {구분} 찬양` 식으로 바꿔 쓸 수 있게 열어둔다.
 */
export function formatTitle(format: string, service: Pick<Service, '찬양일' | '예배구분'>): string {
  const d = parseDateKey(service.찬양일)
  const replacements: Record<string, string> = {
    '{YYYY}': d ? String(d.getFullYear()) : '',
    '{M}': d ? String(d.getMonth() + 1) : '',
    '{D}': d ? String(d.getDate()) : '',
    '{구분}': service.예배구분,
    '{예배구분}': service.예배구분,
  }
  let out = format
  for (const [token, value] of Object.entries(replacements)) {
    out = out.split(token).join(value)
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** "9일 주일 1시 30분" — 일(日)만, 요일은 `구분` 열 값을 그대로 쓴다 (§7.2). */
export function formatRehearsalLine(rehearsal: Rehearsal): string {
  const d = parseDateKey(rehearsal.연습일)
  const day = d ? `${d.getDate()}일` : rehearsal.연습일
  const time = formatKoreanTime(rehearsal.시각)
  return [day, rehearsal.구분, time].filter(Boolean).join(' ')
}

function partBlocks(links: PracticeLink[], order: Part[]): string[] {
  const lines: string[] = []
  // 미검증 링크는 공지에서 제외한다 (§9.3). 링크 없는 파트는 블록 자체를 생략한다 (§7.2).
  for (const { part, link } of linksByPart(verifiedLinks(links), order)) {
    lines.push(`(${part})`)
    lines.push(normalizeLink(link.URL, link.시작초).shareUrl)
  }
  return lines
}

/**
 * 곡 수에서 자동으로 분기한다 (§7.1). config 설정이 아니라 파생값이다 —
 * 곡이 2개 이상이면 곡명 헤더 없이는 어느 링크가 어느 곡인지 알 수 없기 때문에,
 * 총무가 매번 판단할 문제가 아니다.
 */
export function buildNotice(input: NoticeInput): string {
  const { service, rehearsals, songs, config } = input
  const lines: string[] = []
  // 기존 메모(§7 예시)에는 구역 사이 빈 줄이 없다. 그대로 재현하는 것이 기본이고,
  // 빈 줄을 넣고 싶은 총무를 위해 config로만 열어둔다.
  const gap = () => {
    if (config.공지_빈줄구분 && lines.length) lines.push('')
  }

  lines.push(formatTitle(config.공지_제목형식, service))

  const multi = songs.length >= 2

  // 1곡일 때만 곡목표시 설정을 따른다. 다곡은 아래에서 번호 헤더로 항상 표시된다.
  if (!multi && config.공지_곡목표시 && songs[0]?.제목) {
    lines.push(songs[0].제목)
  }

  gap()
  lines.push(config.공지_연습헤더)
  for (const rehearsal of [...rehearsals].sort((a, b) => a.연습일.localeCompare(b.연습일))) {
    lines.push(formatRehearsalLine(rehearsal))
  }

  if (multi) {
    songs.forEach((song, i) => {
      const blocks = partBlocks(song.links, config.공지_파트순서)
      if (!blocks.length) return
      gap()
      lines.push(`${i + 1}. ${song.제목}`)
      lines.push(...blocks)
    })
  } else {
    const blocks = partBlocks(songs[0]?.links ?? [], config.공지_파트순서)
    if (blocks.length) {
      gap()
      lines.push(...blocks)
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** 공지에서 빠진 미검증 링크를 화면에 알리기 위한 요약 (§7.2). */
export function noticeWarnings(songs: NoticeSongInput[]): string[] {
  const warnings: string[] = []
  for (const song of songs) {
    const unverified = song.links.filter((l) => !l.검증)
    if (unverified.length) {
      warnings.push(
        `${song.제목}: 미검증 링크 ${unverified.length}개(${unverified.map((l) => l.파트).join(', ')})가 공지에서 제외됨`,
      )
    }
    const broken = song.links.filter((l) => normalizeLink(l.URL, l.시작초).unrecognized)
    if (broken.length) {
      warnings.push(`${song.제목}: 유튜브 주소를 인식하지 못한 링크 ${broken.length}개`)
    }
    if (!verifiedLinks(song.links).length) {
      warnings.push(`${song.제목}: 공지에 넣을 파트 영상이 없음`)
    }
  }
  return warnings
}

/** 월 전체 요약본 (§6.7). 주별 공지와 별도로 한 장에 담는다. */
export function buildMonthlySummary(
  month: string,
  entries: Array<{ service: Pick<Service, '찬양일' | '예배구분'>; songs: Array<{ 제목: string }> }>,
): string {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  const heading = m ? `${m[1]}년 ${Number(m[2])}월 찬양 일정` : `${month} 찬양 일정`
  const lines = [heading, '']
  for (const entry of [...entries].sort((a, b) => a.service.찬양일.localeCompare(b.service.찬양일))) {
    const titles = entry.songs.map((s) => s.제목).filter(Boolean)
    const label = [formatMonthDay(entry.service.찬양일), entry.service.예배구분].filter(Boolean).join(' ')
    lines.push(`${label} — ${titles.length ? titles.join(' / ') : '(미정)'}`)
  }
  return lines.join('\n').trimEnd()
}

/** 곡 상세·라이브러리에서 쓰는 한 줄 표기. */
export function songSubtitle(song: Song): string {
  return [song.작곡 && `작곡 ${song.작곡}`, song.편곡 && `편곡 ${song.편곡}`, song.조성, song.성부]
    .filter(Boolean)
    .join(' · ')
}
