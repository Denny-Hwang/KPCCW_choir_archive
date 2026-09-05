import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * Apps Script의 제목·재생목록명 파서를 실제 채널 데이터로 잡아 둔다.
 *
 * 이 파서는 시트를 건드리지 않는 순수 함수인데도 두 번 조용히 틀렸다.
 * 한 번은 전각 ｜ 구분자를 못 읽어 곡번호를 통째로 놓쳤고,
 * 한 번은 "남성찬양대를 위한 중앙성가 2집"까지 중2로 읽어 서로 다른 세 권을 한 권에 합쳤다.
 * 둘 다 시트에 잘못된 곡이 쌓인 뒤에야 드러났으므로 여기서 막는다.
 *
 * .gs 파일에는 최상위 실행문이 없어(선언뿐이다) 통째로 평가해도 안전하다.
 */
function loadSync(): Record<string, any> {
  // Apps Script는 .gs 파일을 하나의 전역 스코프에 합친다. 여기서도 그대로 합쳐 두면
  // 파일 사이에 같은 이름이 겹치는 순간(전에 실제로 있었다) 테스트가 먼저 터진다.
  const sandbox: Record<string, any> = {
    SpreadsheetApp: {
      DataValidationCriteria: { VALUE_IN_RANGE: 'VALUE_IN_RANGE', VALUE_IN_LIST: 'VALUE_IN_LIST' }
    }
  }
  createContext(sandbox)
  for (const file of ['Code.gs', 'Setup.gs', 'YouTubeSync.gs']) {
    runInContext(readFileSync(new URL('../../apps-script/' + file, import.meta.url), 'utf8'), sandbox)
  }
  return sandbox
}

const gs = loadSync()
const parsePlaylistBook = gs.parsePlaylistBook_ as (name: string) => string | null
const parseVideoTitle = gs.parseVideoTitle_ as (title: string) => {
  number: number | null
  title: string
  part: string
  isMidi: boolean
  bookCode: string | null
}

describe('parsePlaylistBook_', () => {
  it('앞머리 태그가 무엇이든 집 번호를 읽는다', () => {
    expect(parsePlaylistBook('[중앙아트] 중앙성가 43집')).toBe('중43')
    expect(parsePlaylistBook('[합창 듣기] 중앙성가 40집')).toBe('중40')
    expect(parsePlaylistBook('중앙성가 47집')).toBe('중47')
  })

  it('같은 권의 다른 판도 같은 집코드로 읽는다', () => {
    expect(parsePlaylistBook('중앙성가 16집 (구)')).toBe('중16')
    expect(parsePlaylistBook('중앙성가 14집 - ')).toBe('중14')
  })

  it('이름에 "중앙성가 N집"이 들어 있어도 다른 시리즈면 받지 않는다', () => {
    // 이 셋이 전부 중2가 되면 서로 다른 세 권이 한 권에 섞인다.
    expect(parsePlaylistBook('남성찬양대를 위한 중앙성가 2집')).toBeNull()
    expect(parsePlaylistBook('여성찬양대를 위한 중앙성가 2집')).toBeNull()
    expect(parsePlaylistBook('어린이 중앙성가 2집')).toBeNull()
    expect(parsePlaylistBook('[중앙아트] 어린이 중앙성가 3집')).toBeNull()
  })

  it('중앙성가가 아니면 null', () => {
    expect(parsePlaylistBook('하나님의 시선 9집')).toBeNull()
    expect(parsePlaylistBook('')).toBeNull()
  })
})

