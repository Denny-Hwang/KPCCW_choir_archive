import { describe, expect, it } from 'vitest'
import { extractStartSeconds, extractVideoId, normalizeLink } from './youtube'

describe('extractVideoId', () => {
  it('허용된 모든 입력 형태에서 ID를 뽑는다 (§8)', () => {
    const id = 'vk1nDmhdy2w'
    for (const input of [
      'https://youtu.be/vk1nDmhdy2w',
      'http://youtu.be/vk1nDmhdy2w',
      'youtu.be/vk1nDmhdy2w',
      'https://www.youtube.com/watch?v=vk1nDmhdy2w',
      'https://m.youtube.com/watch?v=vk1nDmhdy2w',
      'https://music.youtube.com/watch?v=vk1nDmhdy2w',
      'https://www.youtube.com/shorts/vk1nDmhdy2w',
      'https://www.youtube.com/embed/vk1nDmhdy2w',
      'https://www.youtube.com/live/vk1nDmhdy2w',
      'vk1nDmhdy2w',
      '  https://youtu.be/vk1nDmhdy2w  ',
    ]) {
      expect(extractVideoId(input), input).toBe(id)
    }
  })

  it('기존 메모의 깨진 ?is= 파라미터를 무시한다', () => {
    expect(extractVideoId('https://youtu.be/vk1nDmhdy2w?is=abc123XYZ')).toBe('vk1nDmhdy2w')
    expect(extractVideoId('https://youtu.be/vk1nDmhdy2w?si=abc123XYZ&t=30')).toBe('vk1nDmhdy2w')
  })

  it('music.youtube.com 링크도 읽는다 (실제 연합예배 공지에 쓰인 형태)', () => {
    expect(extractVideoId('https://music.youtube.com/watch?v=RzUz3ny4Uzw&si=Np3jlZ6-BnG9cMw5')).toBe('RzUz3ny4Uzw')
  })

  it('플레이리스트 파라미터가 붙어도 영상 ID를 고른다', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=vk1nDmhdy2w&list=PLN_65EI7yT6&index=3')).toBe('vk1nDmhdy2w')
  })

  it('유튜브가 아니거나 ID가 아니면 null', () => {
    for (const input of ['', '   ', 'https://example.com/video', 'https://youtu.be/tooshort', 'not a url', 'https://drive.google.com/file/d/abc/view']) {
      expect(extractVideoId(input), input).toBeNull()
    }
  })
})

describe('extractStartSeconds', () => {
  it('t= 초와 1m30s 형식을 모두 읽는다', () => {
    expect(extractStartSeconds('https://youtu.be/vk1nDmhdy2w?t=90')).toBe(90)
    expect(extractStartSeconds('https://youtu.be/vk1nDmhdy2w?t=1m30s')).toBe(90)
    expect(extractStartSeconds('https://youtu.be/vk1nDmhdy2w?t=1h2m3s')).toBe(3723)
    expect(extractStartSeconds('https://youtu.be/vk1nDmhdy2w')).toBeNull()
  })
})

describe('normalizeLink', () => {
  it('공유/임베드/썸네일 세 형태를 만든다', () => {
    const n = normalizeLink('https://www.youtube.com/watch?v=vk1nDmhdy2w', null)
    expect(n.shareUrl).toBe('https://youtu.be/vk1nDmhdy2w')
    expect(n.embedUrl).toBe('https://www.youtube.com/embed/vk1nDmhdy2w')
    expect(n.thumbnailUrl).toBe('https://img.youtube.com/vi/vk1nDmhdy2w/hqdefault.jpg')
    expect(n.unrecognized).toBe(false)
  })

  it('시트의 시작초 열이 URL의 t= 보다 우선한다', () => {
    const n = normalizeLink('https://youtu.be/vk1nDmhdy2w?t=10', 45)
    expect(n.shareUrl).toBe('https://youtu.be/vk1nDmhdy2w?t=45')
    expect(n.embedUrl).toBe('https://www.youtube.com/embed/vk1nDmhdy2w?start=45')
  })

  it('시작초가 없으면 URL의 t= 를 쓴다', () => {
    expect(normalizeLink('https://youtu.be/vk1nDmhdy2w?t=10', null).shareUrl).toBe('https://youtu.be/vk1nDmhdy2w?t=10')
  })

  it('ID 추출 실패 시 원본을 그대로 두고 unrecognized로 표시한다', () => {
    const n = normalizeLink('https://drive.google.com/file/d/abc/view', null)
    expect(n.shareUrl).toBe('https://drive.google.com/file/d/abc/view')
    expect(n.embedUrl).toBeNull()
    expect(n.unrecognized).toBe(true)
  })
})
