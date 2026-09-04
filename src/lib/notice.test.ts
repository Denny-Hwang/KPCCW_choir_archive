import { describe, expect, it } from 'vitest'
import { buildMonthlySummary, buildNotice, formatRehearsalLine, formatTitle, noticeWarnings } from './notice'
import { DEFAULT_CONFIG, parseConfig } from './schema'
import type { PracticeLink, Rehearsal } from './types'

function link(파트: string, URL: string, 검증 = true): PracticeLink {
  return { 표시명: '테스트곡 (중47-03)', 파트, URL, 시작초: null, 올린이: '', 출처: 'manual', 검증 }
}

function rehearsal(연습일: string, 시각: string, 구분: string): Rehearsal {
  return { 찬양일: '2026-08-23', 연습일, 시각, 구분, 장소: '', 메모: '' }
}

const 기존메모연습 = [
  rehearsal('2026-08-09', '13:30', '주일'),
  rehearsal('2026-08-16', '13:30', '주일'),
  rehearsal('2026-08-19', '20:00', '수요일'),
]

const 기존메모링크 = [
  link('합창', 'https://youtu.be/vk1nDmhdy2w'),
  link('소프라노', 'https://youtu.be/9yT6gnaWd6s'),
  link('알토', 'https://youtu.be/xKhZ4ghUTaA'),
  link('테너', 'https://youtu.be/9-Be2IEo7so'),
  link('베이스', 'https://youtu.be/pv9dIez4KxI'),
]

describe('buildNotice — 1곡 (기본 포맷)', () => {
  it('실제 카톡 공지(2026-08-23 "너는 교회가 되어라")와 글자 단위로 일치한다', () => {
    // 실제로 대원들에게 나갔던 원문. 깨진 ?is= 파라미터까지 그대로 넣어
    // 정규화 결과가 깨끗한 youtu.be 링크로 나오는지 함께 확인한다.
    const 원문링크 = [
      link('합창', 'https://youtu.be/vk1nDmhdy2w?is=dRFPJTN3LLh_16l-'),
      link('소프라노', 'https://youtu.be/9yT6gnaWd6s?is=ocg9iJjz6ScKi9Tg'),
      link('알토', 'https://youtu.be/xKhZ4ghUTaA?is=m9tRHekUZE6YndHx'),
      link('테너', 'https://youtu.be/9-Be2IEo7so?is=mmt9x-yO66pN4hES'),
      link('베이스', 'https://youtu.be/pv9dIez4KxI?is=xzGR2slr0B3EUXe4'),
    ]

    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: 기존메모연습,
      songs: [{ 표시명: '너는 교회가 되어라', 제목: '너는 교회가 되어라', links: 원문링크 }],
      config: DEFAULT_CONFIG,
    })

    expect(output).toBe(
      [
        '8월 23일 주일 찬양',
        '',
        '<성가연습 일정>',
        '9일 주일 1시 30분',
        '16일 주일 1시 30분',
        '19일 수요일 8시',
        '',
        '(합창)',
        'https://youtu.be/vk1nDmhdy2w',
        '',
        '(소프라노)',
        'https://youtu.be/9yT6gnaWd6s',
        '',
        '(알토)',
        'https://youtu.be/xKhZ4ghUTaA',
        '',
        '(테너)',
        'https://youtu.be/9-Be2IEo7so',
        '',
        '(베이스)',
        'https://youtu.be/pv9dIez4KxI',
      ].join('\n'),
    )
  })

  it('공지_빈줄구분을 끄면 빈 줄 없이 붙는다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: 기존메모연습,
      songs: [{ 표시명: 'x', 제목: 'x', links: 기존메모링크 }],
      config: { ...DEFAULT_CONFIG, 공지_빈줄구분: false },
    })
    expect(output).not.toContain('\n\n')
    expect(output).toContain('19일 수요일 8시\n(합창)')
  })

  it('1곡일 때는 곡명 헤더를 넣지 않는다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [{ 표시명: '테스트곡 (중47-03)', 제목: '테스트곡', links: 기존메모링크 }],
      config: DEFAULT_CONFIG,
    })
    expect(output).not.toContain('1. ')
    expect(output).not.toContain('테스트곡')
  })

  it('공지_곡목표시가 TRUE면 제목 아래 곡명 한 줄을 넣는다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [{ 표시명: '테스트곡 (중47-03)', 제목: '테스트곡', links: [] }],
      config: { ...DEFAULT_CONFIG, 공지_곡목표시: true },
    })
    expect(output.split('\n')[1]).toBe('테스트곡')
  })

  it('링크 없는 파트는 블록 자체를 생략한다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [{ 표시명: 'x', 제목: 'x', links: [link('합창', 'https://youtu.be/vk1nDmhdy2w')] }],
      config: DEFAULT_CONFIG,
    })
    expect(output).toContain('(합창)')
    expect(output).not.toContain('(소프라노)')
  })

  it('미검증 링크는 공지에서 제외한다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [
        {
          표시명: 'x',
          제목: 'x',
          links: [link('합창', 'https://youtu.be/vk1nDmhdy2w'), link('알토', 'https://youtu.be/xKhZ4ghUTaA', false)],
        },
      ],
      config: DEFAULT_CONFIG,
    })
    expect(output).toContain('vk1nDmhdy2w')
    expect(output).not.toContain('xKhZ4ghUTaA')
  })

  it('config의 파트 순서를 따른다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [{ 표시명: 'x', 제목: 'x', links: 기존메모링크 }],
      config: { ...DEFAULT_CONFIG, 공지_파트순서: ['베이스', '합창'] },
    })
    expect(output.indexOf('(베이스)')).toBeLessThan(output.indexOf('(합창)'))
  })
})

