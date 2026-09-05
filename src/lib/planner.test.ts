import { describe, expect, it } from 'vitest'
import { buildCandidates, filterCandidates, EMPTY_FILTER, initialPlan, parseRehearsalPattern, planDifficultyLoad, suggestRehearsals } from './planner'
import { buildRehearsalPaste, buildServicePaste, findDuplicateServiceDates } from './paste'
import { DEFAULT_CONFIG } from './schema'
import { linkIndex, pickFeaturedService, songUsage, sungHistory, totalAttendance } from './derive'
import { nthWeekdayOfMonth, previousWeekday, sundaysInMonth } from './date'
import type { ArchiveData, PracticeLink, Service, Song } from './types'

function song(partial: Partial<Song>): Song {
  return {
    곡코드: '중47-03', 표시명: '주만이 내 반석 (중47-03)', 제목: '주만이 내 반석', 원제: '', 집코드: '중47',
    수록번호: 3, 페이지: '', 작사: '', 작곡: '', 편곡: '', 성부: 'SATB', 조성: '', 절기: '일반',
    난이도: 3, 상태: '후보', 참고음원URL: '', 악보스캔URL: '', 출처: 'manual', 검증: true, 비고: '',
    ...partial,
  }
}

function service(찬양일: string, 곡: string[]): Service {
  return { 찬양일, 예배구분: '주일', 곡, S인원: 8, A인원: 7, T인원: 4, B인원: 5, 세션: '', 기록영상URL: '', 메모: '' }
}

