/**
 * 시트 붙여넣기 블록 (§12.1).
 *
 * 쓰기 엔드포인트(§12.2)보다 먼저 존재하고, 그것이 생긴 뒤에도 남는다.
 * 쓰기가 네트워크·권한 문제로 실패해도 선곡 작업이 날아가지 않게 하는 폴백이기 때문이다.
 * 탭 구분 텍스트를 시트 마지막 행에 붙여넣으면 그대로 한 행이 된다.
 */
import type { Rehearsal, Service } from './types'

/** 시트 `services`의 열 순서 (§4.3). 시트에서 열을 옮기면 여기도 맞춰야 한다. */
export const SERVICE_COLUMNS = [
  '찬양일',
  '예배구분',
  '곡1',
  '곡2',
  '곡3',
  'S인원',
  'A인원',
  'T인원',
  'B인원',
  '세션',
  '기록영상URL',
  '메모',
] as const

/** 시트 `rehearsals`의 열 순서 (§4.4). */
export const REHEARSAL_COLUMNS = ['찬양일', '연습일', '시각', '구분', '장소', '메모'] as const

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  // 탭·개행이 셀 안에 들어가면 붙여넣기 시 열이 밀린다.
  return String(value).replace(/[\t\r\n]+/g, ' ').trim()
}

function row(values: unknown[]): string {
  return values.map(cell).join('\t')
}

export interface PlannedService {
  찬양일: string
  예배구분: string
  곡: string[]
}

export function buildServicePaste(services: PlannedService[]): string {
  return services
    .filter((s) => s.찬양일)
    .sort((a, b) => a.찬양일.localeCompare(b.찬양일))
    .map((s) =>
      row([s.찬양일, s.예배구분, s.곡[0] ?? '', s.곡[1] ?? '', s.곡[2] ?? '', '', '', '', '', '', '', '']),
    )
    .join('\n')
}

export function buildRehearsalPaste(rehearsals: Array<Partial<Rehearsal> & Pick<Rehearsal, '찬양일' | '연습일'>>): string {
  return rehearsals
    .filter((r) => r.찬양일 && r.연습일)
    .sort((a, b) => a.찬양일.localeCompare(b.찬양일) || a.연습일.localeCompare(b.연습일))
    .map((r) => row([r.찬양일, r.연습일, r.시각 ?? '', r.구분 ?? '', r.장소 ?? '', r.메모 ?? '']))
    .join('\n')
}

/** 붙여넣기 전에 총무가 확인할 헤더 줄. 복사 대상에는 넣지 않는다. */
export function pasteHeader(columns: readonly string[]): string {
  return columns.join('\t')
}

/** 이미 시트에 있는 찬양일과 겹치는지. 겹치면 붙여넣기가 중복 행을 만든다. */
export function findDuplicateServiceDates(planned: PlannedService[], existing: Service[]): string[] {
  const known = new Set(existing.map((s) => s.찬양일))
  return planned.filter((p) => known.has(p.찬양일)).map((p) => p.찬양일)
}
