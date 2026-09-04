/**
 * 앱 내부 도메인 모델.
 *
 * 시트의 한글 헤더 → 이 타입으로의 변환은 schema.ts 한 곳에서만 한다.
 * Apps Script는 헤더 이름을 그대로 키로 쓴 raw 객체를 내려주고(§원칙: 열 위치가 아니라
 * 헤더 이름으로 파싱), 매핑 책임은 전부 프론트엔드의 schema.ts가 진다.
 */

export type Part = '합창' | '소프라노' | '알토' | '테너' | '베이스' | '반주'

export const PART_ORDER: Part[] = ['합창', '소프라노', '알토', '테너', '베이스', '반주']

export type SongStatus = '후보' | '예정' | '연습중' | '부름' | '보류'

export type SourceTag = 'namuwiki' | 'official' | 'ocr' | 'manual' | 'youtube_api' | 'youtube_channel'

export interface Book {
  집코드: string
  시리즈: string
  권: number | null
  편저: string
  출판사: string
  출판연도: number | null
  성부: string
  표지색: string
  보유: boolean
  보관위치: string
  공식상품URL: string
  미리듣기URL: string
  파트연습실URL: string
  참고문서URL: string
  비고: string
}

export interface Song {
  곡코드: string
  표시명: string
  제목: string
  원제: string
  집코드: string
  수록번호: number | null
  페이지: string
  작사: string
  작곡: string
  편곡: string
  성부: string
  조성: string
  절기: string
  난이도: number | null
  상태: SongStatus | ''
  참고음원URL: string
  악보스캔URL: string
  출처: SourceTag | ''
  검증: boolean
  비고: string
}

export interface Service {
  찬양일: string // YYYY-MM-DD
  예배구분: string
  곡: string[] // 곡1/곡2/곡3 중 값이 있는 것만, 순서 유지
  S인원: number | null
  A인원: number | null
  T인원: number | null
  B인원: number | null
  세션: string
  기록영상URL: string
  메모: string
}

export interface Rehearsal {
  찬양일: string
  연습일: string
  시각: string // HH:MM
  구분: string // 주일 / 수요일 / 특별
  장소: string
  메모: string
}

export interface PracticeLink {
  표시명: string
  파트: Part | string
  URL: string
  시작초: number | null
  올린이: string
  출처: SourceTag | ''
  검증: boolean
}

/** config 시트의 키/값을 파싱한 형태. 값이 없으면 기본값으로 채워진다. */
export interface AppConfig {
  공지_제목형식: string
  공지_연습헤더: string
  공지_곡목표시: boolean
  /** 구역·파트 블록 사이에 빈 줄을 넣을지. 기본 TRUE = 실제 카톡 공지 그대로. */
  공지_빈줄구분: boolean
  공지_파트순서: Part[]
  앱_제목: string
  /** 교회 홈페이지. 비어 있으면 링크를 그리지 않는다. */
  교회홈페이지: string
  /** 예배 실황 영상이 올라오는 페이지. services.기록영상URL이 빈 날에 대신 안내한다. */
  예배영상URL: string
  /** 시트의 IANA 시간대. 날짜·시각 해석의 기준 (기본 America/Los_Angeles). */
  시간대: string
  유튜브채널핸들: string
  연습기본패턴: string
  중복경고개월: number
  절기힌트: Record<number, string>
  /** 위에서 다루지 않은 키도 잃어버리지 않고 보관한다. */
  raw: Record<string, string>
}

export interface ArchiveData {
  updatedAt: string
  books: Book[]
  songs: Song[]
  services: Service[]
  rehearsals: Rehearsal[]
  practiceLinks: PracticeLink[]
  config: AppConfig
}

/** Apps Script가 내려주는 원본 형태 (한글 헤더 키, 값은 문자열/숫자/불리언 혼재). */
export type RawRow = Record<string, unknown>

export interface RawPayload {
  updatedAt?: unknown
  books?: RawRow[]
  songs?: RawRow[]
  services?: RawRow[]
  rehearsals?: RawRow[]
  practiceLinks?: RawRow[]
  practice_links?: RawRow[]
  config?: RawRow[] | Record<string, unknown>
}