describe('parseVideoTitle_', () => {
  it('전각 ｜ 구분자 형식', () => {
    const r = parseVideoTitle('[중앙아트] 중앙성가 47집｜03. 주만이 내 반석 – 알토')
    expect(r.number).toBe(3)
    expect(r.title).toBe('주만이 내 반석')
    expect(r.part).toBe('알토')
    expect(r.bookCode).toBe('중47')
    expect(r.isMidi).toBe(false)
  })

  it('공백 구분자 형식', () => {
    const r = parseVideoTitle('[중앙아트] 중앙성가 40집 32. 기도송 - 합창')
    expect(r.number).toBe(32)
    expect(r.title).toBe('기도송')
    expect(r.part).toBe('합창')
    expect(r.bookCode).toBe('중40')
  })

  it('MIDI 표시를 분리한다', () => {
    const r = parseVideoTitle('[중앙아트] 중앙성가 41집｜13. 어버이의 사랑 – 소프라노 MIDI')
    expect(r.isMidi).toBe(true)
    expect(r.title).toBe('어버이의 사랑')
    expect(r.part).toBe('소프라노')
  })

  it('곡명 속 하이픈에 속지 않는다', () => {
    const r = parseVideoTitle('[중앙아트] 중앙성가 43집｜06. 주 - 나의 힘 – 베이스')
    expect(r.title).toBe('주 - 나의 힘')
    expect(r.part).toBe('베이스')
  })

  it('제목 속 집 이름도 다른 시리즈면 받지 않는다', () => {
    const r = parseVideoTitle('[중앙아트] 어린이 중앙성가 2집｜05. 예수님 사랑 – 합창')
    expect(r.number).toBe(5)
    expect(r.bookCode).toBeNull()
  })

  it('파트 표시가 없으면 합창으로 본다', () => {
    expect(parseVideoTitle('[중앙아트] 중앙성가 39집 07. 사랑의 종소리').part).toBe('합창')
  })

  it('실제 41집 재생목록의 제목 형식 (파트에 숫자가 붙는다)', () => {
    // PLN_65EI7yT6qAoAMFvI7a4Bc9BwtjwGLd — 채널 동기화가 못 가져와 직접 추가하는 목록.
    // 소프라노가 1·2로 갈라져 올라온다. 시트의 파트 드롭다운은 6개뿐이므로 둘 다
    // 소프라노로 읽고, 매칭에서 (곡, 파트)당 첫 번째만 남는다.
    const parts = [
      ['[중앙아트] 중앙성가 41집 01. 지금은 엘리야 때처럼 - 합창', '합창'],
      ['[중앙아트] 중앙성가 41집 01. 지금은 엘리야 때처럼 - 소프라노 1', '소프라노'],
      ['[중앙아트] 중앙성가 41집 01. 지금은 엘리야 때처럼 - 소프라노 2', '소프라노'],
      ['[중앙아트] 중앙성가 41집 01. 지금은 엘리야 때처럼 - 알토', '알토'],
      ['[중앙아트] 중앙성가 41집 01. 지금은 엘리야 때처럼 - 테너', '테너'],
    ] as const
    for (const [title, part] of parts) {
      const r = parseVideoTitle(title)
      expect(r.number).toBe(1)
      expect(r.title).toBe('지금은 엘리야 때처럼')
      expect(r.part).toBe(part)
      expect(r.bookCode).toBe('중41')
    }
  })
})

/** columnIndex_/getDataValidation만 쓰는 최소 시트 흉내. */
function fakeSheet(headers: string[], rules: Record<string, string[]>) {
  return {
    getName: () => 'practice_links',
    getLastColumn: () => headers.length,
    getRange(row: number, col: number, numRows?: number) {
      if (row === 1 && numRows === 1) return { getValues: () => [headers] }
      const header = headers[col - 1]
      return {
        getDataValidation() {
          const allowed = rules[header]
          if (!allowed) return null
          return {
            getCriteriaType: () => 'VALUE_IN_LIST',
            getCriteriaValues: () => [allowed]
          }
        }
      }
    }
  }
}

