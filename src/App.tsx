import { Suspense, lazy } from 'react'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { ArchiveProvider, useArchive } from './lib/useArchive'
import { Spinner } from './components/ui'
import {
  ArchiveTabIcon,
  ChurchIcon,
  HomeTabIcon,
  PlannerTabIcon,
  RefreshIcon,
  ShelfTabIcon,
  SongTabIcon,
} from './components/icons'
import Home from './pages/Home'
import Archive from './pages/Archive'
import Library from './pages/Library'
import Shelf from './pages/Shelf'
import SongDetail from './pages/SongDetail'

// 선곡·설정은 총무와 지휘자만 여는 화면이고 이 앱에서 가장 무겁다.
// 대원이 홈만 보고 닫는 흔한 경우에 이걸 먼저 받게 할 이유가 없다.
const Planner = lazy(() => import('./pages/Planner'))
const Settings = lazy(() => import('./pages/Settings'))

/**
 * GitHub Pages에는 서버 리라이트가 없다. HashRouter를 쓰면 새로고침·딥링크가
 * 404가 나지 않고, 카톡 인앱 브라우저에서도 안정적이다 (§13.2).
 *
 * 설정 화면은 탭에 넣지 않는다. 대원들이 볼 화면이 아니다.
 * 총무·지휘자는 주소로 직접 연다: .../#/settings (데이터 점검용).
 */
const TABS = [
  { to: '/', label: '홈', end: true, Icon: HomeTabIcon },
  { to: '/archive', label: '아카이브', end: false, Icon: ArchiveTabIcon },
  { to: '/library', label: '곡', end: false, Icon: SongTabIcon },
  { to: '/shelf', label: '서가', end: false, Icon: ShelfTabIcon },
  { to: '/planner', label: '선곡', end: false, Icon: PlannerTabIcon },
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
          <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            {data.config.교회홈페이지 && (
              <a
                href={data.config.교회홈페이지}
                target="_blank"
                rel="noreferrer noopener"
                title="교회 홈페이지"
                aria-label="교회 홈페이지 열기"
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-700"
              >
                <ChurchIcon className="h-6 w-6" />
                {/* 폰에서는 교회 이름이 길어 글자는 접고 아이콘만 크게 둔다. */}
                <span className="hidden sm:inline">교회</span>
              </a>
            )}
            <button
              type="button"
              onClick={reload}
              aria-label="새로고침"
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-700"
            >
              <RefreshIcon className={`h-6 w-6 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{loading ? '받는 중' : '새로고침'}</span>
            </button>
          </div>
        </div>
        {/* 아이콘 + 글자. 글자만 있던 탭은 작고 붙어 있어 손가락으로 누르기도, 한눈에 찾기도 어려웠다. */}
        <nav className="grid grid-cols-5 gap-1 px-2 pb-2">
          {TABS.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[13px] font-semibold transition ${
                  isActive ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-100'
                }`
              }
            >
              <Icon className="h-6 w-6" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <StatusBar origin={origin} error={error} loading={loading} onRetry={reload} />

      <main className="flex-1 space-y-5 px-4 py-4">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/archive/:month" element={<Archive />} />
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
        </Suspense>
      </main>

      <footer className="space-y-1 px-4 pb-6 pt-2 text-center text-xs text-stone-400">
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
      </footer>
    </div>
  )
}

function StatusBar({
  origin,
  error,
  loading,
  onRetry,
}: {
  origin: string
  error: string | null
  loading: boolean
  onRetry: () => void
}) {
  if (origin === 'error') {
    return (
      <div className="mx-4 mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
        <p className="font-semibold">자료를 불러오지 못했습니다.</p>
        {error && <p className="mt-1 break-all opacity-60">{error}</p>}
        <button
          type="button"
          onClick={onRetry}
          disabled={loading}
          className="mt-2 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
        >
          {loading ? '다시 시도 중…' : '다시 시도'}
        </button>
      </div>
    )
  }
  // 캐시로 그리고 있어도 갱신이 도는 중이면 알리지 않는다. 실패가 확인됐을 때만 띄운다.
  if (origin === 'cache' && error) {
    return (
      <p className="mx-4 mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
        네트워크에 연결하지 못해 마지막으로 받은 내용을 보여줍니다.
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
