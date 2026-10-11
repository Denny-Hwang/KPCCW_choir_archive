/**
 * 카톡 링크 미리보기(OG 태그) 문구.
 *
 * 정적 호스팅이라 요청마다 다르게 줄 수는 없다. 대신 배포할 때(그리고 매일 아침 예약 배포로)
 * 그 시점의 다음 찬양으로 index.html의 태그를 바꿔 쓴다 — scripts/og-tags.ts.
 * 카톡은 미리보기를 한동안 캐시하므로 하루 단위면 충분하다.
 */
import { buildServiceView, pickFeaturedService } from './derive'
import { formatMonthDay } from './date'
import type { ArchiveData } from './types'

export interface OgText {
  title: string
  description: string
}

export function ogText(data: ArchiveData, today: string): OgText | null {
  const service = pickFeaturedService(data.services, today)
  if (!service || service.찬양일 < today || !service.곡.length) return null
  const view = buildServiceView(service, data)
  const songs = view.songs.map((s) => s.제목).join(' · ')
  const next = view.rehearsals.find((r) => r.연습일 >= today)
  return {
    title: `${formatMonthDay(service.찬양일)} 찬양 — ${songs}`,
    description:
      '파트별 연습 영상' + (next ? ` · 다음 연습 ${formatMonthDay(next.연습일)} ${next.구분}` : '') + ` · ${data.config.앱_제목}`,
  }
}

/** 시간대 기준 오늘 'YYYY-MM-DD'. 빌드 서버는 UTC라 그대로 쓰면 저녁에 하루가 밀린다. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** index.html의 og:title·og:description·description을 바꾼다. 태그가 없으면 그대로 둔다. */
export function applyOgText(html: string, og: OgText): string {
  const set = (pattern: RegExp, value: string) => (s: string) => s.replace(pattern, `$1${escapeAttr(value)}$2`)
  return [
    set(/(<meta property="og:title" content=")[^"]*(")/, og.title),
    set(/(<meta property="og:description" content=")[^"]*(")/, og.description),
    set(/(<meta name="description" content=")[^"]*(")/, `${og.title} · ${og.description}`),
  ].reduce((s, f) => f(s), html)
}
