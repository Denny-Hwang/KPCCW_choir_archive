import { describe, expect, it } from 'vitest'
import { luminance, normalizeHex, textOn } from './color'

describe('표지색 위 글자색', () => {
  it('어두운 표지에는 흰 글씨', () => {
    expect(textOn('#2B3A6B')).toBe('#ffffff') // 중39 남색
    expect(textOn('#4A4A4A')).toBe('#ffffff') // 중38 진회색
    expect(textOn('#7B3F4A')).toBe('#ffffff') // 중47 자주
  })

  it('밝은 표지에는 검은 글씨', () => {
    // 흰 글씨로 고정돼 있어 실제로 읽히지 않던 두 권이다.
    expect(textOn('#8FBFD9')).toBe('#1c1917') // 중11 하늘색
    expect(textOn('#C9B18A')).toBe('#1c1917') // 중37 베이지
  })

  it('값이 없거나 이상하면 기본 배경 기준으로 판단한다', () => {
    expect(normalizeHex(undefined)).toBe('#57534e')
    expect(normalizeHex('nope')).toBe('#57534e')
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(textOn('')).toBe('#ffffff')
  })

  it('휘도는 검정 0, 흰색 1', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })
})
