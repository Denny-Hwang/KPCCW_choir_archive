import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cachedArchive, loadArchive, type DataOrigin } from './api'
import { parsePayload } from './schema'
import { linkIndex, rehearsalIndex, songIndex, sungHistory } from './derive'
import type { ArchiveData, PracticeLink, Rehearsal, Song } from './types'

interface ArchiveState {
  data: ArchiveData
  origin: DataOrigin
  fetchedAt: string | null
  loading: boolean
  error: string | null
  reload: () => void
  /** 매 렌더마다 다시 만들면 큰 목록에서 체감된다. 한 번만 만들어 공유한다. */
  songs: Map<string, Song>
  links: Map<string, PracticeLink[]>
  rehearsals: Map<string, Rehearsal[]>
  history: Map<string, string[]>
}

const EMPTY = parsePayload(null)

const ArchiveContext = createContext<ArchiveState | null>(null)

export function ArchiveProvider({ children }: { children: ReactNode }) {
  // 캐시가 있으면 첫 렌더부터 그것으로 그린다. Apps Script 왕복(1~3초)을 기다리는 동안
  // 스피너를 보여줄 이유가 없다 — 갱신은 뒤에서 돌고, 끝나면 조용히 바뀐다.
  const [seed] = useState(() => cachedArchive())
  const [data, setData] = useState<ArchiveData>(seed?.data ?? EMPTY)
  const [origin, setOrigin] = useState<DataOrigin>(seed ? 'cache' : 'network')
  const [fetchedAt, setFetchedAt] = useState<string | null>(seed?.fetchedAt ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadArchive()
      .then((result) => {
        if (cancelled) return
        setData(result.data)
        setOrigin(result.origin)
        setFetchedAt(result.fetchedAt)
        setError(result.error)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // 인덱스는 data가 바뀔 때만 다시 만든다. loading 토글마다 1,700행을 다시 훑을 이유가 없다.
  const indexes = useMemo(
    () => ({
      songs: songIndex(data.songs),
      links: linkIndex(data.practiceLinks),
      rehearsals: rehearsalIndex(data.rehearsals),
      history: sungHistory(data.services),
    }),
    [data],
  )

  const value = useMemo<ArchiveState>(
    () => ({ data, origin, fetchedAt, loading, error, reload, ...indexes }),
    [data, origin, fetchedAt, loading, error, reload, indexes],
  )

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>
}

export function useArchive(): ArchiveState {
  const ctx = useContext(ArchiveContext)
  if (!ctx) throw new Error('useArchive는 ArchiveProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