describe('sundaysInMonth', () => {
  it('그 달의 주일만 낸다', () => {
    expect(sundaysInMonth(2026, 10)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'])
  })

  it('1일이 일요일인 달도 포함한다', () => {
    expect(sundaysInMonth(2026, 11)[0]).toBe('2026-11-01')
  })
})

describe('previousWeekday', () => {
  it('당일은 제외하고 직전 해당 요일을 낸다', () => {
    expect(previousWeekday('2026-08-23', 0)).toBe('2026-08-16') // 직전 일요일
    expect(previousWeekday('2026-08-23', 3)).toBe('2026-08-19') // 직전 수요일
  })
})

describe('nthWeekdayOfMonth', () => {
  it('그 달의 N번째 요일을 낸다', () => {
    expect(nthWeekdayOfMonth(2026, 10, 0, 4)).toBe('2026-10-25')
    expect(nthWeekdayOfMonth(2026, 10, 3, 3)).toBe('2026-10-21')
    // 1일이 그 요일이면 첫째 주가 1일이다.
    expect(nthWeekdayOfMonth(2026, 11, 0, 1)).toBe('2026-11-01')
    expect(nthWeekdayOfMonth(2026, 11, 0, 4)).toBe('2026-11-22')
  })

  it('그 달에 N번째가 없으면 마지막 것을 준다', () => {
    // 2026-02는 주일이 1·8·15·22 넷뿐이다.
    expect(nthWeekdayOfMonth(2026, 2, 0, 5)).toBe('2026-02-22')
  })
})

describe('parseRehearsalPattern / suggestRehearsals', () => {
  it('찬양일 기준 패턴을 읽는다 (주차 없음)', () => {
    expect(parseRehearsalPattern('주일 13:30, 수요일 20:00')).toEqual([
      { 구분: '주일', weekday: 0, 시각: '13:30', 주차: undefined },
      { 구분: '수요일', weekday: 3, 시각: '20:00', 주차: undefined },
    ])
  })

  it('달 기준 패턴을 읽는다 (N주)', () => {
    expect(parseRehearsalPattern('2주 주일 13:30, 3주 수요일 20:00')).toEqual([
      { 구분: '주일', weekday: 0, 시각: '13:30', 주차: 2 },
      { 구분: '수요일', weekday: 3, 시각: '20:00', 주차: 3 },
    ])
  })

  it('알 수 없는 항목은 조용히 버린다', () => {
    expect(parseRehearsalPattern('화성인 25:99, 주일 13:30')).toHaveLength(1)
  })

  it('찬양일 직전 연습일을 날짜순으로 제안한다', () => {
    expect(suggestRehearsals('2026-08-23', parseRehearsalPattern('주일 13:30, 수요일 20:00'))).toEqual([
      { 연습일: '2026-08-16', 시각: '13:30', 구분: '주일', 장소: '' },
      { 연습일: '2026-08-19', 시각: '20:00', 구분: '수요일', 장소: '' },
    ])
  })

  it('N주 패턴은 그 달의 해당 주 요일을 쓴다', () => {
    // 2026-10: 주일 4·11·18·25, 수요일 7·14·21·28
    expect(suggestRehearsals('2026-10-25', parseRehearsalPattern(DEFAULT_CONFIG.연습기본패턴))).toEqual([
      { 연습일: '2026-10-11', 시각: '13:30', 구분: '주일', 장소: '' },
      { 연습일: '2026-10-18', 시각: '13:30', 구분: '주일', 장소: '' },
      { 연습일: '2026-10-21', 시각: '20:00', 구분: '수요일', 장소: '' },
    ])
  })

  it('찬양일보다 뒤에 오는 연습일은 버린다', () => {
    // 둘째 주일에 부르면 셋째 주 연습은 뒤에 온다.
    expect(suggestRehearsals('2026-10-11', parseRehearsalPattern(DEFAULT_CONFIG.연습기본패턴))).toEqual([])
  })
})

describe('initialPlan', () => {
  it('기본값은 넷째 주일 하나에 연습 세 번', () => {
    const plan = initialPlan(2026, 10, DEFAULT_CONFIG)
    expect(plan).toHaveLength(1)
    expect(plan[0].찬양일).toBe('2026-10-25')
    expect(plan[0].곡).toEqual([])
    expect(plan[0].rehearsals.map((r) => r.연습일)).toEqual(['2026-10-11', '2026-10-18', '2026-10-21'])
  })

  it('첫날이 주일인 달에서도 넷째 주일을 맞춘다', () => {
    // 2026-11-01이 주일이므로 넷째 주일은 22일이다.
    expect(initialPlan(2026, 11, DEFAULT_CONFIG)[0].찬양일).toBe('2026-11-22')
  })

  it('찬양주일이 0이면 그 달의 모든 주일을 만든다', () => {
    const plan = initialPlan(2026, 10, { ...DEFAULT_CONFIG, 찬양주일: 0 })
    expect(plan.map((p) => p.찬양일)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'])
  })
})

describe('중복 선곡 경고 (§6.7)', () => {
  const history = sungHistory([service('2025-12-24', ['가곡 (중47-01)']), service('2024-03-10', ['나곡 (중47-02)'])])

  it('중복경고개월 이내면 recent가 true', () => {
    const usage = songUsage('가곡 (중47-01)', history, '2026-09-04', 12)
    expect(usage.lastSung).toBe('2025-12-24')
    expect(usage.recent).toBe(true)
    expect(usage.monthsAgo).toBe(9)
  })

  it('경고 기간을 넘긴 곡은 recent가 false', () => {
    expect(songUsage('나곡 (중47-02)', history, '2026-09-04', 12).recent).toBe(false)
  })

  it('기준일 이후에 예정된 찬양은 이력으로 세지 않는다', () => {
    const future = sungHistory([service('2026-12-25', ['가곡 (중47-01)'])])
    expect(songUsage('가곡 (중47-01)', future, '2026-09-04', 12).lastSung).toBeNull()
  })

  it('부른 적 없는 곡은 lastSung이 null', () => {
    expect(songUsage('처음곡 (중47-09)', history, '2026-09-04', 12).lastSung).toBeNull()
  })
})

describe('buildCandidates', () => {
  const links: PracticeLink[] = [
    { 표시명: '가곡 (중47-01)', 파트: '합창', URL: 'https://youtu.be/vk1nDmhdy2w', 시작초: null, 올린이: '', 출처: 'manual', 검증: true },
    { 표시명: '가곡 (중47-01)', 파트: '알토', URL: 'https://youtu.be/xKhZ4ghUTaA', 시작초: null, 올린이: '', 출처: 'namuwiki', 검증: false },
    { 표시명: '나곡 (중47-02)', 파트: '반주', URL: 'https://youtu.be/9yT6gnaWd6s', 시작초: null, 올린이: '', 출처: 'manual', 검증: true },
  ]
  const data: ArchiveData = {
    updatedAt: '', books: [], config: DEFAULT_CONFIG, rehearsals: [], practiceLinks: links,
    songs: [
      song({ 표시명: '가곡 (중47-01)', 제목: '가곡', 곡코드: '중47-01' }),
      song({ 표시명: '나곡 (중47-02)', 제목: '나곡', 곡코드: '중47-02', 검증: false, 절기: '성탄', 난이도: 5 }),
    ],
    services: [service('2025-12-24', ['가곡 (중47-01)'])],
  }
  const candidates = buildCandidates(data, '2026-09-04', linkIndex(links))

  it('검증된 링크 수와 파트 자료 보유 여부를 낸다', () => {
    const 가곡 = candidates.find((c) => c.song.제목 === '가곡')!
    expect(가곡.linkCount).toBe(2)
    expect(가곡.verifiedLinkCount).toBe(1)
    expect(가곡.hasParts).toBe(true)
    expect(가곡.recent).toBe(true)
  })

  it('반주만 있는 곡은 파트 연습 자료가 있다고 보지 않는다', () => {
    expect(candidates.find((c) => c.song.제목 === '나곡')!.hasParts).toBe(false)
  })

  it('필터가 검색어·절기·검증·중복숨김에 걸린다', () => {
    expect(filterCandidates(candidates, { ...EMPTY_FILTER, query: '나곡' })).toHaveLength(1)
    expect(filterCandidates(candidates, { ...EMPTY_FILTER, 절기: '성탄' })).toHaveLength(1)
    expect(filterCandidates(candidates, { ...EMPTY_FILTER, 검증만: true })).toHaveLength(1)
    expect(filterCandidates(candidates, { ...EMPTY_FILTER, 중복숨김: true }).map((c) => c.song.제목)).toEqual(['나곡'])
  })

  it('검색어의 공백은 무시한다', () => {
    expect(filterCandidates(candidates, { ...EMPTY_FILTER, query: '가 곡' })).toHaveLength(1)
  })
})

describe('planDifficultyLoad', () => {
  it('선곡된 곡들의 평균 난이도를 낸다', () => {
    const songs = new Map([
      ['a', song({ 표시명: 'a', 난이도: 2 })],
      ['b', song({ 표시명: 'b', 난이도: 4 })],
    ])
    const plan = [
      { id: '1', 찬양일: '2026-10-04', 예배구분: '주일', 곡: ['a'], rehearsals: [] },
      { id: '2', 찬양일: '2026-10-11', 예배구분: '주일', 곡: ['b'], rehearsals: [] },
    ]
    expect(planDifficultyLoad(plan, songs)).toBe(3)
    expect(planDifficultyLoad([], songs)).toBeNull()
  })
})

describe('붙여넣기 블록 (§12.1)', () => {
  it('services는 시트 열 순서대로 탭 구분 행을 만든다', () => {
    expect(
      buildServicePaste([
        { 찬양일: '2026-10-11', 예배구분: '주일', 곡: ['나곡 (중47-02)'] },
        { 찬양일: '2026-10-04', 예배구분: '주일', 곡: ['가곡 (중47-01)', '다곡 (중47-03)'] },
      ]),
    ).toBe(
      [
        '2026-10-04\t주일\t가곡 (중47-01)\t다곡 (중47-03)\t\t\t\t\t\t\t\t',
        '2026-10-11\t주일\t나곡 (중47-02)\t\t\t\t\t\t\t\t\t',
      ].join('\n'),
    )
  })

  it('셀 안의 탭·개행은 공백으로 바꿔 열이 밀리지 않게 한다', () => {
    expect(buildServicePaste([{ 찬양일: '2026-10-04', 예배구분: '주일\t1부', 곡: [] }]).split('\t')[1]).toBe('주일 1부')
  })

  it('rehearsals도 같은 방식으로 만든다', () => {
    expect(
      buildRehearsalPaste([{ 찬양일: '2026-10-04', 연습일: '2026-09-27', 시각: '13:30', 구분: '주일' }]),
    ).toBe('2026-10-04\t2026-09-27\t13:30\t주일\t\t')
  })

  it('이미 시트에 있는 찬양일을 짚어낸다', () => {
    expect(
      findDuplicateServiceDates(
        [{ 찬양일: '2026-10-04', 예배구분: '주일', 곡: [] }, { 찬양일: '2026-10-11', 예배구분: '주일', 곡: [] }],
        [service('2026-10-04', [])],
      ),
    ).toEqual(['2026-10-04'])
  })
})

describe('derive', () => {
  it('총인원은 S+A+T+B, 전부 비면 null', () => {
    expect(totalAttendance(service('2026-08-23', []))).toBe(24)
    expect(totalAttendance({ ...service('2026-08-23', []), S인원: null, A인원: null, T인원: null, B인원: null })).toBeNull()
  })

  it('다가오는 찬양일을 고르고, 없으면 가장 최근 것을 고른다', () => {
    const services = [service('2026-08-23', []), service('2026-10-04', [])]
    expect(pickFeaturedService(services, '2026-09-04')?.찬양일).toBe('2026-10-04')
    expect(pickFeaturedService(services, '2026-12-01')?.찬양일).toBe('2026-10-04')
    expect(pickFeaturedService([], '2026-09-04')).toBeNull()
  })

  it('링크는 공지 파트 순서로 정렬된다', () => {
    const sorted = linkIndex([
      { 표시명: 'a', 파트: '베이스', URL: 'u', 시작초: null, 올린이: '', 출처: 'manual', 검증: true },
      { 표시명: 'a', 파트: '합창', URL: 'u', 시작초: null, 올린이: '', 출처: 'manual', 검증: true },
    ]).get('a')!
    expect(sorted.map((l) => l.파트)).toEqual(['합창', '베이스'])
  })
})
