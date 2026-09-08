/**
 * 시트 쓰기 (§12.2) — "다음 찬양으로" 한 동작만.
 *
 * 붙여넣기 블록(§12.1)이 먼저 있었고, 이 경로가 생긴 뒤에도 남는다. 쓰기가 네트워크·키
 * 문제로 실패하면 화면이 그 블록으로 폴백해서 선곡 작업이 날아가지 않는다.
 *
 * Apps Script는 OPTIONS(preflight)를 받지 못한다. 그래서 본문은 JSON이지만
 * text/plain으로 보내고, 302 리다이렉트를 따라간 응답을 그대로 읽는다.
 */
import { getEndpoint } from './api'
import { parseDateKey } from './date'
import type { Rehearsal } from './types'

export interface PlanPayload {
  찬양일: string
  예배구분: string
  곡: string[]
  rehearsals: Array<Pick<Rehearsal, '연습일' | '시각' | '구분' | '장소'>>
}

export type WriteResult =
  | {
      ok: true
      /** 같은 (찬양일, 예배구분) 행이 이미 있어 빈 곡 칸만 채웠으면 'updated'. */
      service: 'created' | 'updated'
      songsAdded: string[]
      songsSkipped: string[]
      rehearsalsAdded: number
      rehearsalsSkipped: number
    }
  | { ok: false; error: string }

export function buildWriteRequest(payload: PlanPayload, key: string): string {
  return JSON.stringify({ key, action: 'applyPlan', payload })
}

/** 보내기 전에 걸러 낼 수 있는 것. 서버가 다시 검사하지만, 왕복 없이 바로 말해 주는 게 낫다. */
export function validatePlan(payload: PlanPayload): string[] {
  const problems: string[] = []
  if (!parseDateKey(payload.찬양일)) problems.push('찬양일을 고르세요.')
  const titles = payload.곡.map((t) => t.trim()).filter(Boolean)
  if (!titles.length) problems.push('곡이 없습니다.')
  if (titles.length > 3) problems.push('곡은 한 찬양일에 3개까지입니다.')
  for (const r of payload.rehearsals) {
    if (!parseDateKey(r.연습일)) {
      problems.push('연습일 중 날짜가 아닌 것이 있습니다.')
      break
    }
  }
  // 부르고 나서 연습할 일은 없다. 실수로 남긴 기본 일정을 잡아낸다.
  if (payload.rehearsals.some((r) => parseDateKey(r.연습일) && r.연습일 >= payload.찬양일)) {
    problems.push('찬양일 이후의 연습일이 있습니다.')
  }
  return problems
}

/** 응답 본문을 WriteResult로. 무엇이 와도 예외 대신 { ok: false }로 떨어진다. */
export function parseWriteResponse(text: string): WriteResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: 'JSON이 아닌 응답을 받았습니다. Apps Script를 새 버전으로 다시 배포했는지, 액세스 권한이 "모든 사용자"인지 확인하세요.',
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '알 수 없는 응답입니다.' }
  const r = parsed as Record<string, unknown>
  if (r.ok !== true) {
    return { ok: false, error: typeof r.error === 'string' && r.error ? r.error : '시트가 요청을 거부했습니다.' }
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    ok: true,
    service: r.service === 'updated' ? 'updated' : 'created',
    songsAdded: list(r.songsAdded),
    songsSkipped: list(r.songsSkipped),
    rehearsalsAdded: count(r.rehearsalsAdded),
    rehearsalsSkipped: count(r.rehearsalsSkipped),
  }
}

export async function applyPlan(payload: PlanPayload, key: string): Promise<WriteResult> {
  const res = await fetch(getEndpoint(), {
    method: 'POST',
    redirect: 'follow',
    // application/json이면 preflight가 나가고 Apps Script는 그것을 받지 못한다.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: buildWriteRequest(payload, key),
  })
  if (!res.ok) return { ok: false, error: `서버 응답 오류 (${res.status})` }
  return parseWriteResponse(await res.text())
}
