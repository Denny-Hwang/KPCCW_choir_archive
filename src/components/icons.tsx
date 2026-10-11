import type { ReactNode } from 'react'

/**
 * 앱 전체가 함께 쓰는 아이콘.
 *
 * 대원 다수가 폰 글씨를 크게 해 두고 보는 연령대라, 10px 남짓한 아이콘은 있으나 마나였다.
 * 크기는 호출부가 className으로 정하되, 기본값을 넉넉하게 둔다.
 */
type IconProps = { className?: string; label?: string }

function Svg({ className = 'h-5 w-5', label, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </Svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  )
}

export function ChurchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z" fill="currentColor" />
    </Svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/* ---- 탭 아이콘 ---- */

export function HomeTabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function ArchiveTabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  )
}

export function SongTabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M9 18V6l11-2v12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </Svg>
  )
}

export function ShelfTabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M4 4h4v16H4zM10 4h4v16h-4zM16.2 4.6l3.8-.9 3 15.6-3.8.9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
        transform="translate(-1.2 0)"
      />
    </Svg>
  )
}

export function PlannerTabIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14M14.5 9.5H16M14.5 15.5H16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
