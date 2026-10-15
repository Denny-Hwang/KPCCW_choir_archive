import { describe, expect, it } from 'vitest'
import { buildReadiness, partState } from './readiness'
import { DEFAULT_CONFIG } from './schema'
import type { ArchiveData, PracticeLink, Service, Song } from './types'

function song(p: Partial<Song>): Song {
  return {
    곡코드: '', 표시명: '', 제목: '', 원제: '', 집코드: '', 수록번호: null, 페이지: '', 작사: '', 작곡: '', 편곡: '',
    성부: '', 조성: '', 절기: '', 난이도: null, 상태: '', 참고음원URL: '', 악보스캔URL: '', 출처: '', 검증: true, 비고: '',
    ...p,
  }
}
function service(찬양일: string, 곡: string[]): Service {
  return { 찬양일, 예배구분: '주일', 곡, S인원: null, A인원: null, T인원: null, B인원: null, 세션: '', 기록영상URL: '', 메모: '' }
}
function link(파트: string, 검증: boolean): PracticeLink {
  return { 표시명: '가곡 (중47-01)', 파트, URL: 'https://youtu.be/vk1nDmhdy2w', 시작초: null, 올린이: '', 출처: 'manual', 검증 }
}

const base: ArchiveData = {
  updatedAt: '',
  books: [],
  config: DEFAULT_CONFIG,
  songs: [song({ 표시명: '가곡 (중47-01)', 제목: '가곡', 곡코드: '중47-01' })],
  services: [service('2026-09-01', ['가곡 (중47-01)']), service('2026-10-25', ['가곡 (중47-01)'])],
  rehearsals: [
    { 찬양일: '2026-10-25', 연습일: '2026-10-11', 시각: '13:30', 구분: '주일', 장소: '', 메모: '' },
    { 찬양일: '2026-10-25', 연습일: '2026-10-18', 시각: '13:30', 구분: '주일', 장소: '', 메모: '' },
  ],
  practiceLinks: [link('합창', true), link('소프라노', false), link('소프라노', true), link('알토', false)],
}

describe('partState', () => {
  it('확인된 것이 하나라도 있으면 verified', () => {
    expect(partState(base.practiceLinks, '소프라노')).toBe('verified')
    expect(partState(base.practiceLinks, '알토')).toBe('unverified')
    expect(partState(base.practiceLinks, '테너')).toBe('missing')
  })
})

describe('buildReadiness', () => {
  it('다가오는 찬양의 곡·파트·연습·공지를 짚는다', () => {
    const r = buildReadiness(base, '2026-10-12', null)
    expect(r.service?.찬양일).toBe('2026-10-25')
    expect(r.daysLeft).toBe(13)
    expect(r.nextRehearsal?.연습일).toBe('2026-10-18')
    expect(r.songs[0].parts.map((p) => p.state)).toEqual(['verified', 'verified', 'unverified', 'missing', 'missing'])
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c]))
    expect(byKey.songs.status).toBe('ok')
    expect(byKey.parts).toMatchObject({ status: 'todo', detail: '없음 2개 · 확인 대기 1개 (공지에서 빠짐)' })
    expect(byKey.rehearsals.status).toBe('ok')
    expect(byKey.notice.status).toBe('todo')
    expect(r.open).toBe(2)
  })

  it('공지를 복사했으면 언제 했는지 말한다', () => {
    const r = buildReadiness(base, '2026-10-12', '2026-10-12T09:05:00.000Z')
    expect(r.checks.find((c) => c.key === 'notice')).toMatchObject({ status: 'ok', detail: '이 기기에서 10/12 09:05에 복사함' })
  })

  it('다가오는 찬양이 없으면 지난 찬양으로 대신하지 않는다', () => {
    const r = buildReadiness(base, '2026-11-01', null)
    expect(r.service).toBeNull()
    expect(r.checks[0]).toMatchObject({ key: 'songs', status: 'todo' })
  })

  it('편집 키가 기본값이면 경고를 더한다', () => {
    const r = buildReadiness({ ...base, writeKeyIsDefault: true }, '2026-10-12', null)
    expect(r.checks.find((c) => c.key === 'writeKey')?.status).toBe('warn')
  })
})
