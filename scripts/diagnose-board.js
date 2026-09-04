/*
 * 게시판 상세 페이지가 실제로 무엇을 돌려주는지 확인하는 진단용 스니펫.
 *
 * 수집 스크립트가 아무것도 못 찾을 때, 추측하지 말고 이것부터 돌린다.
 * 게시판을 연 탭의 F12 → Console 에 붙여넣고 Enter.
 *
 * 세 번만 요청하고 끝난다. 아무것도 바꾸지 않는다.
 *   - num=382 (page=1) : 목록 1페이지 글
 *   - num=239 (page=2) : 목록 2페이지 글
 *   - num=239 (page=1) : page 값이 조회에 영향을 주는지 확인
 */
(async () => {
  const url = (num, page) =>
    `/main/sub.html?page=${page}&num=${num}&pageCode=18&category=&srcYear=&keyfield=&key=&Mode=view&vodType=7`

  const read = async (num, page) => {
    const res = await fetch(url(num, page))
    const buf = await res.arrayBuffer()
    const peek = new TextDecoder('latin1').decode(buf.slice(0, 3000))
    const metaCharset = (peek.match(/charset\s*=\s*["']?\s*([\w-]+)/i) || [])[1]
    const headerCharset = (((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)) || [])[1]
    const cs = (headerCharset || metaCharset || 'utf-8').toLowerCase()
    let html
    try {
      html = new TextDecoder(cs).decode(buf)
    } catch {
      html = new TextDecoder('utf-8').decode(buf)
    }
    const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    return { res, buf, cs, metaCharset, headerCharset, text }
  }

  for (const [num, page] of [[382, 1], [239, 2], [239, 1]]) {
    console.log(`\n================ num=${num} page=${page} ================`)
    let r
    try {
      r = await read(num, page)
    } catch (e) {
      console.error('요청 실패:', e.message)
      continue
    }

    console.log('상태', r.res.status, '| 최종주소', r.res.url)
    console.log('charset — 헤더:', r.headerCharset, '/ meta:', r.metaCharset, '→ 사용:', r.cs)
    console.log('바이트', r.buf.byteLength, '| 본문 글자수', r.text.length)

    const dates = [...r.text.matchAll(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g)].map((m) => m[0])
    const quoted = [...r.text.matchAll(/["“”']([^"“”']{2,60})["“”']/g)].map((m) => m[1])
    console.log('날짜처럼 보이는 것 :', dates.slice(0, 8).join(', ') || '없음')
    console.log('따옴표 안 문자열   :', quoted.slice(0, 8).join(' / ') || '없음')
    console.log('"성가대" 포함      :', r.text.includes('성가대'))
    console.log('"|" 포함           :', r.text.includes('|'))
    console.log('--- 본문 앞 700자 ---')
    console.log(r.text.slice(0, 700))
  }

  console.log('\n위 출력을 통째로 복사해서 알려주세요. 그대로 맞춰 파싱 규칙을 고치겠습니다.')
})()
