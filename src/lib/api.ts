/**
 * 데이터 로딩 (§2).
 *
 * 주일 아침 교회 와이파이가 불안정할 수 있으므로 stale-while-revalidate로 동작한다:
 * 캐시가 있으면 즉시 그리고, 네트워크는 뒤에서 갱신한다. 네트워크가 실패해도
 * 마지막으로 성공한 응답이 화면에 남는다.
 */
import { parsePayload } from './schema'
import type { ArchiveData, RawPayload } from './types'

const CACHE_KEY = 'kpccw.archive.cache.v1'
const ENDPOINT_KEY = 'kpccw.archive.endpoint'

/**
 * 배포된 Apps Script 읽기 엔드포인트.
 *
 * 저장소에 둬도 되는 값이다 (§13.3): 앱을 여는 사람의 브라우저에 어차피 노출되고,
 * services는 참석을 파트별 숫자로만 기록해 개인정보가 없다.
 * 여기 박아 두어야 대원들이 카톡 링크로 열자마자 데이터가 보인다 — 각자 설정할 수 없다.
 */
const DEFAULT_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbw0mnamF0M6fOE5qryCMneZx48yivldMwz3APG4FquLK3R4zOKlZcG7D0ZPO1eW1v4/exec'

/** 'error' = 못 받았고 보여줄 캐시도 없는 상태. */
export type DataOrigin = 'network' | 'cache' | 'error'

export interface LoadResult {
  data: ArchiveData
  origin: DataOrigin
  fetchedAt: string | null
  error: string | null
}

/**
 * 엔드포인트 우선순위: 이 브라우저에 저장된 값 > 빌드 시 주입값 > 코드의 기본값.
 * 앞의 둘은 URL이 바뀌었을 때 재빌드 없이(또는 재배포만으로) 갈아끼우기 위한 통로다.
 */
export function getEndpoint(): string {
  const stored = safeGet(ENDPOINT_KEY)
  if (stored) return stored
  const injected = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  return injected || DEFAULT_ENDPOINT
}

export function setEndpoint(url: string): void {
  const trimmed = url.trim()
  if (trimmed) safeSet(ENDPOINT_KEY, trimmed)
  else safeRemove(ENDPOINT_KEY)
}

export function readCache(): { payload: RawPayload; fetchedAt: string } | null {
  const raw = safeGet(CACHE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { payload: RawPayload; fetchedAt: string }
    return parsed?.payload ? parsed : null
  } catch {
    return null
  }
}

export function writeCache(payload: RawPayload): string {
  const fetchedAt = new Date().toISOString()
  safeSet(CACHE_KEY, JSON.stringify({ payload, fetchedAt }))
  return fetchedAt
}

export function clearCache(): void {
  safeRemove(CACHE_KEY)
}

/**
 * 저장해 둔 마지막 응답. 네트워크를 기다리지 않고 **즉시** 그리기 위한 것이다.
 *
 * Apps Script는 매 요청마다 스크립트를 깨워 시트 전체를 읽으므로 1~3초가 예사다.
 * 그걸 기다리는 동안 빈 화면을 보여줄 이유가 없다 — 지난주 공지는 이미 손에 있다.
 */
export function cachedArchive(): { data: ArchiveData; fetchedAt: string } | null {
  const cached = readCache()
  if (!cached) return null
  try {
    return { data: parsePayload(cached.payload), fetchedAt: cached.fetchedAt }
  } catch {
    return null
  }
}

async function fetchPayload(endpoint: string): Promise<RawPayload> {
  // Apps Script는 script.googleusercontent.com으로 302 리다이렉트한다. fetch가 따라간다.
  const res = await fetch(endpoint, { redirect: 'follow' })
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`)
  const text = await res.text()
  try {
    return JSON.parse(text) as RawPayload
  } catch {
    // 배포 설정이 잘못되면 로그인 HTML이 돌아온다. 그 경우를 구분해서 알린다.
    throw new Error('JSON이 아닌 응답을 받았습니다. Apps Script 배포의 액세스 권한을 확인하세요.')
  }
}

export async function loadArchive(): Promise<LoadResult> {
  try {
    const payload = await fetchPayload(getEndpoint())
    return { data: parsePayload(payload), origin: 'network', fetchedAt: writeCache(payload), error: null }
  } catch (e) {
    // 실패하면 마지막으로 받은 내용이 화면에 그대로 남는다.
    const cached = readCache()
    if (cached) {
      return { data: parsePayload(cached.payload), origin: 'cache', fetchedAt: cached.fetchedAt, error: message(e) }
    }
    // 캐시도 없으면 빈 화면이 된다. 이때 예시 데이터를 대신 보여주면 안 된다 —
    // 남의 교회 곡이 진짜 기록처럼 보이는 것이 연결 실패보다 나쁘다.
    return { data: parsePayload(null), origin: 'error', fetchedAt: null, error: message(e) }
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    // 사파리 프라이빗 모드 등에서 localStorage 접근 자체가 예외를 던진다.
    return ''
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 캐시는 있으면 좋은 것이지 필수가 아니다. */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 위와 같다. */
  }
}
