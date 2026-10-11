import { readdirSync } from 'node:fs'

/**
 * apps-script/의 .gs 파일 전부 (테스트 전용).
 *
 * Apps Script는 프로젝트의 .gs 파일을 하나의 전역 스코프에 합친다. 테스트도 목록을 손으로
 * 적지 않고 폴더를 읽는다 — 파일을 나누거나 새로 만들 때 테스트가 그 파일을 빠뜨리지 않게.
 */
export const GS_DIR = new URL('../../apps-script/', import.meta.url)

export const GS_FILES = readdirSync(GS_DIR)
  .filter((f) => f.endsWith('.gs'))
  .sort()
