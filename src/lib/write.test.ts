import { describe, expect, it } from 'vitest'
import {
  buildVerifyRequest,
  buildWriteRequest,
  parseVerifyResponse,
  parseWriteResponse,
  planToPayloads,
  validatePlan,
  type PlanPayload,
} from './write'

const payload: PlanPayload = {
  찬양일: '2026-10-25',
  예배구분: '주일',
  곡: ['가곡 (중47-01)'],
  rehearsals: [
    { 연습일: '2026-10-11', 시각: '13:30', 구분: '주일', 장소: '' },
    { 연습일: '2026-10-21', 시각: '20:00', 구분: '수요일', 장소: '' },
  ],
}

describe('validatePlan', () => {
  it('정상 입력은 문제가 없다', () => {
    expect(validatePlan(payload)).toEqual([])
  })

  it('찬양일·곡·연습일을 검사한다', () => {
    expect(validatePlan({ ...payload, 찬양일: '' })).toContain('찬양일을 고르세요.')
    expect(validatePlan({ ...payload, 곡: [' '] })).toContain('곡이 없습니다.')
    expect(validatePlan({ ...payload, 곡: ['a', 'b', 'c', 'd'] })).toContain('곡은 한 찬양일에 3개까지입니다.')
    expect(validatePlan({ ...payload, rehearsals: [{ 연습일: '', 시각: '', 구분: '', 장소: '' }] })).toContain(
      '연습일 중 날짜가 아닌 것이 있습니다.',
    )
  })

  it('찬양일 이후의 연습일을 잡아낸다', () => {
    // 찬양일을 바꾸면 기본 패턴이 그대로 남아 뒤에 오는 일이 있다.
    expect(validatePlan({ ...payload, 찬양일: '2026-10-11' })).toContain('찬양일 이후의 연습일이 있습니다.')
  })
})

describe('planToPayloads', () => {
  it('곡이 있는 날만 날짜순으로, 예배구분이 비면 주일', () => {
    const r = { 연습일: '2026-10-11', 시각: '13:30', 구분: '주일', 장소: '' }
    const out = planToPayloads([
      { id: 'b', 찬양일: '2026-10-25', 예배구분: '  ', 곡: ['a'], rehearsals: [r] },
      { id: 'empty', 찬양일: '2026-10-18', 예배구분: '주일', 곡: [], rehearsals: [] },
      { id: 'a', 찬양일: '2026-10-04', 예배구분: '특별예배', 곡: ['b', 'c'], rehearsals: [] },
    ])
    expect(out).toEqual([
      { 찬양일: '2026-10-04', 예배구분: '특별예배', 곡: ['b', 'c'], rehearsals: [] },
      { 찬양일: '2026-10-25', 예배구분: '주일', 곡: ['a'], rehearsals: [r] },
    ])
  })
})

describe('buildWriteRequest', () => {
  it('키·동작·페이로드를 담은 JSON', () => {
    expect(JSON.parse(buildWriteRequest(payload, 'k'))).toEqual({ key: 'k', action: 'applyPlan', payload })
  })
})

describe('verifyLink 요청·응답', () => {
  const payload = { 표시명: '가곡 (중47-01)', 파트: '합창', URL: 'https://youtu.be/aaa', 검증: true }

  it('요청은 action이 verifyLink', () => {
    expect(JSON.parse(buildVerifyRequest(payload, 'k'))).toEqual({ key: 'k', action: 'verifyLink', payload })
  })

  it('성공 응답을 읽는다', () => {
    expect(parseVerifyResponse('{"ok":true,"updated":1,"검증":false}')).toEqual({ ok: true, updated: 1, 검증: false })
    expect(parseVerifyResponse('{"ok":true}')).toEqual({ ok: true, updated: 0, 검증: true })
  })

  it('실패 응답은 이유를 전한다', () => {
    expect(parseVerifyResponse('{"ok":false,"error":"줄을 찾지 못했습니다"}')).toEqual({ ok: false, error: '줄을 찾지 못했습니다' })
    expect(parseVerifyResponse('<html>').ok).toBe(false)
  })
})

describe('parseWriteResponse', () => {
  it('성공 응답을 읽는다', () => {
    expect(
      parseWriteResponse(
        JSON.stringify({ ok: true, service: 'updated', songsAdded: ['a'], songsSkipped: [], rehearsalsAdded: 2, rehearsalsSkipped: 1 }),
      ),
    ).toEqual({ ok: true, service: 'updated', songsAdded: ['a'], songsSkipped: [], rehearsalsAdded: 2, rehearsalsSkipped: 1 })
  })

  it('실패 응답은 서버가 준 이유를 그대로 전한다', () => {
    expect(parseWriteResponse(JSON.stringify({ ok: false, error: '편집 키가 맞지 않습니다.' }))).toEqual({
      ok: false,
      error: '편집 키가 맞지 않습니다.',
    })
  })

  it('JSON이 아니면(로그인 페이지 등) 배포 설정을 의심하라고 한다', () => {
    const r = parseWriteResponse('<html>Sign in</html>')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('배포')
  })

  it('빠진 칸은 기본값으로 채운다', () => {
    expect(parseWriteResponse('{"ok":true}')).toEqual({
      ok: true,
      service: 'created',
      songsAdded: [],
      songsSkipped: [],
      rehearsalsAdded: 0,
      rehearsalsSkipped: 0,
    })
  })
})
