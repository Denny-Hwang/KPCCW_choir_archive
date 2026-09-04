/**
 * 교회 Internet TV 게시판에서 성가대 실황영상을 찾아 `기록영상URL` 값을 뽑는다.
 *
 * 게시판의 `num`은 예측할 수 없다. 같은 계정으로 다른 영상들과 섞여 올라가면서
 * 붙은 전체 일련번호라, 번호·날짜 어느 것과도 규칙적인 관계가 없다.
 * 그래서 범위를 훑어 제목·공연·날짜를 읽고 대조하는 수밖에 없다.
 *
 *   node scripts/find-recordings.mjs --from 200 --to 400
 *   node scripts/find-recordings.mjs --from 200 --to 400 --performer "KPCCW 성가대"
 *   node scripts/find-recordings.mjs --from 200 --to 400 --out found.json
 *
 * 교회 서버를 배려해 요청 사이에 간격을 둔다(--delay, 기본 400ms).
 */

const DEFAULT_BASE = 'https://www.kpccw.org/main/sub.html'
let BASE = DEFAULT_BASE

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** 인자 파싱은 실행할 때만 한다 — 테스트에서 import해도 종료되지 않도록. */
function readOptions() {
  const from = Number(arg('from', 200))
  const to = Number(arg('to', 400))
  if (!(from >= 0) || !(to >= from)) throw new Error('--from / --to 범위가 올바르지 않습니다.')
  return {
    from,
    to,
    delay: Number(arg('delay', 400)),
    performer: arg('performer', 'KPCCW 성가대'),
    outFile: arg('out', ''),
    vodType: arg('vodType', '7'),
    pageCode: arg('pageCode', '18'),
    // 테스트용. 가짜 게시판을 띄워 전체 동작을 확인할 때 쓴다.
    base: arg('base', DEFAULT_BASE),
  }
}

let vodType = '7'
let pageCode = '18'

function urlFor(num) {
  return `${BASE}?page=1&num=${num}&pageCode=${pageCode}&category=&srcYear=&keyfield=&key=&Mode=view&vodType=${vodType}`
}

/** 한국 교회 사이트는 EUC-KR인 경우가 많다. 선언된 charset을 보고 디코딩한다. */
async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const head = buf.subarray(0, 2048).toString('latin1')
  const declared = head.match(/charset\s*=\s*["']?\s*([\w-]+)/i)?.[1]?.toLowerCase()
  const charset = declared && !/utf-?8/.test(declared) ? declared : 'utf-8'
  try {
    return new TextDecoder(charset).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * 상세 페이지에서 제목·공연·날짜를 뽑는다.
 * 화면은 이렇게 생겼다:  "참 아름다워라"   /   KPCCW 성가대 | 2026.05.24
 */
export function parseDetail(html) {
  const text = stripTags(html)

  const meta = text.match(/([가-힣A-Za-z0-9 ()&·.-]{2,40}?)\s*\|\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!meta) return null

  const 날짜 = `${meta[2]}-${String(meta[3]).padStart(2, '0')}-${String(meta[4]).padStart(2, '0')}`
  const 공연 = meta[1].trim()

  // 제목은 따옴표로 감싸여 있다. 공연·날짜 바로 앞의 것을 고른다.
  const before = text.slice(0, meta.index)
  const quoted = [...before.matchAll(/["“”']([^"“”']{2,60})["“”']/g)]
  const 제목 = quoted.length ? quoted[quoted.length - 1][1].trim() : ''

  return { 제목, 공연, 날짜 }
}

async function main() {
  const { from, to, delay, performer, outFile, vodType: vt, pageCode: pc, base } = readOptions()
  vodType = vt
  pageCode = pc
  BASE = base

  const found = []
  const total = to - from + 1
  let scanned = 0

  console.error(`num ${from}~${to} (${total}개) 탐색 · 간격 ${delay}ms · 공연 필터 "${performer}"`)

  for (let num = to; num >= from; num--) {
    scanned++
    if (scanned % 25 === 0) console.error(`  … ${scanned}/${total} (num=${num}), 지금까지 ${found.length}건`)

    let entry = null
    try {
      entry = parseDetail(await fetchText(urlFor(num)))
    } catch {
      // 없는 글이거나 일시적 오류. 건너뛴다.
    }

    if (entry && (!performer || entry.공연.includes(performer))) {
      found.push({ num, ...entry, url: urlFor(num) })
      console.error(`  ✔ num=${num}  ${entry.날짜}  "${entry.제목}"  (${entry.공연})`)
    }

    if (num > from) await new Promise((r) => setTimeout(r, delay))
  }

  found.sort((a, b) => a.날짜.localeCompare(b.날짜))

  console.error(`\n찾은 항목 ${found.length}건\n`)
  console.log('# 찬양일\t제목\t기록영상URL   ← services 시트의 K열에 날짜 맞춰 넣으세요')
  for (const f of found) console.log(`${f.날짜}\t${f.제목}\t${f.url}`)

  if (outFile) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(outFile, JSON.stringify(found, null, 2))
    console.error(`\n${outFile}에 저장했습니다.`)
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error('실패:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
