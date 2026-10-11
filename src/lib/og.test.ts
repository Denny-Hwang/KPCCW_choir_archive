import { describe, expect, it } from 'vitest'
import { applyOgText, ogText, todayIn } from './og'
import { DEFAULT_CONFIG } from './schema'
import type { ArchiveData } from './types'

const data: ArchiveData = {
  updatedAt: '',
  books: [],
  config: DEFAULT_CONFIG,
  songs: [],
  services: [
    { 찬양일: '2026-10-25', 예배구분: '주일', 곡: ['감사의 노래 (중38-14)'], S인원: null, A인원: null, T인원: null, B인원: null, 세션: '', 기록영상URL: '', 메모: '' },
  ],
  rehearsals: [{ 찬양일: '2026-10-25', 연습일: '2026-10-18', 시각: '13:30', 구분: '주일', 장소: '', 메모: '' }],
  practiceLinks: [],
}

describe('ogText', () => {
  it('다음 찬양의 날짜·곡·다음 연습', () => {
    expect(ogText(data, '2026-10-12')).toEqual({
      title: '10월 25일 찬양 — 감사의 노래',
      description: `파트별 연습 영상 · 다음 연습 10월 18일 주일 · ${DEFAULT_CONFIG.앱_제목}`,
    })
  })

  it('다가오는 찬양이 없으면 바꾸지 않는다', () => {
    expect(ogText(data, '2026-11-01')).toBeNull()
  })
})

describe('applyOgText', () => {
  it('태그 값만 바꾸고 따옴표를 이스케이프한다', () => {
    const html = '<meta property="og:title" content="옛" /><meta property="og:description" content="옛" /><meta name="description" content="옛" />'
    const out = applyOgText(html, { title: '새 "곡"', description: '설명' })
    expect(out).toContain('<meta property="og:title" content="새 &quot;곡&quot;" />')
    expect(out).toContain('<meta property="og:description" content="설명" />')
    expect(out).toContain('<meta name="description" content="새 &quot;곡&quot; · 설명" />')
  })
})

describe('todayIn', () => {
  it('빌드 서버(UTC) 저녁에도 로스앤젤레스 날짜를 쓴다', () => {
    expect(todayIn('America/Los_Angeles', new Date('2026-10-12T03:00:00Z'))).toBe('2026-10-11')
  })
})
