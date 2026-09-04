/**
 * URL 정규화 (§8).
 *
 * 시트에는 어떤 형태로 붙여넣어도 된다는 것이 전제다. 기존 메모에 실제로 있는
 * `?is=...`(`?si=`의 오타로 보이는) 같은 깨진 파라미터도 무시하고 ID만 뽑는다.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** 영상 ID 11자를 추출한다. 못 찾으면 null — 호출부는 원본 URL을 그대로 링크로 둔다. */
export function extractVideoId(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (VIDEO_ID.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  // music.youtube.com 링크가 실제 공지에 쓰인다. 이 접두사를 벗기지 않으면
  // 정상 링크인데도 ID 추출에 실패해 공지에서 원본 URL이 그대로 나간다.
  const host = url.hostname.replace(/^(?:www|m|music)\./, '')
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be') {
    return VIDEO_ID.test(segments[0] ?? '') ? segments[0] : null
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v')
    if (v && VIDEO_ID.test(v)) return v
    // /shorts/{id}, /embed/{id}, /live/{id}, /v/{id}
    if (segments.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(segments[0])) {
      return VIDEO_ID.test(segments[1]) ? segments[1] : null
    }
  }

  return null
}

/** 시작초를 URL 쿼리(`?t=90`, `#t=1m30s`)에서 읽는다. 시트의 `시작초` 열이 우선한다. */
export function extractStartSeconds(input: string): number | null {
  try {
    const url = new URL((input ?? '').startsWith('http') ? input : `https://${input}`)
    const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.hash.replace(/^#t=/, '')
    if (!raw) return null
    if (/^\d+$/.test(raw)) return Number(raw)
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    if (!m || !m.slice(1).some(Boolean)) return null
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  } catch {
    return null
  }
}

export interface NormalizedLink {
  /** 공지·카톡 공유용. ID 추출 실패 시 원본 그대로. */
  shareUrl: string
  /** 곡 상세의 iframe용. 추출 실패 시 null. */
  embedUrl: string | null
  thumbnailUrl: string | null
  videoId: string | null
  startSeconds: number
  /** ID를 못 뽑았다는 뜻. 목록에서 경고를 띄운다 (§8). */
  unrecognized: boolean
}

export function normalizeLink(url: string, startSeconds?: number | null): NormalizedLink {
  const videoId = extractVideoId(url)
  const start = startSeconds != null && startSeconds > 0 ? startSeconds : (extractStartSeconds(url) ?? 0)

  if (!videoId) {
    return {
      shareUrl: (url ?? '').trim(),
      embedUrl: null,
      thumbnailUrl: null,
      videoId: null,
      startSeconds: start,
      unrecognized: true,
    }
  }

  return {
    shareUrl: start > 0 ? `https://youtu.be/${videoId}?t=${start}` : `https://youtu.be/${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}${start > 0 ? `?start=${start}` : ''}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    videoId,
    startSeconds: start,
    unrecognized: false,
  }
}
