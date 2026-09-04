import { describe, expect, it } from 'vitest'
import { bool, dateKey, num, parseConfig, parsePayload, parseSeasonHints, parseService, str, timeKey } from './schema'

describe('원시값 강제 변환', () => {
  it('bool은 시트 체크박스와 문자열 TRUE를 모두 받는다', () => {
    for (const v of [true, 'TRUE', 'true', 'Y', '예', 1]) expect(bool(v), String(v)).toBe(true)
    for (const v of [false, 'FALSE', '', null, undefined, 0, '아니오']) expect(bool(v), String(v)).toBe(false)
  })

  it('num은 숫자가 아닌 입력에서 null을 낸다', () => {
    expect(num(8)).toBe(8)
    expect(num('8')).toBe(8)
    expect(num('8명')).toBe(8)
    expect(num('')).toBeNull()
    expect(num('미정')).toBeNull()
  })

  it('str은 Date와 null을 안전하게 처리한다', () => {
    expect(str(null)).toBe('')
    expect(str('  값  ')).toBe('값')
  })
})

describe('dateKey', () => {
  it('날짜만 있는 문자열은 그대로 쓴다', () => {
    expect(dateKey('2026-08-23')).toBe('2026-08-23')
  })

  it('시각이 붙은 ISO는 시트 시간대(KST)로 환산한다', () => {
    // Apps Script가 KST 자정 셀을 직렬화하면 전날 15:00Z가 된다. 하루 밀리면 안 된다.
    expect(dateKey('2026-08-22T15:00:00.000Z')).toBe('2026-08-23')
    expect(dateKey('2026-08-23T00:00:00.000Z')).toBe('2026-08-23')
    expect(dateKey('2026-12-31T15:00:00.000Z')).toBe('2027-01-01')
  })

  it('점·슬래시 구분자를 받는다', () => {
    expect(dateKey('2026/8/3')).toBe('2026-08-03')
    expect(dateKey('2026.12.25')).toBe('2026-12-25')
  })

  it('Date 객체는 로컬 날짜로 읽는다', () => {
    expect(dateKey(new Date(2026, 7, 23))).toBe('2026-08-23')
  })

  it('읽을 수 없으면 빈 문자열', () => {
    expect(dateKey('')).toBe('')
    expect(dateKey('미정')).toBe('')
  })
})

describe('timeKey', () => {
  it('여러 표기를 HH:MM으로 모은다', () => {
    expect(timeKey('13:30')).toBe('13:30')
    expect(timeKey('2026-08-23T13:30:00+09:00')).toBe('13:30')
    expect(timeKey('2026-08-23T04:30:00.000Z')).toBe('13:30')
    expect(timeKey('오후 1시 30분')).toBe('13:30')
    expect(timeKey('8시')).toBe('08:00')
    expect(timeKey(new Date(2026, 0, 1, 20, 0))).toBe('20:00')
  })
})

describe('parseService', () => {
  it('곡1~곡3 중 채워진 것만 순서대로 모은다', () => {
    const s = parseService({ 찬양일: '2026-08-23', 예배구분: '주일 1부', 곡1: '가곡 (중47-01)', 곡2: '', 곡3: '다곡 (중47-03)', S인원: 8, A인원: '7', T인원: '', B인원: 5 })
    expect(s.곡).toEqual(['가곡 (중47-01)', '다곡 (중47-03)'])
    expect(s.S인원).toBe(8)
    expect(s.A인원).toBe(7)
    expect(s.T인원).toBeNull()
  })

  it('헤더에 공백이 섞여도 같은 열로 본다', () => {
    expect(parseService({ '찬양일 ': '2026-08-23', 'S 인원': 8 }).S인원).toBe(8)
  })
})

describe('parseConfig', () => {
  it('키/값 행을 읽고 빈 값은 기본값으로 채운다', () => {
    const config = parseConfig([
      { 키: '앱_제목', 값: '○○교회 성가대' },
      { 키: '공지_파트순서', 값: '합창,베이스' },
      { 키: '중복경고개월', 값: '24' },
    ])
    expect(config.앱_제목).toBe('○○교회 성가대')
    expect(config.공지_파트순서).toEqual(['합창', '베이스'])
    expect(config.중복경고개월).toBe(24)
    expect(config.공지_연습헤더).toBe('<성가연습 일정>')
  })

  it('알 수 없는 파트 이름은 버리고, 전부 버려지면 기본 순서로 되돌린다', () => {
    expect(parseConfig([{ 키: '공지_파트순서', 값: '오르간,하프' }]).공지_파트순서).toEqual([
      '합창', '소프라노', '알토', '테너', '베이스', '반주',
    ])
  })

  it('config가 아예 없어도 기본값을 낸다', () => {
    expect(parseConfig(undefined).공지_제목형식).toBe('{M}월 {D}일 주일 찬양')
  })
})

describe('parseSeasonHints', () => {
  it('"1:일반, 12:성탄" 형식을 읽는다', () => {
    expect(parseSeasonHints('1:일반, 12:성탄')).toEqual({ 1: '일반', 12: '성탄' })
    expect(parseSeasonHints('13:없는달, x:쓰레기')).toEqual({})
  })
})

describe('parsePayload', () => {
  it('키가 비거나 깨진 행은 버리고 나머지를 살린다', () => {
    const data = parsePayload({
      updatedAt: '2026-09-03T10:00:00Z',
      books: [{ 집코드: '중47', 권: 47, 보유: 'TRUE' }, { 집코드: '' }],
      songs: [{ 곡코드: '중47-03', 제목: '주만이 내 반석', 검증: 'FALSE' }, { 제목: '' }],
      services: [{ 찬양일: '2026-08-23', 곡1: '주만이 내 반석 (중47-03)' }, { 찬양일: '' }],
      practice_links: [{ 표시명: 'a', 파트: '합창', URL: 'https://youtu.be/vk1nDmhdy2w' }, { 표시명: 'b', URL: '' }],
      config: [{ 키: '앱_제목', 값: '테스트' }],
    })
    expect(data.books).toHaveLength(1)
    expect(data.songs).toHaveLength(1)
    expect(data.services).toHaveLength(1)
    expect(data.practiceLinks).toHaveLength(1)
    expect(data.config.앱_제목).toBe('테스트')
  })

  it('표시명 수식이 깨진 곡도 곡코드로 복구한다', () => {
    expect(parsePayload({ songs: [{ 곡코드: '중47-03', 제목: '주만이 내 반석' }] }).songs[0].표시명).toBe(
      '주만이 내 반석 (중47-03)',
    )
  })

  it('payload가 null이어도 빈 데이터를 낸다', () => {
    const data = parsePayload(null)
    expect(data.songs).toEqual([])
    expect(data.config.앱_제목).toBe('성가대 아카이브')
  })
})
