/**
 * 원본 JSON(한글 헤더 키) → 도메인 모델 변환.
 *
 * 시트는 5명이 동시에 편집한다. 열이 사라지거나, 숫자 칸에 글자가 들어오거나,
 * 날짜가 Date 직렬화 결과로 내려오는 일이 일상적으로 일어난다.
 * 그래서 이 파일의 모든 변환은 실패 대신 빈 값으로 떨어진다 — 한 행의 오타 때문에
 * 주일 아침에 앱 전체가 하얗게 뜨는 것이 최악의 결과다.
 */
import {
  type AppConfig,
  type ArchiveData,
  type Book,
  type Part,
  type PracticeLink,
  type RawPayload,
  type RawRow,
  type Rehearsal,
  type Service,
  type Song,
  type SongStatus,
  type SourceTag,
  PART_ORDER,
} from './types'

export function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return ''
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = str(v).replace(/[^\d.-]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 시트 체크박스(true/false), 문자열 TRUE/예/Y/1 을 모두 받는다. 기본값은 false. */
export function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = str(v).toLowerCase()
  return s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === '예' || s === 'o'
}

/**
 * 시트의 시간대.
 *
 * Apps Script는 Date 셀을 UTC 기준 ISO로 직렬화한다. PDT(UTC-7) 자정은 같은 날
 * 07:00Z가 되므로 날짜가 밀리지 않지만, PST(UTC-8)로 넘어간 겨울에도 마찬가지고
 * 반대로 UTC+ 지역이면 하루가 밀린다. 어느 쪽이든 시간대를 알아야 정확하다.
 *
 * 1차 방어는 서버(Code.gs)가 시트 시간대로 포맷한 문자열을 내려주는 것이고,
 * 이건 2차 방어다. config 시트의 `시간대` 키로 바꿀 수 있다.
 */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles'

