import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Apps Script 쓰기 엔드포인트(§12.2)를 가짜 스프레드시트 위에서 실제로 돌려 본다.
 *
 * 이 경로는 시트의 드롭다운을 우회하므로, 곡명 실재 확인·중복 행 방지·연습 중복 방지를
 * 스크립트가 직접 해야 한다. 그 규칙이 조용히 무너지면 총무가 시트에서 손으로 되돌려야 하니
 * 여기서 잡는다. 셀 API는 getRange/getValues/setValues/setValue만 쓰도록 좁혀 두었다.
 */

type Cell = unknown

class FakeSheet {
  constructor(public name: string, public rows: Cell[][]) {}
  getName() { return this.name }
  getLastRow() { return this.rows.length }
  getLastColumn() { return this.rows[0]?.length ?? 0 }
  getMaxRows() { return this.rows.length + 100 }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sheet = this
    return {
      getValues() {
        const out: Cell[][] = []
        for (let r = 0; r < numRows; r++) {
          const line = sheet.rows[row - 1 + r] ?? []
          out.push(Array.from({ length: numCols }, (_, c) => line[col - 1 + c] ?? ''))
        }
        return out
      },
      setValues(values: Cell[][]) {
        values.forEach((line, r) => {
          const idx = row - 1 + r
          while (sheet.rows.length <= idx) sheet.rows.push([])
          line.forEach((v, c) => {
            sheet.rows[idx][col - 1 + c] = v
          })
        })
      },
      setValue(v: Cell) {
        this.setValues([[v]])
      },
    }
  }
}

class FakeSpreadsheet {
  sheets: Record<string, FakeSheet>
  constructor(sheets: FakeSheet[]) {
    this.sheets = Object.fromEntries(sheets.map((s) => [s.name, s]))
  }
  getSheetByName(name: string) { return this.sheets[name] ?? null }
  getSpreadsheetTimeZone() { return 'America/Los_Angeles' }
}

/** 시트 날짜 셀 흉내. 자정 UTC로 두고 formatDate도 UTC로 읽어 시간대 문제를 테스트 밖으로 뺀다. */
function utcDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

function formatDate(d: Date, _tz: string, pattern: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const map: Record<string, string> = {
    yyyy: String(d.getUTCFullYear()),
    'yyyy-MM-dd': `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    'HH:mm': `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  }
  return map[pattern] ?? pattern
}

const SERVICE_HEADERS = ['찬양일', '예배구분', '곡1', '곡2', '곡3', 'S인원', 'A인원', 'T인원', 'B인원', '세션', '기록영상URL', '메모']
const REHEARSAL_HEADERS = ['찬양일', '연습일', '시각', '구분', '장소', '메모']

function fixture() {
  return new FakeSpreadsheet([
    new FakeSheet('songs', [
      ['곡코드', '표시명', '제목'],
      ['중47-01', '가곡 (중47-01)', '가곡'],
      ['중47-02', '나곡 (중47-02)', '나곡'],
      ['중47-03', '다곡 (중47-03)', '다곡'],
      ['중47-04', '라곡 (중47-04)', '라곡'],
    ]),
    new FakeSheet('services', [
      SERVICE_HEADERS,
      [utcDate('2026-10-25'), '주일', '가곡 (중47-01)', '', '', '', '', '', '', '', '', ''],
      [utcDate('2026-08-23'), '주일', '나곡 (중47-02)', '다곡 (중47-03)', '라곡 (중47-04)', '', '', '', '', '', '', ''],
    ]),
    new FakeSheet('rehearsals', [
      REHEARSAL_HEADERS,
      [utcDate('2026-10-25'), utcDate('2026-10-11'), '13:30', '주일', '', ''],
    ]),
    new FakeSheet('config', [['키', '값']]),
  ])
}

