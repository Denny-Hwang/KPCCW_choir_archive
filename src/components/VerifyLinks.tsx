import { useState } from 'react'
import { useArchive } from '../lib/useArchive'
import { getWriteKey, setWriteKey } from '../lib/api'
import { verifyLink } from '../lib/write'
import type { PracticeLink } from '../lib/types'
import { PartLinkList } from './PartLinks'
import { WriteKeyField } from './WriteKeyField'

function linkId(link: PracticeLink): string {
  return `${link.파트}|${link.URL}`
}

/**
 * 곡 상세의 파트 영상 목록 + 영상마다 "확인" (§9.3).
 *
 * 자동 수집한 링크는 사람이 재생해 보고 체크해야 공지에 나간다. 그 체크를 시트까지 가지 않고
 * 영상을 보는 자리에서 하게 한다 — 공지할 곡만 그때그때 확인하면 되므로, 서가 전체를 한 번에
 * 검수할 필요가 없다. 켠 것을 끄는 것도 같은 자리에서 한다(잘못 누른 것을 되돌릴 수 있어야 한다).
 *
 * 편집 키가 없으면 목록 위에 입력칸을 펼치고, 누른 버튼 옆에 그 사실을 적는다.
 */
export function VerifyLinks({ links }: { links: PracticeLink[] }) {
  const { reload } = useArchive()
  const [key, setKey] = useState(() => getWriteKey())
  const [editingKey, setEditingKey] = useState(false)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [keyError, setKeyError] = useState<string | null>(null)

  async function toggle(link: PracticeLink, 검증: boolean) {
    const id = linkId(link)
    const trimmed = key.trim()
    if (!trimmed) {
      setEditingKey(true)
      setKeyError('편집 키를 넣고 다시 누르세요.')
      return
    }
    setKeyError(null)
    setWriteKey(trimmed)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    setPending((prev) => new Set(prev).add(id))
    try {
      const r = await verifyLink({ 표시명: link.표시명, 파트: link.파트, URL: link.URL, 검증 }, trimmed)
      if (r.ok) {
        // 키가 맞았으니 입력칸은 접는다. 다음부터는 버튼만 누르면 된다.
        setEditingKey(false)
        reload()
      } else {
        setErrors((prev) => ({ ...prev, [id]: r.error }))
      }
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const unverified = links.filter((l) => !l.검증).length

  return (
    <div className="space-y-3">
      {links.length > 0 && (
        <div className="rounded-xl bg-stone-50 p-3 text-xs text-stone-500">
          {unverified > 0
            ? `확인 대기 ${unverified}개. 영상을 재생해 보고 맞으면 [확인]을 누르세요. 확인한 영상만 공지에 들어갑니다.`
            : '모든 영상이 확인되어 공지에 들어갑니다.'}
          {(editingKey || !key) && (
            <div className="mt-2">
              <WriteKeyField
                value={key}
                onChange={setKey}
                editing
                onEdit={() => setEditingKey(true)}
                error={keyError}
                compact
              />
            </div>
          )}
          {!editingKey && key && (
            <button type="button" className="ml-1 text-stone-400 underline" onClick={() => setEditingKey(true)}>
              편집 키 바꾸기
            </button>
          )}
        </div>
      )}

      <PartLinkList
        links={links}
        action={(link) => {
          const id = linkId(link)
          const busy = pending.has(id)
          const error = errors[id]
          return (
            <>
              {link.검증 ? (
                <button
                  type="button"
                  onClick={() => toggle(link, false)}
                  disabled={busy}
                  className="text-[11px] text-stone-400 underline disabled:opacity-50"
                >
                  {busy ? '저장 중…' : '확인 취소'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(link, true)}
                  disabled={busy}
                  className="btn-primary px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  {busy ? '저장 중…' : '확인'}
                </button>
              )}
              {error && <span className="basis-full text-[11px] text-rose-700">{error}</span>}
            </>
          )
        }}
      />
    </div>
  )
}