describe('buildNotice — 2곡 이상 (§7.1 분기)', () => {
  const 성탄링크1 = [link('합창', 'https://youtu.be/aaaaaaaaaaa'), link('소프라노', 'https://youtu.be/bbbbbbbbbbb')]
  const 성탄링크2 = [link('합창', 'https://youtu.be/ccccccccccc')]

  it('곡명 헤더를 번호와 함께 강제 삽입한다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-12-25', 예배구분: '성탄' },
      rehearsals: [rehearsal('2026-12-21', '13:30', '주일'), rehearsal('2026-12-24', '20:00', '수요일')],
      songs: [
        { 표시명: '고요한 밤 (중47-01)', 제목: '고요한 밤', links: 성탄링크1 },
        { 표시명: '기쁘다 (중47-02)', 제목: '기쁘다', links: 성탄링크2 },
      ],
      config: { ...DEFAULT_CONFIG, 공지_제목형식: '{M}월 {D}일 {구분} 찬양' },
    })

    expect(output).toBe(
      [
        '12월 25일 성탄 찬양',
        '',
        '<성가연습 일정>',
        '21일 주일 1시 30분',
        '24일 수요일 8시',
        '',
        '1. 고요한 밤',
        '(합창)',
        'https://youtu.be/aaaaaaaaaaa',
        '',
        '(소프라노)',
        'https://youtu.be/bbbbbbbbbbb',
        '',
        '2. 기쁘다',
        '(합창)',
        'https://youtu.be/ccccccccccc',
      ].join('\n'),
    )
  })

  it('공지_곡목표시가 FALSE여도 곡명 헤더가 나온다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-12-25', 예배구분: '성탄' },
      rehearsals: [],
      songs: [
        { 표시명: 'a', 제목: '고요한 밤', links: 성탄링크1 },
        { 표시명: 'b', 제목: '기쁘다', links: 성탄링크2 },
      ],
      config: { ...DEFAULT_CONFIG, 공지_곡목표시: false },
    })
    expect(output).toContain('1. 고요한 밤')
    expect(output).toContain('2. 기쁘다')
  })

  it('링크가 하나도 없는 곡은 번호 블록을 만들지 않는다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-12-25', 예배구분: '성탄' },
      rehearsals: [],
      songs: [
        { 표시명: 'a', 제목: '고요한 밤', links: 성탄링크1 },
        { 표시명: 'b', 제목: '기쁘다', links: [] },
      ],
      config: DEFAULT_CONFIG,
    })
    expect(output).toContain('1. 고요한 밤')
    expect(output).not.toContain('2. 기쁘다')
  })
})

