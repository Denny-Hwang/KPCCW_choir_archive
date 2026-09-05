import { Link } from 'react-router-dom'
import { formatMonthDay } from '../lib/date'
import { songPath } from '../lib/derive'
import type { SongCandidate } from '../lib/planner'
import { Badge, UnverifiedBadge } from './ui'

/** 곡 한 줄. 라이브러리(§6.3)와 선곡 화면(§6.7)이 같은 표기를 쓴다. */
export function SongMeta({ candidate }: { candidate: SongCandidate }) {
  const { song, lastSung, recent, monthsAgo, linkCount, verifiedLinkCount, hasParts } = candidate
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {song.집코드 && <Badge>{song.곡코드 || song.집코드}</Badge>}
      {song.절기 && <Badge>{song.절기}</Badge>}
      {song.난이도 != null && <Badge>난이도 {song.난이도}</Badge>}
      {song.상태 && <Badge>{song.상태}</Badge>}
      {!song.검증 && <UnverifiedBadge />}
      {recent ? (
        <Badge tone="danger">
          {monthsAgo === 0 ? '이번 달 부름' : `${monthsAgo}개월 전 부름`}
        </Badge>
      ) : lastSung ? (
        <Badge>마지막 {lastSung}</Badge>
      ) : (
        <Badge>부른 적 없음</Badge>
      )}
      {hasParts ? (
        <Badge tone="ok">파트 영상 {verifiedLinkCount}</Badge>
      ) : linkCount > 0 ? (
        // 자동 수집된 링크는 검증 전까지 공지에 안 나가지만, "없음"은 거짓말이다.
        // 영상 매칭 직후 서가 전체가 "파트 영상 없음"으로 보이던 원인.
        <Badge tone="warn">파트 영상 {linkCount} · 확인 대기</Badge>
      ) : (
        <Badge tone="warn">파트 영상 없음</Badge>
      )}
    </div>
  )
}

export function SongRow({ candidate }: { candidate: SongCandidate }) {
  const { song, lastSung } = candidate
  return (
    <li className={`px-4 py-3 ${song.검증 ? '' : 'opacity-60'}`}>
      <Link to={songPath(song)} className="block">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold">{song.제목 || song.표시명}</p>
          {lastSung && <span className="shrink-0 text-xs text-stone-400">마지막 {formatMonthDay(lastSung)}</span>}
        </div>
        {(song.작곡 || song.편곡 || song.원제) && (
          <p className="truncate text-xs text-stone-500">
            {[song.원제, song.작곡 && `작곡 ${song.작곡}`, song.편곡 && `편곡 ${song.편곡}`].filter(Boolean).join(' · ')}
          </p>
        )}
        <SongMeta candidate={candidate} />
      </Link>
    </li>
  )
}