/** 알 수 없는 IANA 이름이면 Intl이 예외를 던진다. 그때는 기본값으로 되돌린다. */
function safeTimeZone(tz: string | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** 순간(instant)을 시트 시간대의 연/월/일/시/분으로 읽는다. */
function partsInZone(date: Date, tz: string): { y: string; m: string; d: string; hh: string; mm: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value
  return {
    y: parts.year ?? '',
    m: parts.month ?? '',
    d: parts.day ?? '',
    // Intl은 자정을 '24'로 낼 수 있다.
    hh: (parts.hour ?? '').replace(/^24$/, '00'),
    mm: parts.minute ?? '',
  }
}

/** 무엇이 들어와도 YYYY-MM-DD로 만든다. 읽을 수 없으면 빈 문자열. */
export function dateKey(v: unknown, tz: string = DEFAULT_TIMEZONE): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  }
  const s = str(v)
  if (!s) return ''

  // 시각이 붙은 ISO는 순간이므로 시트 시간대로 환산한다.
  const instant = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  if (instant) {
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) {
      const { y, m, d } = partsInZone(parsed, safeTimeZone(tz))
      return `${y}-${m}-${d}`
    }
  }

  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`

  const slash = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/)
  if (slash) return `${slash[1]}-${pad2(Number(slash[2]))}-${pad2(Number(slash[3]))}`

  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
  }
  return ''
}

/** 시각을 HH:MM으로. Date 직렬화 결과와 "13:30", "1:30 PM", "오후 1시 30분"을 받는다. */
export function timeKey(v: unknown, tz: string = DEFAULT_TIMEZONE): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${pad2(v.getHours())}:${pad2(v.getMinutes())}`
  }
  const s = str(v)
  if (!s) return ''

  // 시각 전용 셀은 1899-12-30(시트 에폭) 기준 ISO로 내려온다. 그 시절에는 표준시가
  // 아직 지금 형태가 아니어서(로스앤젤레스는 LMT -07:52:58) 고정 오프셋으로 계산하면 틀린다.
  // 같은 시간대 규칙으로 되돌려야만 값이 맞으므로, 여기서도 로컬이 아닌 시트 시간대로 환산한다.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) {
      const { hh, mm } = partsInZone(parsed, safeTimeZone(tz))
      return `${hh}:${mm}`
    }
  }

  const ampm = s.match(/(오전|오후|AM|PM|am|pm)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?/)
  if (ampm) {
    let h = Number(ampm[2])
    const m = Number(ampm[3] ?? 0)
    const marker = (ampm[1] ?? '').toLowerCase()
    if ((marker === '오후' || marker === 'pm') && h < 12) h += 12
    if ((marker === '오전' || marker === 'am') && h === 12) h = 0
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`
  }
  const bare = s.match(/^(\d{1,2})\s*시$/)
  if (bare) return `${pad2(Number(bare[1]))}:00`
  return s
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 헤더 이름이 흔들려도(공백·괄호·언더스코어) 같은 열로 본다.
 * "S인원"과 "S 인원", "찬양일"과 "찬양일 "이 다른 열이 되면 안 된다.
 */
function normalizeKey(key: string): string {
  return key.replace(/[\s_()（）]/g, '').toLowerCase()
}

function pick(row: RawRow, ...names: string[]): unknown {
  for (const name of names) {
    if (name in row) return row[name]
  }
  const normalized = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) normalized.set(normalizeKey(k), v)
  for (const name of names) {
    const hit = normalized.get(normalizeKey(name))
    if (hit !== undefined) return hit
  }
  return undefined
}

const SONG_STATUSES: SongStatus[] = ['후보', '예정', '연습중', '부름', '보류']
const SOURCE_TAGS: SourceTag[] = ['namuwiki', 'official', 'ocr', 'manual', 'youtube_api', 'youtube_channel']

function asStatus(v: unknown): SongStatus | '' {
  const s = str(v)
  return (SONG_STATUSES as string[]).includes(s) ? (s as SongStatus) : ''
}

function asSource(v: unknown): SourceTag | '' {
  const s = str(v).toLowerCase()
  return (SOURCE_TAGS as string[]).includes(s) ? (s as SourceTag) : ''
}

export function parseBook(row: RawRow): Book {
  return {
    집코드: str(pick(row, '집코드')),
    시리즈: str(pick(row, '시리즈')),
    권: num(pick(row, '권')),
    편저: str(pick(row, '편저')),
    출판사: str(pick(row, '출판사')),
    출판연도: num(pick(row, '출판연도')),
    성부: str(pick(row, '성부')),
    표지색: str(pick(row, '표지색')),
    보유: bool(pick(row, '보유')),
    보관위치: str(pick(row, '보관위치')),
    공식상품URL: str(pick(row, '공식상품URL')),
    미리듣기URL: str(pick(row, '미리듣기URL')),
    파트연습실URL: str(pick(row, '파트연습실URL')),
    참고문서URL: str(pick(row, '참고문서URL')),
    비고: str(pick(row, '비고')),
  }
}

export function parseSong(row: RawRow): Song {
  const 제목 = str(pick(row, '제목'))
  const 곡코드 = str(pick(row, '곡코드'))
  return {
    곡코드,
    // 표시명은 시트 수식이 만들지만, 수식이 깨진 행도 앱에서는 살려 쓴다.
    표시명: str(pick(row, '표시명')) || (곡코드 ? `${제목} (${곡코드})` : 제목),
    제목,
    원제: str(pick(row, '원제')),
    집코드: str(pick(row, '집코드')),
    수록번호: num(pick(row, '수록번호')),
    페이지: str(pick(row, '페이지')),
    작사: str(pick(row, '작사')),
    작곡: str(pick(row, '작곡')),
    편곡: str(pick(row, '편곡')),
    성부: str(pick(row, '성부')),
    조성: str(pick(row, '조성')),
    절기: str(pick(row, '절기')),
    난이도: num(pick(row, '난이도')),
    상태: asStatus(pick(row, '상태')),
    참고음원URL: str(pick(row, '참고음원URL')),
    악보스캔URL: str(pick(row, '악보스캔URL')),
    출처: asSource(pick(row, '출처')),
    검증: bool(pick(row, '검증')),
    비고: str(pick(row, '비고')),
  }
}

export function parseService(row: RawRow, tz: string = DEFAULT_TIMEZONE): Service {
  const 곡 = [str(pick(row, '곡1')), str(pick(row, '곡2')), str(pick(row, '곡3'))].filter(Boolean)
  return {
    찬양일: dateKey(pick(row, '찬양일'), tz),
    예배구분: str(pick(row, '예배구분')),
    곡,
    S인원: num(pick(row, 'S인원')),
    A인원: num(pick(row, 'A인원')),
    T인원: num(pick(row, 'T인원')),
    B인원: num(pick(row, 'B인원')),
    세션: str(pick(row, '세션')),
    기록영상URL: str(pick(row, '기록영상URL')),
    메모: str(pick(row, '메모')),
  }
}

export function parseRehearsal(row: RawRow, tz: string = DEFAULT_TIMEZONE): Rehearsal {
  return {
    찬양일: dateKey(pick(row, '찬양일'), tz),
    연습일: dateKey(pick(row, '연습일'), tz),
    시각: timeKey(pick(row, '시각'), tz),
    구분: str(pick(row, '구분')),
    장소: str(pick(row, '장소')),
    메모: str(pick(row, '메모')),
  }
}

export function parsePracticeLink(row: RawRow): PracticeLink {
  return {
    표시명: str(pick(row, '표시명')),
    파트: str(pick(row, '파트')),
    URL: str(pick(row, 'URL', '주소')),
    시작초: num(pick(row, '시작초')),
    올린이: str(pick(row, '올린이')),
    출처: asSource(pick(row, '출처')),
    검증: bool(pick(row, '검증')),
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  공지_제목형식: '{M}월 {D}일 주일 찬양',
  공지_연습헤더: '<성가연습 일정>',
  공지_곡목표시: false,
  공지_빈줄구분: false,
  공지_파트순서: [...PART_ORDER],
  앱_제목: '성가대 아카이브',
  시간대: DEFAULT_TIMEZONE,
  유튜브채널핸들: 'JandAArt',
  연습기본패턴: '주일 13:30, 수요일 20:00',
  중복경고개월: 12,
  절기힌트: { 1: '일반', 3: '사순', 4: '부활', 10: '추수감사', 11: '대림', 12: '성탄' },
  raw: {},
}

/** "1:일반, 3:사순" → { 1: '일반', 3: '사순' } */
export function parseSeasonHints(value: string): Record<number, string> {
  const out: Record<number, string> = {}
  for (const chunk of value.split(',')) {
    const [rawMonth, ...rest] = chunk.split(':')
    const month = Number(rawMonth?.trim())
    const label = rest.join(':').trim()
    if (month >= 1 && month <= 12 && label) out[month] = label
  }
  return out
}

export function parseConfig(input: RawRow[] | Record<string, unknown> | undefined): AppConfig {
  const raw: Record<string, string> = {}
  if (Array.isArray(input)) {
    for (const row of input) {
      const key = str(pick(row, '키', 'key'))
      if (key) raw[key] = str(pick(row, '값', 'value'))
    }
  } else if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) raw[k] = str(v)
  }

  const parts = (raw['공지_파트순서'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p): p is Part => (PART_ORDER as string[]).includes(p))

  const 중복경고개월 = num(raw['중복경고개월'])
  const hints = raw['절기힌트'] ? parseSeasonHints(raw['절기힌트']) : DEFAULT_CONFIG.절기힌트

  return {
    공지_제목형식: raw['공지_제목형식'] || DEFAULT_CONFIG.공지_제목형식,
    공지_연습헤더: raw['공지_연습헤더'] || DEFAULT_CONFIG.공지_연습헤더,
    공지_곡목표시: bool(raw['공지_곡목표시']),
    공지_빈줄구분: bool(raw['공지_빈줄구분']),
    공지_파트순서: parts.length ? parts : DEFAULT_CONFIG.공지_파트순서,
    앱_제목: raw['앱_제목'] || DEFAULT_CONFIG.앱_제목,
    시간대: safeTimeZone(raw['시간대']),
    유튜브채널핸들: raw['유튜브채널핸들'] || DEFAULT_CONFIG.유튜브채널핸들,
    연습기본패턴: raw['연습기본패턴'] || DEFAULT_CONFIG.연습기본패턴,
    중복경고개월: 중복경고개월 && 중복경고개월 > 0 ? 중복경고개월 : DEFAULT_CONFIG.중복경고개월,
    절기힌트: Object.keys(hints).length ? hints : DEFAULT_CONFIG.절기힌트,
    raw,
  }
}

function rows(v: unknown): RawRow[] {
  return Array.isArray(v) ? v.filter((r): r is RawRow => !!r && typeof r === 'object') : []
}

export function parsePayload(payload: RawPayload | null | undefined): ArchiveData {
  const p = payload ?? {}
  // 날짜·시각 해석이 시간대에 의존하므로 config를 먼저 읽는다.
  const config = parseConfig(Array.isArray(p.config) ? rows(p.config) : (p.config as Record<string, unknown>))
  const tz = config.시간대
  return {
    updatedAt: str(p.updatedAt),
    books: rows(p.books).map(parseBook).filter((b) => b.집코드),
    songs: rows(p.songs).map(parseSong).filter((s) => s.표시명),
    services: rows(p.services).map((row) => parseService(row, tz)).filter((s) => s.찬양일),
    rehearsals: rows(p.rehearsals).map((row) => parseRehearsal(row, tz)).filter((r) => r.찬양일 && r.연습일),
    practiceLinks: rows(p.practiceLinks ?? p.practice_links)
      .map(parsePracticeLink)
      .filter((l) => l.표시명 && l.URL),
    config,
  }
}
