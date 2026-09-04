import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { ArchiveProvider, useArchive } from './lib/useArchive'
import Home from './pages/Home'
import Archive from './pages/Archive'
import Library from './pages/Library'
import Shelf from './pages/Shelf'
import SongDetail from './pages/SongDetail'
import Planner from './pages/Planner'
import Settings from './pages/Settings'

/**
 * GitHub Pages에는 서버 리라이트가 없다. HashRouter를 쓰면 새로고침·딥링크가
 * 404가 나지 않고, 카톡 인앱 브라우저에서도 안정적이다 (§13.2).
 */
const TABS = [
  { to: '/', label: '홈', end: true },
  { to: '/archive', label: '아카이브', end: false },
  { to: '/library', label: '곡', end: false },
  { to: '/shelf', label: '서가', end: false },
  { to: '/planner', label: '선곡', end: false },
]

function Chrome() {
  const { data, origin, loading, error, reload } = useArchive()

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-paper/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          {/* 교회 이름이 길어 버튼을 밀어낼 수 있다. 제목은 줄이고 버튼은 줄바꿈하지 않는다. */}
          <h1 className="min-w-0 truncate text-base font-extrabold tracking-tight sm:text-lg">
            {data.config.앱_제목}
          </h1>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <button type="button" onClick={reload} className="text-xs text-stone-400 hover:text-stone-600">
              {loading ? '새로고침 중…' : '새로고침'}
            </button>
            <NavLink to="/settings" className="text-xs text-stone-400 hover:text-stone-600">
              설정
            </NavLink>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  isActive ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-100'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <StatusBar origin={origin} error={error} />

      <main className="flex-1 space-y-5 px-4 py-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/library" element={<Library />} />
          <Route path="/shelf" element={<Shelf />} />
          <Route path="/shelf/:bookCode" element={<Shelf />} />
          <Route path="/song/:songCode" element={<SongDetail />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={<p className="card p-8 text-center text-sm text-stone-500">없는 화면입니다.</p>}
          />
        </Routes>
      </main>

      <footer className="space-y-1 px-4 pb-6 pt-2 text-center text-[11px] text-stone-400">
        {data.config.교회홈페이지 && (
          <p>
            <a
              href={data.config.교회홈페이지}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-stone-300 underline-offset-2 hover:text-stone-600"
            >
              중부워싱턴한인장로교회 (KPCCW)
            </a>
          </p>
        )}
        <p>편집은 구글 시트에서 합니다. 이 앱은 시트를 읽어 보여줍니다.</p>
      </footer>
    </div>
  )
}

function StatusBar({ origin, error }: { origin: string; error: string | null }) {
  if (origin === 'demo') {
    return (
      <p className="mx-4 mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
        예시 데이터를 보고 있습니다. <NavLink to="/settings" className="underline">설정</NavLink>에서 시트 주소를
        연결하세요.
      </p>
    )
  }
  if (origin === 'cache') {
    return (
      <p className="mx-4 mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
        네트워크에 연결하지 못해 마지막으로 받은 내용을 보여줍니다.
        {error && <span className="block opacity-70">{error}</span>}
      </p>
    )
  }
  return null
}

export default function App() {
  return (
    <ArchiveProvider>
      <HashRouter>
        <Chrome />
      </HashRouter>
    </ArchiveProvider>
  )
}
