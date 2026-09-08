/**
 * 편집 키 입력 (§12.2, §13.3). 시트에 쓰는 화면 셋이 같은 칸을 쓴다.
 *
 * 저장된 키가 있으면 칸을 접고 "바꾸기"만 남긴다 — 매번 키를 보여줄 이유가 없다.
 * 값의 저장은 호출부가 한다(쓰기 직전에 setWriteKey). 여기서는 입력만 받는다.
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
  return (
    <div className="space-y-1">
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
          <p className="text-xs text-stone-400">이 브라우저에만 저장됩니다. 총무·지휘자만 알고 있으면 됩니다.</p>
        </>
      ) : (
        !compact && <p className="text-xs text-stone-500">저장된 키를 씁니다.</p>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  )
}
