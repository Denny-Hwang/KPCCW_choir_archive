import { linksByPart, verifiedLinks } from '../lib/derive'
import { normalizeLink } from '../lib/youtube'
import { PART_ORDER, type Part, type PracticeLink } from '../lib/types'
import { Badge, UnverifiedBadge } from './ui'

const PART_COLOR: Record<string, string> = {
  합창: 'bg-stone-800 text-white',
  소프라노: 'bg-rose-600 text-white',
  알토: 'bg-amber-600 text-white',
  테너: 'bg-emerald-700 text-white',
  베이스: 'bg-sky-700 text-white',
  반주: 'bg-violet-700 text-white',
}

/**
 * 파트 버튼 (§6.1).
 * 유튜브 썸네일만으로는 어느 파트인지 분간이 안 된다 — 파트 라벨을 크게, 썸네일은 보조로.
 */
export function PartLinks({ links, order = PART_ORDER }: { links: PracticeLink[]; order?: Part[] }) {
  const shown = order
    .map((part) => ({ part, list: links.filter((l) => l.파트 === part) }))
    .filter((entry) => entry.list.length > 0)

  if (!shown.length) {
    return <p className="text-sm text-stone-400">등록된 파트 영상이 없습니다.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {shown.map(({ part, list }) => {
        const link = list[0]
        const normalized = normalizeLink(link.URL, link.시작초)
        return (
          <a
            key={part}
            href={normalized.shareUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={`relative flex min-h-[4.5rem] flex-col justify-between overflow-hidden rounded-2xl p-3 ${
              PART_COLOR[part] ?? 'bg-stone-600 text-white'
            } ${link.검증 ? '' : 'opacity-60'}`}
          >
            {normalized.thumbnailUrl && (
              <img
                src={normalized.thumbnailUrl}
                alt=""
                loading="lazy"
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
              />
            )}
            <span className="relative text-base font-bold">{part}</span>
            <span className="relative flex flex-wrap items-center gap-1 text-[11px] opacity-90">
              {!link.검증 && <span className="rounded bg-white/25 px-1">미확인</span>}
              {normalized.unrecognized && <span className="rounded bg-white/25 px-1">주소 확인 필요</span>}
              {list.length > 1 && <span className="rounded bg-white/25 px-1">+{list.length - 1}</span>}
            </span>
          </a>
        )
      })}
    </div>
  )
}

/** 곡 상세용 — 파트별 임베드와 상태 표시 (§6.5). */
export function PartLinkList({ links }: { links: PracticeLink[] }) {
  if (!links.length) return <p className="text-sm text-stone-400">등록된 파트 영상이 없습니다.</p>
  return (
    <ul className="space-y-3">
      {links.map((link, i) => {
        const normalized = normalizeLink(link.URL, link.시작초)
        return (
          <li key={`${link.파트}-${i}`} className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm font-bold">{link.파트}</span>
              <span className="flex items-center gap-1">
                {link.검증 ? <Badge tone="ok">확인됨</Badge> : <UnverifiedBadge />}
                {link.출처 && <Badge>{link.출처}</Badge>}
              </span>
            </div>
            {normalized.embedUrl ? (
              <div className="aspect-video w-full bg-stone-900">
                <iframe
                  src={normalized.embedUrl}
                  title={`${link.표시명} ${link.파트}`}
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            ) : (
              <div className="border-t border-stone-100 px-3 py-2 text-xs">
                <p className="mb-1 text-amber-700">유튜브 주소를 인식하지 못했습니다. 원본 링크로 엽니다.</p>
                <a href={normalized.shareUrl} target="_blank" rel="noreferrer noopener" className="break-all underline">
                  {normalized.shareUrl}
                </a>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export { linksByPart, verifiedLinks }
