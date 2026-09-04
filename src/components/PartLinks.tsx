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
            {/*
              썸네일을 배경으로 깔지 않는다. 성가 영상 썸네일에는 곡명이 큰 글씨로 박혀 있어서,
              흐리게 깔아도 파트 라벨과 겹쳐 둘 다 안 읽힌다. 게다가 한 곡의 파트 6개가
              전부 같은 썸네일이라 구분에 아무 도움이 안 된다.
              §6.1의 요구는 "파트 라벨을 크게"이므로 색과 라벨만 남긴다.
            */}
            <span className="relative flex items-center gap-1.5 text-base font-bold">
              <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 shrink-0 fill-current opacity-80">
                <path d="M8 5v14l11-7z" />
              </svg>
              {part}
            </span>
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

/**
 * 목록 안에서 쓰는 작은 파트 링크 (§6.2 아카이브).
 * 카드형 버튼은 목록에서 자리를 너무 먹는다. 색은 홈 화면과 같게 유지해
 * 같은 파트가 어디서나 같은 색으로 보이게 한다.
 */
export function PartLinkChips({ links, order = PART_ORDER }: { links: PracticeLink[]; order?: Part[] }) {
  const shown = order
    .map((part) => ({ part, link: links.find((l) => l.파트 === part) }))
    .filter((e): e is { part: Part; link: PracticeLink } => !!e.link)

  if (!shown.length) return null

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map(({ part, link }) => {
        const normalized = normalizeLink(link.URL, link.시작초)
        return (
          <a
            key={part}
            href={normalized.shareUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={`${link.표시명} — ${part}`}
            className={`chip ${PART_COLOR[part] ?? 'bg-stone-600 text-white'} ${
              link.검증 ? '' : 'opacity-50'
            } hover:brightness-110`}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-2.5 w-2.5 fill-current opacity-80">
              <path d="M8 5v14l11-7z" />
            </svg>
            {part}
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
