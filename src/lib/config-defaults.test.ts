import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, parseConfig } from './schema'

/**
 * Apps Script가 시트에 심는 기본값과 앱의 기본값이 어긋나지 않게 잡아 둔다.
 *
 * 시트에 값이 있으면 언제나 시트가 이기므로, 둘이 다르면 앱은 코드 기본값이 아니라
 * 시트에 심긴 값으로 동작한다. 실제로 `공지_빈줄구분`이 코드에서는 TRUE, Setup.gs에서는
 * FALSE로 갈려 있었고, 시트에 FALSE가 심겨 공지에서 빈 줄이 사라졌다.
 */
function readSetupDefaults(): Array<{ 키: string; 값: string }> {
  const src = readFileSync(new URL('../../apps-script/Setup.gs', import.meta.url), 'utf8')
  const block = src.match(/var CONFIG_DEFAULTS = \[([\s\S]*?)\n\];/)
  if (!block) throw new Error('Setup.gs에서 CONFIG_DEFAULTS를 찾지 못했습니다.')
  return [...block[1].matchAll(/\['([^']*)',\s*'([^']*)'\]/g)].map((m) => ({ 키: m[1], 값: m[2] }))
}

describe('Setup.gs의 config 기본값', () => {
  const rows = readSetupDefaults()

  it('앱이 아는 모든 설정 키를 담고 있다', () => {
    const keys = new Set(rows.map((r) => r.키))
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (key === 'raw') continue
      expect(keys.has(key), `Setup.gs에 '${key}' 기본값이 없습니다`).toBe(true)
    }
  })

  it('그 값을 앱이 읽으면 앱의 기본값과 같아진다', () => {
    const { raw: _raw, ...parsed } = parseConfig(rows)
    const { raw: _defaultRaw, ...expected } = DEFAULT_CONFIG
    expect(parsed).toEqual(expected)
  })
})
