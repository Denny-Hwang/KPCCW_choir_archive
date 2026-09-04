// TS를 그대로 실행하기 위한 얇은 래퍼. esbuild로 한 번 묶어 node로 돌린다.
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'choir-'))
const out = join(dir, 'bundle.mjs')
try {
  await build({
    entryPoints: ['scripts/verify-payload.ts'],
    bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: out, logLevel: 'error',
  })
  await import(pathToFileURL(out).href)
} finally {
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
}
