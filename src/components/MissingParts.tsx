import { useState } from 'react'
import { useArchive } from '../lib/useArchive'
import { getWriteKey, setWriteKey } from '../lib/api'
import { addLink } from '../lib/write'
import { extractVideoId, youtubeSearchUrl } from '../lib/youtube'
import type { Book, Part, PracticeLink, Song } from '../lib/types'
import { SearchIcon } from './icons'
import { WriteKeyField } from './WriteKeyField'

/**
 * 곡 상세의 "아직 없는 파트".
 *
 * 시트에 없다고 유튜브에 없는 것이 아니다 — 채널 동기화가 놓친 영상이 실제로 있었다(36집 알토 등).
 * 대원은 "유튜브에서 찾기"로 바로 듣고, 총무·지휘자는 찾은 영상 주소를 붙여넣어
 * 그 자리에서 시트에 넣는다(편집 키 필요). 사람이 골라 넣은 것이므로 확인된 상태로 들어간다.
 * 반주는 영상이 없는 곡이 많아 빈칸으로 세지 않는다.
 */
export function MissingParts({
  song,
  book,
  links,
  order,
}: {
  song: Song
  book: Book | undefined
  links: PracticeLink[]
  order: Part[]
}) {
  const { reload } = useArchive()
  const missing = order.filter((part) => part !== '반주' && !links.some((l) => l.파트 === part))
  const [open, setOpen] = useState(false)
  const [part, setPart] = useState<Part | ''>('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState(() => getWriteKey())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  if (!missing.length) return null
  const chosen = part && missing.includes(part) ? part : missing[0]

  async function submit() {
    setMessage(null)
    if (!extractVideoId(url)) {
      setMessage({ tone: 'error', text: '유튜브 영상 주소를 붙여넣으세요. 영상의 [공유] → [복사]로 얻은 주소면 됩니다.' })
      return
    }
    const trimmed = key.trim()
    if (!trimmed) {
      setMessage({ tone: 'error', text: '편집 키를 넣으세요.' })
      return
    }
    setWriteKey(trimmed)
    setBusy(true)
    try {
      const r = await addLink({ 표시명: song.표시명, 파트: chosen, URL: url.trim() }, trimmed)
      if (r.ok) {
        setMessage({ tone: 'ok', text: r.added ? `${chosen} 영상을 넣었습니다.` : '이미 들어 있는 영상입니다.' })
        setUrl('')
        reload()
      } else {
        setMessage({ tone: 'error', text: r.error })
      }
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <p className="text-base font-bold">아직 없는 파트</p>
        <p className="text-sm text-stone-500">앱에 없어도 유튜브에는 있을 수 있습니다. 눌러서 찾아보세요.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {missing.map((p) => (
          <a
            key={p}
            href={youtubeSearchUrl(song, book, p)}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost"
          >
            <SearchIcon className="h-5 w-5" />
            {p}
          </a>
        ))}
      </div>

      {!open ? (
        <button type="button" className="text-sm text-stone-500 underline" onClick={() => setOpen(true)}>
          찾은 영상을 이 곡에 넣기 (총무·지휘자)
        </button>
      ) : (
        <div className="space-y-2 rounded-xl bg-stone-50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {missing.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPart(p)}
                className={`chip ${chosen === p ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-300'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            className="field"
            aria-label={`${chosen} 영상 주소`}
          />
          {!getWriteKey() && (
            <WriteKeyField value={key} onChange={setKey} editing onEdit={() => {}} compact disabled={busy} />
          )}
          <button type="button" className="btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? '넣는 중…' : `${chosen} 영상 넣기`}
          </button>
          {message && (
            <p className={`text-sm ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>
          )}
        </div>
      )}
    </div>
  )
}
