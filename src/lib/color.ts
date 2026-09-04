/**
 * 표지색 위에 올릴 글자색.
 *
 * `books.표지색`은 사람이 실물을 보고 채우는 값이라 밝기가 제각각이다.
 * 흰 글씨로 고정해 두면 하늘색(중11)·베이지(중37) 책등에서 권 번호가 읽히지 않는다.
 * WCAG 상대 휘도로 밝기를 재서 흰색과 검은색 중 대비가 큰 쪽을 고른다.
 */
const FALLBACK = '#57534e'

export function normalizeHex(value: string | undefined): string {
  const raw = String(value ?? '').trim()
  const m = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return FALLBACK
  const hex = m[1]
  return '#' + (hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex).toLowerCase()
}

/** WCAG 2.1 상대 휘도 (0 = 검정, 1 = 흰색). */
export function luminance(hex: string): number {
  const h = normalizeHex(hex).slice(1)
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** 배경 위에서 더 잘 읽히는 글자색. 흰 글씨의 대비가 4.5:1에 못 미치면 검정으로 뒤집는다. */
export function textOn(background: string | undefined): '#ffffff' | '#1c1917' {
  const bg = luminance(background ?? FALLBACK)
  const withWhite = 1.05 / (bg + 0.05)
  return withWhite >= 4.5 ? '#ffffff' : '#1c1917'
}
