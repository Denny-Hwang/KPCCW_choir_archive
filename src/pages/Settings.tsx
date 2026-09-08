import { useState } from 'react'
import { clearCache, getEndpoint, getWriteKey, setEndpoint, setWriteKey } from '../lib/api'
import { useArchive } from '../lib/useArchive'
import { brokenLinks } from '../lib/derive'
import { Badge, Section } from '../components/ui'

/**
 * 설정.
 *
 * Apps Script 읽기 URL은 저장소에 있어도 되지만(§13.3 — 데이터에 개인정보가 없다),
 * 재배포 없이 고칠 수 있어야 해서 여기서 덮어쓸 수 있게 한다. 값은 이 브라우저에만 남는다.
 * §12.2 편집 키도 같은 자리에 둔다 — 저장소에는 절대 넣지 않고, 이 브라우저에만 남는다.
 */
export default function Settings() {
  const { data, origin, fetchedAt, error, reload } = useArchive()
  const [url, setUrl] = useState(getEndpoint())
  const [saved, setSaved] = useState(false)
  const [writeKey, setWriteKeyInput] = useState(getWriteKey())
  const [keySaved, setKeySaved] = useState(false)

  const broken = brokenLinks(data.practiceLinks)
  const unverifiedLinks = data.practiceLinks.filter((l) => !l.검증)
  const unverifiedSongs = data.songs.filter((s) => !s.검증)

  function save() {
    setEndpoint(url)
    clearCache()
    setSaved(true)
    reload()
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <Section title="데이터 출처">
        <div className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="endpoint">Apps Script 웹앱 URL</label>
            <input
              id="endpoint"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="field mt-1"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-stone-400">
              이 브라우저에만 저장됩니다. 배포 설정은 실행 주체 &lsquo;나&rsquo;, 액세스 &lsquo;모든 사용자&rsquo;여야 합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} className="btn-primary">
              {saved ? '저장됨' : '저장하고 다시 불러오기'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUrl('')
                setEndpoint('')
                clearCache()
                reload()
              }}
              className="btn-ghost"
            >
              연결 해제
            </button>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            <Badge tone={origin === 'network' ? 'ok' : origin === 'cache' ? 'warn' : 'neutral'}>
              {origin === 'network' ? '시트에서 직접' : origin === 'cache' ? '캐시' : '불러오기 실패'}
            </Badge>
            {data.updatedAt && <Badge>시트 기준 {data.updatedAt.slice(0, 16).replace('T', ' ')}</Badge>}
            {fetchedAt && <Badge>받은 시각 {fetchedAt.slice(0, 16).replace('T', ' ')}</Badge>}
          </div>
          {error && <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        </div>
      </Section>

      <Section title="편집 키 (다음 찬양으로)">
        <div className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="write-key">편집 키</label>
            <input
              id="write-key"
              type="password"
              value={writeKey}
              onChange={(e) => setWriteKeyInput(e.target.value)}
              placeholder="시트 메뉴 [성가 아카이브 > 앱 편집 키 설정]에서 정한 키"
              className="field mt-1"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-stone-400">
              곡 화면의 &lsquo;다음 찬양으로&rsquo;가 시트에 쓸 때 씁니다. 이 브라우저에만 저장되고, 없으면 붙여넣기 블록만 나옵니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setWriteKey(writeKey)
                setKeySaved(true)
                window.setTimeout(() => setKeySaved(false), 2000)
              }}
              className="btn-primary"
            >
              {keySaved ? '저장됨' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => {
                setWriteKeyInput('')
                setWriteKey('')
              }}
              className="btn-ghost"
            >
              지우기
            </button>
            <Badge tone={getWriteKey() ? 'ok' : 'neutral'}>{getWriteKey() ? '키 저장됨' : '키 없음'}</Badge>
          </div>
        </div>
      </Section>

      <Section title="데이터 점검">
        <ul className="card divide-y divide-stone-100 text-sm">
          <Stat label="악보집" value={`${data.books.length}권 (보유 ${data.books.filter((b) => b.보유).length})`} />
          <Stat label="곡" value={`${data.songs.length}곡`} />
          <Stat label="예배 기록" value={`${data.services.length}회`} />
          <Stat label="연습 일정" value={`${data.rehearsals.length}건`} />
          <Stat label="파트 영상" value={`${data.practiceLinks.length}개`} />
          <Stat
            label="미확인 곡"
            value={`${unverifiedSongs.length}곡`}
            tone={unverifiedSongs.length ? 'warn' : 'ok'}
          />
          <Stat
            label="미확인 링크"
            value={`${unverifiedLinks.length}개 (공지에서 제외됨)`}
            tone={unverifiedLinks.length ? 'warn' : 'ok'}
          />
          <Stat
            label="주소 인식 실패"
            value={`${broken.length}개`}
            tone={broken.length ? 'danger' : 'ok'}
          />
        </ul>
        {broken.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
            {broken.slice(0, 20).map((l, i) => (
              <li key={`${l.표시명}-${i}`} className="break-all">
                {l.표시명} · {l.파트} — {l.URL}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="설정 값 (config 시트)">
        <ul className="card divide-y divide-stone-100 text-xs">
          {Object.entries(data.config.raw).length ? (
            Object.entries(data.config.raw).map(([key, value]) => (
              <li key={key} className="flex gap-3 px-4 py-2">
                <span className="w-32 shrink-0 font-semibold text-stone-500">{key}</span>
                <span className="break-all">{value}</span>
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-stone-400">config 시트가 비어 있어 기본값을 쓰고 있습니다.</li>
          )}
        </ul>
      </Section>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <li className="flex items-center justify-between px-4 py-2">
      <span className="text-stone-500">{label}</span>
      {tone ? <Badge tone={tone}>{value}</Badge> : <span className="font-semibold">{value}</span>}
    </li>
  )
}
