/**
 * public/icon.svg · icon-maskable.svg → PNG.
 *
 * 이미지 도구 없이 크로미움으로 렌더한다(플레이라이트가 이미 있다).
 * SVG를 고쳤을 때만 돌리면 된다:  node scripts/render-icons.mjs
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const svg = readFileSync('public/icon.svg', 'utf8')

const maskable = readFileSync('public/icon-maskable.svg', 'utf8')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const targets = [
  ['public/icon-192.png', svg, 192],
  ['public/icon-512.png', svg, 512],
  ['public/icon-maskable-512.png', maskable, 512],
  ['public/apple-touch-icon.png', svg, 180],
  ['public/favicon-32.png', svg, 32],
]
for (const [out, source, size] of targets) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    { waitUntil: 'load' },
  )
  await page.screenshot({ path: out, omitBackground: false })
  await page.close()
}
await b.close()
console.log('done')
