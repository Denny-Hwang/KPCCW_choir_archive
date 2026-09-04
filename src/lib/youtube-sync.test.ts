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
  const src = readFileSync(new URL('../../apps-script/YouTubeSync.gs', import.meta.url), 'utf8')
  const sandbox: Record<string, any> = {}
  createContext(sandbox)
  runInContext(src, sandbox)
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
})
