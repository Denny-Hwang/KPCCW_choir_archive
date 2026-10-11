import { useState } from 'react'
import { getEditorName, setEditorName } from '../lib/api'
import { useArchive } from '../lib/useArchive'

/**
 * 편집 키 입력 (§12.2, §13.3). 시트에 쓰는 화면들이 같은 칸을 쓴다.
 *
 * 저장된 키가 있으면 칸을 접고 "바꾸기"만 남긴다 — 매번 키를 보여줄 이유가 없다.
 * 키의 저장은 호출부가 한다(쓰기 직전에 setWriteKey). 여기서는 입력만 받는다.
 *
 * 이름도 함께 받는다. 키는 여럿이 함께 쓰는 하나뿐이라, 이름이 없으면 시트의 _변경기록이
 * "누가"에 답하지 못한다. 이름은 입력하는 즉시 이 브라우저에 남는다.
 */
export function WriteKeyField({
  value,
  onChange,
  editing,
  onEdit,
  disabled,
  error,
  compact,
}: {
  value: string
  onChange: (next: string) => void
  editing: boolean
  onEdit: () => void
  disabled?: boolean
  error?: string | null
  /** 목록 안에 끼워 넣을 때. 제목 줄 없이 입력칸만. */
  compact?: boolean
}) {
  const [editor, setEditor] = useState(() => getEditorName())

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-baseline justify-between gap-2">
          <p className="label">편집 키</p>
          {!editing && (
            <button type="button" className="text-xs text-stone-400 underline" onClick={onEdit}>
              바꾸기
            </button>
          )}
        </div>
      )}
      {editing ? (
        <>
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="config 시트의 앱편집키 값 (대소문자 무관)"
            className="field"
            autoComplete="off"
            disabled={disabled}
            aria-label="편집 키"
          />
          <input
            type="text"
            value={editor}
            onChange={(e) => {
              setEditor(e.target.value)
              setEditorName(e.target.value)
            }}
            placeholder="내 이름 (변경기록에 남습니다)"
            className="field"
            autoComplete="name"
            disabled={disabled}
            aria-label="편집자 이름"
          />
          <p className="text-xs text-stone-400">이 브라우저에만 저장됩니다. 총무·지휘자만 알고 있으면 됩니다.</p>
        </>
      ) : (
        !compact && (
          <p className="text-xs text-stone-500">
            저장된 키를 씁니다{editor ? ` · ${editor}` : ''}.
          </p>
        )
      )}
      <DefaultKeyWarning />
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  )
}

/**
 * 편집 키가 공개된 기본값 그대로면 알린다. 기본값은 README에 적혀 있어
 * 앱 주소를 아는 누구나 시트에 쓸 수 있는 상태다.
 */
export function DefaultKeyWarning() {
  const { data } = useArchive()
  if (!data.writeKeyIsDefault) return null
  return (
    <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
      ⚠ 편집 키가 기본값(selah) 그대로입니다. 누구나 시트에 쓸 수 있으니 config 시트의 <b>앱편집키</b>를 바꾸세요.
    </p>
  )
}
