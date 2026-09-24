/** Small line icons (inline SVG, inherit currentColor). Decorative: always aria-hidden. */
const PATHS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  gallery: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14',
  share: 'M12 15V4M8 8l4-4 4 4M6 12v7.5h12V12',
  alert: 'M12 8v5M12 16.5v.5M12 3.5l9.5 16.5h-19z',
  close: 'M6 6l12 12M18 6L6 18',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  rotateLeft: 'M5.5 12a6.5 6.5 0 1 0 1.9-4.6M5.5 4.5v3.5H9',
  rotateRight: 'M18.5 12a6.5 6.5 0 1 1-1.9-4.6M18.5 4.5v3.5H15',
  crop: 'M7 3v14h14M3 7h14v14',
  star: 'M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z',
  copy: 'M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.2 15.2L20 20',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED: ReadonlySet<IconName> = new Set(['play', 'pause']);

export function Icon({ name, size = 20, filled: fill = false }: { name: IconName; size?: number; filled?: boolean }) {
  const filled = fill || FILLED.has(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
