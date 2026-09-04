import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadArchive, type DataOrigin } from './api'
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
  const [data, setData] = useState<ArchiveData>(EMPTY)
  const [origin, setOrigin] = useState<DataOrigin>('demo')
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
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

  const value = useMemo<ArchiveState>(
    () => ({
      data,
      origin,
      fetchedAt,
      loading,
      error,
      reload,
      songs: songIndex(data.songs),
      links: linkIndex(data.practiceLinks),
      rehearsals: rehearsalIndex(data.rehearsals),
      history: sungHistory(data.services),
    }),
    [data, origin, fetchedAt, loading, error, reload],
  )

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>
}

export function useArchive(): ArchiveState {
  const ctx = useContext(ArchiveContext)
  if (!ctx) throw new Error('useArchive는 ArchiveProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