describe('연습 일정이 없을 때', () => {
  it('연습 헤더를 통째로 생략한다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: [],
      songs: [{ 표시명: 'x', 제목: 'x', links: [link('합창', 'https://youtu.be/vk1nDmhdy2w')] }],
      config: DEFAULT_CONFIG,
    })
    expect(output).not.toContain('성가연습 일정')
    expect(output).toBe(['8월 23일 주일 찬양', '', '(합창)', 'https://youtu.be/vk1nDmhdy2w'].join('\n'))
  })
})

describe('공지_빈줄구분', () => {
  it('파트 블록 사이에도 빈 줄이 들어간다', () => {
    const output = buildNotice({
      service: { 찬양일: '2026-08-23', 예배구분: '주일' },
      rehearsals: 기존메모연습,
      songs: [{ 표시명: 'x', 제목: 'x', links: 기존메모링크 }],
      config: DEFAULT_CONFIG,
    })
    expect(output).toContain('https://youtu.be/vk1nDmhdy2w\n\n(소프라노)')
    expect(output).toContain('https://youtu.be/xKhZ4ghUTaA\n\n(테너)')
  })

  it('config에 키가 없어도 기본값(빈 줄 있음)이 살아난다', () => {
    expect(parseConfig([{ 키: '앱_제목', 값: '테스트' }]).공지_빈줄구분).toBe(true)
  })
})

describe('formatTitle', () => {
  it('{M}/{D}/{구분}/{YYYY}를 치환한다', () => {
    const service = { 찬양일: '2026-08-23', 예배구분: '주일 1부' }
    expect(formatTitle('{M}월 {D}일 주일 찬양', service)).toBe('8월 23일 주일 찬양')
    expect(formatTitle('{YYYY}년 {M}월 {D}일 {구분}', service)).toBe('2026년 8월 23일 주일 1부')
  })

  it('날짜가 깨져 있어도 예외를 던지지 않는다', () => {
    expect(formatTitle('{M}월 {D}일 주일 찬양', { 찬양일: '', 예배구분: '' })).toBe('월 일 주일 찬양')
  })
})

describe('formatRehearsalLine', () => {
  it('일(日)만 쓰고 요일은 구분 열 값을 쓴다', () => {
    expect(formatRehearsalLine(rehearsal('2026-08-09', '13:30', '주일'))).toBe('9일 주일 1시 30분')
    expect(formatRehearsalLine(rehearsal('2026-08-19', '20:00', '수요일'))).toBe('19일 수요일 8시')
  })

  it('정각은 분을 생략한다', () => {
    expect(formatRehearsalLine(rehearsal('2026-08-19', '19:00', '수요일'))).toBe('19일 수요일 7시')
  })
})

describe('noticeWarnings', () => {
  it('미검증·인식실패·영상없음을 각각 알린다', () => {
    const warnings = noticeWarnings([
      { 표시명: 'a', 제목: '가곡', links: [link('알토', 'https://youtu.be/xKhZ4ghUTaA', false)] },
      { 표시명: 'b', 제목: '나곡', links: [link('합창', 'https://example.com/broken')] },
    ])
    expect(warnings.some((w) => w.includes('미검증 링크 1개'))).toBe(true)
    expect(warnings.some((w) => w.includes('인식하지 못한'))).toBe(true)
    expect(warnings.some((w) => w.includes('파트 영상이 없음'))).toBe(true)
  })
})

describe('buildMonthlySummary', () => {
  it('찬양일 순으로 한 줄씩, 곡이 없으면 (미정)', () => {
    const output = buildMonthlySummary('2026-10', [
      { service: { 찬양일: '2026-10-11', 예배구분: '주일' }, songs: [{ 제목: '나곡' }] },
      { service: { 찬양일: '2026-10-04', 예배구분: '주일' }, songs: [{ 제목: '가곡' }, { 제목: '다곡' }] },
      { service: { 찬양일: '2026-10-18', 예배구분: '주일' }, songs: [] },
    ])
    expect(output).toBe(
      [
        '2026년 10월 찬양 일정',
        '',
        '10월 4일 주일 — 가곡 / 다곡',
        '10월 11일 주일 — 나곡',
        '10월 18일 주일 — (미정)',
      ].join('\n'),
    )
  })
})
