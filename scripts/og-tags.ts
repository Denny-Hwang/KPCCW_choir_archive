/**
 * 배포 직전에 dist/index.html의 링크 미리보기를 다음 찬양으로 바꾼다 (src/lib/og.ts).
 *
 *   npm run og
 *
 * 무엇이 실패해도 빌드를 깨지 않는다 — 기본 문구로 남을 뿐이다. 미리보기 때문에 배포가 멈추면 안 된다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parsePayload } from '../src/lib/schema'
import { applyOgText, ogText, todayIn } from '../src/lib/og'
import type { RawPayload } from '../src/lib/types'

function endpoint(): string {
  const injected = process.env.VITE_API_URL?.trim()
  if (injected) return injected
  const src = readFileSync('src/lib/api.ts', 'utf8')
  return src.match(/const DEFAULT_ENDPOINT =\s*'([^']+)'/)?.[1] ?? ''
}

async function main() {
  const url = endpoint()
  if (!url) return console.log('og: 엔드포인트가 없어 건너뜁니다.')
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) return console.log(`og: 서버 응답 ${res.status} — 기본 문구로 둡니다.`)
  const data = parsePayload((await res.json()) as RawPayload)
  const og = ogText(data, todayIn(data.config.시간대))
  if (!og) return console.log('og: 다가오는 찬양이 없어 기본 문구로 둡니다.')
  const file = 'dist/index.html'
  writeFileSync(file, applyOgText(readFileSync(file, 'utf8'), og))
  console.log(`og: ${og.title} / ${og.description}`)
}

main().catch((e) => console.log('og: 건너뜀 —', e instanceof Error ? e.message : e))