describe('splitByValidation_', () => {
  const split = gs.splitByValidation_ as (sheet: unknown, headers: string[], rows: unknown[][]) => {
    ok: unknown[][]
    bad: Array<{ row: unknown[]; reason: string }>
  }
  const headers = ['표시명', '파트', 'URL', '시작초', '올린이', '출처', '검증']
  const sheet = fakeSheet(headers, {
    파트: ['합창', '소프라노', '알토', '테너', '베이스', '반주'],
    출처: ['manual', 'youtube_channel']
  })

  it('드롭다운을 통과하는 행만 남긴다', () => {
    const rows = [
      ['가', '합창', 'u1', '', '', 'youtube_channel', false],
      ['나', '지휘', 'u2', '', '', 'youtube_channel', false]
    ]
    const r = split(sheet, headers, rows)
    expect(r.ok).toHaveLength(1)
    expect(r.bad).toHaveLength(1)
    // 어느 열의 어느 값이 걸렸는지 말해 준다. 시트가 던지는 예외는 이걸 말해 주지 않는다.
    expect(r.bad[0].reason).toContain('파트')
    expect(r.bad[0].reason).toContain('지휘')
    // 허용값이 몇 개이고 어디서 왔는지까지 붙인다. 범위가 굳어 새 곡을 못 담는 경우,
    // 이 두 가지가 없으면 "왜 목록에 없지?"에서 더 나아갈 수가 없다.
    expect(r.bad[0].reason).toContain('6개 중에 없음')
    expect(r.bad[0].reason).toContain('원본:')
  })

  it('빈 칸은 시트도 허용하므로 걸러 내지 않는다', () => {
    const rows = [['가', '', 'u1', '', '', '', false]]
    expect(split(sheet, headers, rows).ok).toHaveLength(1)
  })

  it('드롭다운이 없는 열은 무엇이 와도 통과시킨다', () => {
    const rows = [['아무 표시명이나', '합창', 'u1', '', '', 'manual', false]]
    expect(split(sheet, headers, rows).bad).toHaveLength(0)
  })
})

describe('buildLinkRow_', () => {
  const build = gs.buildLinkRow_ as (headers: string[], c: Record<string, unknown>) => unknown[]

  it('열 순서가 바뀌어도 이름대로 채운다', () => {
    // 예전 코드는 A~G 7칸에 위치로 썼다. 열이 하나만 밀려도 표시명 칸에
    // 파트가 들어가 드롭다운에 걸리고, 그 예외는 원인을 알려주지 않는다.
    const headers = ['파트', '표시명', 'URL', '검증', '출처', '올린이', '시작초']
    const row = build(headers, { display: '주만이 내 반석 (중47-03)', part: '알토', videoId: 'abc123' })
    expect(row[0]).toBe('알토')
    expect(row[1]).toBe('주만이 내 반석 (중47-03)')
    expect(row[2]).toBe('https://youtu.be/abc123')
    expect(row[3]).toBe(false)
    expect(row[4]).toBe('youtube_channel')
  })
})

/**
 * 배포가 파일 복사·붙여넣기라서, 한 파일에만 있는 헬퍼를 다른 파일이 부르면
 * 그 파일 하나만 갱신했을 때 `ReferenceError: …_ is not defined`로 터진다.
 * 실제로 splitByValidation_을 Code.gs에 두고 YouTubeSync.gs에서 불러 그렇게 터졌다.
 * 이름 뒤 밑줄이 내부 헬퍼 규약이므로, 그 호출이 전부 어딘가에 정의돼 있는지만 본다.
 */
describe('.gs 내부 헬퍼', () => {
  const files = ['Code.gs', 'Setup.gs', 'YouTubeSync.gs']
  const sources = files.map((f) => ({
    file: f,
    src: readFileSync(new URL('../../apps-script/' + f, import.meta.url), 'utf8')
  }))

  const defined = new Set<string>()
  for (const { src } of sources) {
    for (const m of src.matchAll(/function\s+([A-Za-z0-9_]+_)\s*\(/g)) defined.add(m[1])
  }

  it('호출하는 헬퍼가 모두 정의돼 있다', () => {
    const missing: string[] = []
    for (const { file, src } of sources) {
      // 주석만 걷어낸다. 문자열까지 지우려 하면 정규식 리터럴 안의 따옴표에
      // 짝이 어긋나 코드가 통째로 사라지고, 검사가 조용히 무력해진다.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      for (const m of code.matchAll(/(?:^|[^.\w])([A-Za-z][A-Za-z0-9_]*_)\s*\(/g)) {
        if (!defined.has(m[1])) missing.push(file + ' → ' + m[1] + '()')
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})
