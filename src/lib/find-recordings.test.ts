import { describe, expect, it } from 'vitest'
// @ts-expect-error — 스크립트는 순수 JS다. 파서만 떼어 검증한다.
import { parseDetail } from '../../scripts/find-recordings.mjs'

/**
 * 교회 게시판 상세 페이지에서 제목·공연·날짜를 뽑는 부분.
 *
 * 실제 사이트에 붙어 볼 수 없는 환경이라, 화면에서 확인한 구조
 * (제목이 따옴표로 감싸이고 그 아래 "공연 | YYYY.MM.DD")를 본뜬 fixture로 잠가 둔다.
 */
const page = (title: string, performer: string, date: string) => `
<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head>
<body>
  <div id="header"><a href="/">중부워싱턴한인장로교회</a></div>
  <table class="board_view">
    <tr><td class="subject"><strong>"${title}"</strong></td></tr>
    <tr><td class="info">${performer}&nbsp;|&nbsp;${date}</td></tr>
    <tr><td class="content"><iframe src="https://www.youtube.com/embed/abc"></iframe></td></tr>
  </table>
  <div class="share">공유 주소복사</div>
</body></html>`

describe('parseDetail', () => {
  it('성가대 항목에서 제목·공연·날짜를 뽑는다', () => {
    expect(parseDetail(page('참 아름다워라', 'KPCCW 성가대', '2026.05.24'))).toEqual({
      제목: '참 아름다워라',
      공연: 'KPCCW 성가대',
      날짜: '2026-05-24',
    })
  })

  it('한 자리 월·일도 두 자리로 맞춘다', () => {
    expect(parseDetail(page('은혜', 'KPCCW 성가대', '2026.3.1'))?.날짜).toBe('2026-03-01')
  })

  it('성가대가 아닌 항목도 읽어서 공연으로 구분할 수 있게 한다', () => {
    const r = parseDetail(page('He Arose', 'KPCCW Youth', '2026.04.05'))
    expect(r?.공연).toBe('KPCCW Youth')
    expect(r?.공연.includes('KPCCW 성가대')).toBe(false)
  })

  it('공연명에 하이픈·괄호가 섞여도 읽는다', () => {
    const r = parseDetail(page('My Best Friend', 'KPCCW Education Department- 2026 VBS', '2026.07.19'))
    expect(r?.날짜).toBe('2026-07-19')
    expect(r?.제목).toBe('My Best Friend')
  })

  it('제목에 곡번호나 괄호가 붙어도 따옴표 안을 그대로 쓴다', () => {
    expect(parseDetail(page('주여 우릴 회복시켜 주소서 (중43)', 'KPCCW 성가대', '2025.02.23'))?.제목)
      .toBe('주여 우릴 회복시켜 주소서 (중43)')
  })

  it('없는 글이나 형식이 다른 페이지는 null', () => {
    expect(parseDetail('<html><body>등록된 게시물이 없습니다.</body></html>')).toBeNull()
    expect(parseDetail('')).toBeNull()
  })
})
