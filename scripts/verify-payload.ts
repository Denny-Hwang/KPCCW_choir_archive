/**
 * 시트 응답 점검 (앱과 같은 코드로).
 *
 * Apps Script 엔드포인트가 내려준 JSON을 앱이 실제로 어떻게 읽는지 그대로 보여준다.
 * 시트에 붙여넣은 데이터가 앱에 제대로 도착했는지 확인할 때 쓴다.
 *
 *   npm run verify -- payload.json
 *   npm run verify -- https://script.google.com/macros/s/.../exec
 *
 * 브라우저에서 exec URL을 열면 JSON이 그대로 보이므로, 저장해서 파일로 넘겨도 된다.
 */
import { readFileSync } from 'node:fs'
import { parsePayload } from '../src/lib/schema'
import {
  brokenLinks,
  buildServiceView,
  groupServicesByMonth,
  pickFeaturedService,
  songIndex,
  songUsage,
  sungHistory,
  totalAttendance,
} from '../src/lib/derive'
import { buildNotice, noticeWarnings } from '../src/lib/notice'
import { todayKey } from '../src/lib/date'
import type { RawPayload } from '../src/lib/types'

function countRows(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

async function load(source: string): Promise<RawPayload> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { redirect: 'follow' })
    if (!res.ok) throw new Error(`서버 응답 오류 ${res.status}`)
    const text = await res.text()
    try {
      return JSON.parse(text) as RawPayload
    } catch {
      throw new Error('JSON이 아닌 응답입니다. Apps Script 배포의 액세스 권한을 확인하세요.')
    }
  }
  return JSON.parse(readFileSync(source, 'utf8')) as RawPayload
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}\n${title}\n${'─'.repeat(60)}`)
}

async function main() {
  const source = process.argv[2]
  if (!source) {
    console.error('사용법: npm run verify -- <payload.json | exec URL>')
    process.exit(1)
  }

  const raw = await load(source)
  const data = parsePayload(raw)
  const today = todayKey()

  section('시트 → 앱 행 수 대조')
  const pairs: Array<[string, unknown, number]> = [
    ['books', raw.books, data.books.length],
    ['songs', raw.songs, data.songs.length],
    ['services', raw.services, data.services.length],
    ['rehearsals', raw.rehearsals, data.rehearsals.length],
    ['practice_links', raw.practiceLinks ?? raw.practice_links, data.practiceLinks.length],
  ]
  let dropped = 0
  for (const [name, rawRows, parsed] of pairs) {
    const before = countRows(rawRows)
    const lost = before - parsed
    dropped += lost
    console.log(`  ${name.padEnd(16)} 시트 ${String(before).padStart(4)} → 앱 ${String(parsed).padStart(4)}` +
      (lost > 0 ? `   ⚠ ${lost}행이 버려짐 (필수 칸이 비었거나 형식 오류)` : ''))
  }
  console.log(`  updatedAt: ${data.updatedAt || '(없음)'}`)

  section('설정 (config)')
  console.log(`  앱_제목        ${data.config.앱_제목}`)
  console.log(`  시간대         ${data.config.시간대}`)
  console.log(`  공지_빈줄구분  ${data.config.공지_빈줄구분}`)
  console.log(`  공지_곡목표시  ${data.config.공지_곡목표시}`)
  console.log(`  중복경고개월   ${data.config.중복경고개월}`)
  console.log(`  파트순서       ${data.config.공지_파트순서.join(' → ')}`)

  section('무결성')
  const problems: string[] = []
  const songs = songIndex(data.songs)
  for (const s of data.services) {
    for (const t of s.곡) if (!songs.has(t)) problems.push(`services ${s.찬양일}의 곡 "${t}"가 songs에 없음`)
  }
  const dates = new Set(data.services.map((s) => s.찬양일))
  for (const r of data.rehearsals) {
    if (!dates.has(r.찬양일)) problems.push(`rehearsals의 찬양일 ${r.찬양일}이 services에 없음`)
  }
  for (const l of data.practiceLinks) {
    if (!songs.has(l.표시명)) problems.push(`practice_links의 "${l.표시명}"가 songs에 없음`)
  }
  const broken = brokenLinks(data.practiceLinks)
  const unverifiedLinks = data.practiceLinks.filter((l) => !l.검증)

  console.log(problems.length ? problems.map((p) => `  ⚠ ${p}`).join('\n') : '  참조 무결성 이상 없음')
  console.log(`  주소 인식 실패 링크 ${broken.length}개` + (broken.length ? ':' : ''))
  for (const l of broken.slice(0, 10)) console.log(`      ${l.표시명} · ${l.파트} — ${l.URL}`)
  console.log(`  미검증 링크 ${unverifiedLinks.length}개 (공지에서 제외됨)`)

  section('월별 아카이브')
  for (const g of groupServicesByMonth(data.services)) {
    const line = g.services
      .map((s) => {
        const total = totalAttendance(s)
        return `${s.찬양일.slice(8)}일 ${s.곡.map((t) => songs.get(t)?.제목 ?? t).join(' / ') || '(선곡 없음)'}` +
          (total != null ? ` (총 ${total}명)` : '')
      })
      .join(' | ')
    console.log(`  ${g.month}  ${line}`)
  }

  section('중복 선곡 경고 대상 (오늘 기준)')
  const history = sungHistory(data.services)
  const recent = data.songs
    .map((s) => ({ s, u: songUsage(s.표시명, history, today, data.config.중복경고개월) }))
    .filter((x) => x.u.recent)
  console.log(recent.length
    ? recent.map((x) => `  · ${x.s.제목} — ${x.u.lastSung} (${x.u.monthsAgo}개월 전)`).join('\n')
    : '  없음')

  const featured = pickFeaturedService(data.services, today)
  if (featured) {
    section(`홈 화면 공지 (${featured.찬양일} ${featured.예배구분})`)
    const view = buildServiceView(featured, data)
    console.log(buildNotice({ service: featured, rehearsals: view.rehearsals, songs: view.songs, config: data.config })
      .split('\n').map((l) => '  ' + l).join('\n'))
    const warns = noticeWarnings(view.songs)
    if (warns.length) console.log('\n  경고:\n' + warns.map((w) => '    · ' + w).join('\n'))
  }

  const multi = data.services.filter((s) => s.곡.length >= 2)
  for (const s of multi) {
    section(`다곡 공지 확인 (${s.찬양일} ${s.예배구분}, ${s.곡.length}곡)`)
    const view = buildServiceView(s, data)
    console.log(buildNotice({ service: s, rehearsals: view.rehearsals, songs: view.songs, config: data.config })
      .split('\n').map((l) => '  ' + l).join('\n'))
  }

  section('요약')
  console.log(dropped === 0 && problems.length === 0 && broken.length === 0
    ? '  이상 없음 — 시트 데이터가 앱에 그대로 도착했습니다.'
    : `  버려진 행 ${dropped} · 참조 오류 ${problems.length} · 주소 오류 ${broken.length} — 위 내용을 확인하세요.`)
}

main().catch((e) => {
  console.error('실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