function load() {
  const props = new Map<string, string>([['WRITE_KEY', 'secret']])
  let lockFree = true
  const state = { ss: fixture(), props, validationsInstalled: 0, setLockFree: (v: boolean) => { lockFree = v } }
  const sandbox: Record<string, any> = {
    SpreadsheetApp: {
      DataValidationCriteria: { VALUE_IN_RANGE: 'VALUE_IN_RANGE', VALUE_IN_LIST: 'VALUE_IN_LIST' },
      getActiveSpreadsheet: () => state.ss,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => props.set(k, v),
        deleteProperty: (k: string) => props.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => {} }),
    },
    Utilities: {
      parseDate: (key: string) => utcDate(key),
      formatDate,
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text: string) => ({ setMimeType: () => ({ text }) }),
    },
  }
  createContext(sandbox)
  for (const file of ['Code.gs', 'Setup.gs', 'YouTubeSync.gs']) {
    runInContext(readFileSync(new URL('../../apps-script/' + file, import.meta.url), 'utf8'), sandbox)
  }
  // 드롭다운 다시 심기는 진짜 시트 API가 필요하다. 불렸는지만 센다.
  sandbox.installValidations_ = () => { state.validationsInstalled++ }
  return { gs: sandbox, state }
}

function post(gs: Record<string, any>, body: unknown) {
  const out = gs.doPost({ postData: { contents: JSON.stringify(body) } })
  return JSON.parse(out.text)
}

const basePayload = {
  찬양일: '2026-11-22',
  예배구분: '주일',
  곡: ['나곡 (중47-02)'],
  rehearsals: [
    { 연습일: '2026-11-08', 시각: '13:30', 구분: '주일', 장소: '' },
    { 연습일: '2026-11-15', 시각: '13:30', 구분: '주일', 장소: '' },
    { 연습일: '2026-11-18', 시각: '20:00', 구분: '수요일', 장소: '' },
  ],
}

describe('doPost / handleWrite_', () => {
  let gs: Record<string, any>
  let state: ReturnType<typeof load>['state']
  beforeEach(() => {
    ;({ gs, state } = load())
  })

  it('키가 틀리면 아무것도 쓰지 않는다', () => {
    const r = post(gs, { key: 'wrong', action: 'applyPlan', payload: basePayload })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('편집 키')
    expect(state.ss.sheets.services.rows).toHaveLength(3)
  })

  it('시트에 키가 없으면 메뉴 위치를 알려준다', () => {
    state.props.delete('WRITE_KEY')
    const r = post(gs, { key: 'secret', action: 'applyPlan', payload: basePayload })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('앱 편집 키 설정')
  })

  it('모르는 동작은 거부한다', () => {
    expect(post(gs, { key: 'secret', action: 'deleteEverything' }).ok).toBe(false)
  })

  it('본문이 JSON이 아니어도 JSON으로 답한다', () => {
    const out = gs.doPost({ postData: { contents: '<html>' } })
    expect(JSON.parse(out.text).ok).toBe(false)
  })

  it('다른 쓰기가 잠그고 있으면 기다리라고 한다', () => {
    state.setLockFree(false)
    const r = post(gs, { key: 'secret', action: 'applyPlan', payload: basePayload })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('진행 중')
  })
})

