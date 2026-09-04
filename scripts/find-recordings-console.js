/*
 * 교회 게시판에서 성가대 실황영상 주소를 한 번에 모으는 스니펫.
 *
 * 설치할 것 없다. 브라우저에서 그대로 돌린다.
 *   1. https://www.kpccw.org/main/sub.html?pageCode=18&vodType=7 를 연다
 *   2. F12 → Console 탭
 *   3. 아래를 통째로 붙여넣고 Enter
 *   4. 끝나면 결과가 클립보드에 복사된다. 그대로 붙여넣어 주면 된다.
 *
 * 같은 사이트 안에서 돌기 때문에 차단이나 CORS 문제가 없다.
 */
(async () => {
  const FROM = 150            // 훑을 가장 작은 번호
  const TO = 390              // 훑을 가장 큰 번호
  const DELAY = 300           // 요청 간격(ms). 교회 서버 배려용, 낮추지 말 것
  const PERFORMER = 'KPCCW 성가대'  // 빈 문자열로 두면 전부 수집

  const found = []
  const total = TO - FROM + 1
  let done = 0

  const decode = (buf, headerCharset) => {
    const peek = new TextDecoder('latin1').decode(buf.slice(0, 2048))
    const declared = (peek.match(/charset\s*=\s*["']?\s*([\w-]+)/i) || [])[1]
    const cs = (headerCharset || declared || 'utf-8').toLowerCase()
    try {
      return new TextDecoder(cs).decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }

  console.log(`num ${FROM}~${TO} (${total}개) 탐색 시작 — 약 ${Math.ceil((total * DELAY) / 1000 / 60)}분 걸립니다`)

  for (let num = TO; num >= FROM; num--) {
    const path =
      `/main/sub.html?page=1&num=${num}&pageCode=18&category=&srcYear=&keyfield=&key=&Mode=view&vodType=7`
    try {
      const res = await fetch(path)
      const headerCharset = (((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)) || [])[1]
      const html = decode(await res.arrayBuffer(), headerCharset)
      const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

      // "공연명 | YYYY.MM.DD" 를 찾는다
      const meta = text.match(/([가-힣A-Za-z0-9 ()&·.-]{2,40}?)\s*\|\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
      if (!meta) continue

      const 공연 = meta[1].trim()
      if (PERFORMER && !공연.includes(PERFORMER)) continue

      const 날짜 = `${meta[2]}-${String(meta[3]).padStart(2, '0')}-${String(meta[4]).padStart(2, '0')}`
      const before = text.slice(0, meta.index)
      const quoted = [...before.matchAll(/["“”']([^"“”']{2,60})["“”']/g)]
      const 제목 = quoted.length ? quoted[quoted.length - 1][1].trim() : ''

      found.push({ num, 날짜, 제목, 공연, url: location.origin + path })
      console.log('✔', num, 날짜, 제목)
    } catch (e) {
      /* 없는 글이거나 일시적 오류 — 건너뛴다 */
    }

    done++
    if (done % 25 === 0) console.log(`… ${done}/${total} (num=${num}), 지금까지 ${found.length}건`)
    if (num > FROM) await new Promise((r) => setTimeout(r, DELAY))
  }

  found.sort((a, b) => a.날짜.localeCompare(b.날짜))
  console.table(found)

  const tsv = found.map((f) => `${f.날짜}\t${f.제목}\t${f.url}`).join('\n')
  try {
    copy(tsv)
    console.log(`\n총 ${found.length}건 — 클립보드에 복사했습니다. 그대로 붙여넣어 주세요.`)
  } catch {
    console.log(`\n총 ${found.length}건 — 아래를 복사해 주세요:\n\n${tsv}`)
  }
  return found
})()
