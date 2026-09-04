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

export type DataOrigin = 'network' | 'cache' | 'demo'

export interface LoadResult {
  data: ArchiveData
  origin: DataOrigin
  fetchedAt: string | null
  error: string | null
}

/**
 * 엔드포인트 우선순위: 사용자가 설정 화면에서 넣은 값 > 빌드 시 주입값.
 * Apps Script URL은 저장소에 있어도 되지만(§13.3), 배포 전이거나 URL이 바뀌었을 때
 * 재빌드 없이 고칠 수 있어야 한다.
 */
export function getEndpoint(): string {
  const stored = safeGet(ENDPOINT_KEY)
  if (stored) return stored
  return (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? ''
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

/** 엔드포인트가 아직 없을 때 보여줄 예시 데이터. 앱이 무엇을 하는지 즉시 보이게 한다. */
async function loadDemo(): Promise<RawPayload> {
  const res = await fetch(`${import.meta.env.BASE_URL}demo-data.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`예시 데이터를 불러오지 못했습니다 (${res.status})`)
  return (await res.json()) as RawPayload
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
  const endpoint = getEndpoint()
  const cached = readCache()

  if (!endpoint) {
    try {
      return { data: parsePayload(await loadDemo()), origin: 'demo', fetchedAt: null, error: null }
    } catch (e) {
      return {
        data: parsePayload(cached?.payload ?? null),
        origin: cached ? 'cache' : 'demo',
        fetchedAt: cached?.fetchedAt ?? null,
        error: message(e),
      }
    }
  }

  try {
    const payload = await fetchPayload(endpoint)
    return { data: parsePayload(payload), origin: 'network', fetchedAt: writeCache(payload), error: null }
  } catch (e) {
    if (cached) {
      return {
        data: parsePayload(cached.payload),
        origin: 'cache',
        fetchedAt: cached.fetchedAt,
        error: message(e),
      }
    }
    throw e instanceof Error ? e : new Error(message(e))
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
