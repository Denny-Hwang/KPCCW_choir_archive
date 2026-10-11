/**
 * 다음 찬양의 준비 상태 (총무·지휘자용 "이번 주" 화면).
 *
 * 주간 자동 점검(Automation.gs의 nextServiceReadiness_)과 같은 기준이다 —
 * 곡마다 합창·S·A·T·B 영상이 있고 확인됐는지, 연습 일정이 있는지.
 * 거기에 이 화면에서만 알 수 있는 것(공지를 이 기기에서 복사했는지, 편집 키가 기본값인지)을 더한다.
 */
import { buildServiceView, pickFeaturedService } from './derive'
import { daysBetween } from './date'
import type { ArchiveData, Part, Rehearsal, Service, Song } from './types'

export const READY_PARTS: Part[] = ['합창', '소프라노', '알토', '테너', '베이스']

export type PartState = 'verified' | 'unverified' | 'missing'
export type CheckStatus = 'ok' | 'warn' | 'todo'

export interface ReadinessCheck {
  key: 'songs' | 'parts' | 'rehearsals' | 'notice' | 'writeKey'
  label: string
  status: CheckStatus
  detail: string
}

export interface Readiness {
  /** 다가오는 찬양. 없으면 null (지난 찬양으로 대신하지 않는다 — 준비할 것이 없다는 뜻이다). */
  service: Service | null
  daysLeft: number | null
  songs: Array<{ 표시명: string; 제목: string; song: Song | null; parts: Array<{ part: Part; state: PartState }> }>
  rehearsals: Rehearsal[]
  nextRehearsal: Rehearsal | null
  checks: ReadinessCheck[]
  /** 손볼 것의 수 (ok가 아닌 항목). */
  open: number
}

export function partState(links: Array<{ 파트: string; 검증: boolean }>, part: Part): PartState {
  const mine = links.filter((l) => l.파트 === part)
  if (!mine.length) return 'missing'
  return mine.some((l) => l.검증) ? 'verified' : 'unverified'
}

export function buildReadiness(
  data: ArchiveData,
  today: string,
  noticeCopiedAt: string | null,
): Readiness {
  const featured = pickFeaturedService(data.services, today)
  const service = featured && featured.찬양일 >= today ? featured : null
  const checks: ReadinessCheck[] = []

  if (!service) {
    checks.push({ key: 'songs', label: '찬양일·곡', status: 'todo', detail: '다음 찬양일이 시트에 없습니다. 선곡 화면에서 정하세요.' })
    if (data.writeKeyIsDefault) checks.push(writeKeyCheck())
    return { service: null, daysLeft: null, songs: [], rehearsals: [], nextRehearsal: null, checks, open: checks.length }
  }

  const view = buildServiceView(service, data)
  const songs = view.songs.map((s) => ({
    표시명: s.표시명,
    제목: s.제목,
    song: s.song,
    parts: READY_PARTS.map((part) => ({ part, state: partState(s.links, part) })),
  }))

  checks.push(
    songs.length
      ? { key: 'songs', label: '찬양일·곡', status: 'ok', detail: songs.map((s) => s.제목).join(' / ') }
      : { key: 'songs', label: '찬양일·곡', status: 'todo', detail: '곡이 아직 정해지지 않았습니다.' },
  )

  const missing = songs.reduce((n, s) => n + s.parts.filter((p) => p.state === 'missing').length, 0)
  const unverified = songs.reduce((n, s) => n + s.parts.filter((p) => p.state === 'unverified').length, 0)
  if (songs.length) {
    checks.push(
      missing || unverified
        ? {
            key: 'parts',
            label: '파트 영상',
            status: missing ? 'todo' : 'warn',
            detail: [missing && `없음 ${missing}개`, unverified && `확인 대기 ${unverified}개 (공지에서 빠짐)`]
              .filter(Boolean)
              .join(' · '),
          }
        : { key: 'parts', label: '파트 영상', status: 'ok', detail: '모든 곡의 다섯 파트가 확인됐습니다.' },
    )
  }

  const nextRehearsal = view.rehearsals.find((r) => r.연습일 >= today) ?? null
  checks.push(
    view.rehearsals.length
      ? {
          key: 'rehearsals',
          label: '연습 일정',
          status: 'ok',
          detail: `${view.rehearsals.length}회` + (nextRehearsal ? '' : ' · 남은 연습 없음'),
        }
      : { key: 'rehearsals', label: '연습 일정', status: 'todo', detail: '연습 일정이 없습니다.' },
  )

  checks.push(
    noticeCopiedAt
      ? { key: 'notice', label: '공지', status: 'ok', detail: `이 기기에서 ${formatStamp(noticeCopiedAt)}에 복사함` }
      : { key: 'notice', label: '공지', status: 'todo', detail: '이 기기에서 아직 복사하지 않았습니다.' },
  )

  if (data.writeKeyIsDefault) checks.push(writeKeyCheck())

  return {
    service,
    daysLeft: daysBetween(today, service.찬양일),
    songs,
    rehearsals: view.rehearsals,
    nextRehearsal,
    checks,
    open: checks.filter((c) => c.status !== 'ok').length,
  }
}

function writeKeyCheck(): ReadinessCheck {
  return {
    key: 'writeKey',
    label: '편집 키',
    status: 'warn',
    detail: '기본값(selah) 그대로입니다. config 시트의 앱편집키를 바꾸세요.',
  }
}

/** 'YYYY-MM-DDTHH:mm…' → 'M/D HH:mm'. */
function formatStamp(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/)
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : iso
}
