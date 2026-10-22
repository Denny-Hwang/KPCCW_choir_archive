import { describe, expect, it } from 'vitest'
import { alignRehearsal, rehearsalKindOf, rehearsalMismatch } from './date'
import { formatRehearsalLine } from './notice'
import { validateRehearsalEdit } from './write'

describe('연습 날짜·요일 정합', () => {
  it('요일로 구분을 정한다', () => {
    expect(rehearsalKindOf('2026-10-25')).toBe('주일')
    expect(rehearsalKindOf('2026-10-21')).toBe('수요일')
    expect(rehearsalKindOf('2026-10-22')).toBe('특별')
  })

  it('수요일을 주일로 적은 줄을 잡아낸다', () => {
    expect(rehearsalMismatch({ 연습일: '2026-10-21', 구분: '주일' })).toContain('수요일')
    expect(rehearsalMismatch({ 연습일: '2026-10-21', 구분: '수요일' })).toBeNull()
    expect(rehearsalMismatch({ 연습일: '2026-10-22', 구분: '특별' })).toBeNull()
  })

  it('날짜에 맞춰 구분과 기본 시각을 채운다', () => {
    expect(alignRehearsal({ 연습일: '2026-10-21', 구분: '주일', 시각: '13:30' })).toMatchObject({ 구분: '수요일', 시각: '20:00' })
    expect(alignRehearsal({ 연습일: '2026-10-25', 구분: '수요일', 시각: '20:00' })).toMatchObject({ 구분: '주일', 시각: '13:30' })
    expect(alignRehearsal({ 연습일: '2026-10-22', 구분: '주일', 시각: '19:00' })).toMatchObject({ 구분: '특별', 시각: '19:00' })
  })

  it('공지 줄은 잘못 적힌 구분 대신 실제 요일을 쓴다', () => {
    const base = { 찬양일: '2026-10-25', 장소: '', 메모: '' }
    expect(formatRehearsalLine({ ...base, 연습일: '2026-10-21', 시각: '20:00', 구분: '주일' })).toBe('21일 수요일 8시')
  })

  it('수정 검증은 어긋난 구분과 찬양일 이후 날짜를 막는다', () => {
    const r = { 시각: '20:00', 장소: '' }
    expect(validateRehearsalEdit({ 찬양일: '2026-10-25', rehearsals: [{ ...r, 연습일: '2026-10-21', 구분: '주일' }] })).toHaveLength(1)
    expect(validateRehearsalEdit({ 찬양일: '2026-10-25', rehearsals: [{ ...r, 연습일: '2026-10-21', 구분: '수요일' }] })).toEqual([])
  })
})