describe('applyPlan_', () => {
  let gs: Record<string, any>
  let state: ReturnType<typeof load>['state']
  const apply = (payload: unknown) => post(gs, { key: 'secret', action: 'applyPlan', payload })
  beforeEach(() => {
    ;({ gs, state } = load())
  })

  it('새 찬양일이면 services 한 행과 연습 행들을 헤더 이름대로 붙인다', () => {
    const r = apply(basePayload)
    expect(r).toMatchObject({ ok: true, service: 'created', songsAdded: ['나곡 (중47-02)'], rehearsalsAdded: 3, rehearsalsSkipped: 0 })

    const services = state.ss.sheets.services.rows
    expect(services).toHaveLength(4)
    const added = services[3]
    expect(formatDate(added[0] as Date, '', 'yyyy-MM-dd')).toBe('2026-11-22')
    expect(added.slice(1, 5)).toEqual(['주일', '나곡 (중47-02)', '', ''])
    expect(added).toHaveLength(SERVICE_HEADERS.length)

    const rehearsals = state.ss.sheets.rehearsals.rows
    expect(rehearsals).toHaveLength(5)
    expect(rehearsals.slice(2).map((row) => [formatDate(row[1] as Date, '', 'yyyy-MM-dd'), row[2], row[3]])).toEqual([
      ['2026-11-08', '13:30', '주일'],
      ['2026-11-15', '13:30', '주일'],
      ['2026-11-18', '20:00', '수요일'],
    ])
    // 드롭다운 범위가 굳어 새 곡을 거부하는 일을 막기 위해 규칙을 다시 심는다.
    expect(state.validationsInstalled).toBe(1)
  })

  it('열 순서가 달라도 이름대로 채운다', () => {
    state.ss.sheets.services.rows = [['예배구분', '메모', '곡1', '찬양일', '곡2', '곡3']]
    const r = apply(basePayload)
    expect(r.ok).toBe(true)
    const row = state.ss.sheets.services.rows[1]
    expect(row[0]).toBe('주일')
    expect(row[2]).toBe('나곡 (중47-02)')
    expect(formatDate(row[3] as Date, '', 'yyyy-MM-dd')).toBe('2026-11-22')
  })

  it('같은 (찬양일, 예배구분) 행이 있으면 새 행 대신 빈 곡 칸을 채운다', () => {
    const r = apply({
      ...basePayload,
      찬양일: '2026-10-25',
      곡: ['다곡 (중47-03)'],
      rehearsals: [
        { 연습일: '2026-10-11', 시각: '13:30', 구분: '주일', 장소: '' },
        { 연습일: '2026-10-18', 시각: '13:30', 구분: '주일', 장소: '' },
      ],
    })
    expect(r).toMatchObject({ ok: true, service: 'updated', songsAdded: ['다곡 (중47-03)'], rehearsalsAdded: 1, rehearsalsSkipped: 1 })
    const services = state.ss.sheets.services.rows
    expect(services).toHaveLength(3)
    expect(services[1].slice(2, 5)).toEqual(['가곡 (중47-01)', '다곡 (중47-03)', ''])
    expect(state.ss.sheets.rehearsals.rows).toHaveLength(3)
  })

  it('예배구분이 다르면 다른 행이다', () => {
    const r = apply({ ...basePayload, 찬양일: '2026-10-25', 예배구분: '저녁' })
    expect(r.service).toBe('created')
    expect(state.ss.sheets.services.rows).toHaveLength(4)
  })

  it('이미 그 날에 있는 곡은 건너뛰고 아무것도 바꾸지 않는다', () => {
    const before = JSON.stringify(state.ss.sheets.services.rows)
    const r = apply({ ...basePayload, 찬양일: '2026-10-25', 곡: ['가곡 (중47-01)'], rehearsals: [] })
    expect(r).toMatchObject({ ok: true, service: 'updated', songsAdded: [], songsSkipped: ['가곡 (중47-01)'] })
    expect(JSON.stringify(state.ss.sheets.services.rows)).toBe(before)
  })

  it('곡 세 칸이 다 차 있으면 거부하고 시트를 건드리지 않는다', () => {
    const before = JSON.stringify(state.ss.sheets.services.rows)
    const r = apply({ ...basePayload, 찬양일: '2026-08-23', 곡: ['가곡 (중47-01)'] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('빈 곡 칸')
    expect(JSON.stringify(state.ss.sheets.services.rows)).toBe(before)
  })

  it('songs에 없는 곡명은 이름을 짚어 거부한다', () => {
    const r = apply({ ...basePayload, 곡: ['없는곡 (중99-01)'] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('없는곡 (중99-01)')
    expect(state.ss.sheets.services.rows).toHaveLength(3)
  })

  it('찬양일이 날짜가 아니거나 곡이 없으면 거부한다', () => {
    expect(apply({ ...basePayload, 찬양일: '10월 25일' }).ok).toBe(false)
    expect(apply({ ...basePayload, 곡: [] }).ok).toBe(false)
    expect(apply({ ...basePayload, 곡: ['가곡 (중47-01)', '나곡 (중47-02)', '다곡 (중47-03)', '라곡 (중47-04)'] }).ok).toBe(false)
  })

  it('날짜가 아닌 연습일은 조용히 버린다', () => {
    const r = apply({ ...basePayload, rehearsals: [{ 연습일: '언젠가', 시각: '13:30', 구분: '주일', 장소: '' }] })
    expect(r.ok).toBe(true)
    expect(r.rehearsalsAdded).toBe(0)
  })
})
