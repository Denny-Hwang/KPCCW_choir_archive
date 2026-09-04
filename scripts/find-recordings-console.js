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

  // 0건으로 끝났을 때 원인을 알 수 있게 세어 둔다.
  // (예전 판은 실패를 전부 삼켜서, 못 찾은 이유를 알 방법이 없었다.)
  const stat = { ok: 0, http: 0, error: 0, noMeta: 0, otherPerformer: 0 }
  let sample = null

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
      if (!res.ok) { stat.http++; done++; if (num > FROM) await new Promise((r) => setTimeout(r, DELAY)); continue }
      stat.ok++
      const headerCharset = (((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)) || [])[1]
      const html = decode(await res.arrayBuffer(), headerCharset)
      const text = html
        // 스크립트·스타일 본문을 먼저 없앤다. 이걸 안 하면 페이지 상단의 자바스크립트
        // 문자열("0", "sub" …)이 따옴표 후보로 잡혀 제목을 못 찾는다.
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()

      // 화면의 `제목 ｜공연｜ 날짜`. 구분자는 전각 ｜(U+FF5C)이다.
      // 일부 페이지에는 그 앞에 플레이어 경고문이 끼어들고, 빵부스러기도 항상 붙는다.
      const meta = text.match(/[｜|]\s*([^｜|]{2,40}?)\s*[｜|]\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
      if (!meta) {
        stat.noMeta++
        if (!sample && text.length > 40) sample = { num, text: text.slice(0, 900) }
        continue
      }

      const 공연 = meta[1].trim()
      if (PERFORMER && !공연.includes(PERFORMER)) { stat.otherPerformer++; continue }

      const 날짜 = `${meta[2]}-${String(meta[3]).padStart(2, '0')}-${String(meta[4]).padStart(2, '0')}`

      // 제목은 ｜ 앞에 남는다. 빵부스러기와 경고문을 잘라낸 뒤의 꼬리가 제목이다.
      let head = text.slice(0, meta.index)
      for (const cut of ['특송(Special Music)', '트래픽 초과 안내', '취소 재생', '재생하시겠습니까?']) {
        const i = head.lastIndexOf(cut)
        if (i >= 0) head = head.slice(i + cut.length)
      }
      const 제목 = head.replace(/["“”']/g, '').replace(/\s+/g, ' ').trim()

      found.push({ num, 날짜, 제목, 공연, url: location.origin + path })
      console.log('✔', num, 날짜, 제목)
    } catch (e) {
      stat.error++
    }

    done++
    if (done % 25 === 0) console.log(`… ${done}/${total} (num=${num}), 지금까지 ${found.length}건`)
    if (num > FROM) await new Promise((r) => setTimeout(r, DELAY))
  }

  found.sort((a, b) => a.날짜.localeCompare(b.날짜))

  console.log(
    `\n응답 성공 ${stat.ok} · HTTP 오류 ${stat.http} · 요청 실패 ${stat.error}` +
      ` · 형식 못 읽음 ${stat.noMeta} · 다른 공연 ${stat.otherPerformer}`
  )

  if (!found.length) {
    console.warn('한 건도 찾지 못했습니다. 아래를 알려주시면 파싱 규칙을 고치겠습니다.')
    if (sample) {
      console.log(`\n--- 내용은 있는데 형식을 못 읽은 페이지 (num=${sample.num}) 앞 900자 ---`)
      console.log(sample.text)
    } else if (stat.ok === 0) {
      console.log('요청 자체가 실패했습니다. 위 오류 수치를 알려주세요.')
    } else {
      console.log('응답은 왔지만 읽을 내용이 없습니다. scripts/diagnose-board.js 를 돌려주세요.')
    }
    return found
  }

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
