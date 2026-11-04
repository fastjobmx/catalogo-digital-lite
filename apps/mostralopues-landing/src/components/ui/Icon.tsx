import type { SVGProps } from 'react'
import { brandIcons, type BrandIcon } from './brandIcons'

const strokes = {
  arrowUpRight: 'M7 17 17 7M8.5 7H17v8.5',
  arrowRight: 'M4.5 12h15M13.5 6l6 6-6 6',
  arrowDown: 'M12 4.5v15M6 13.5l6 6 6-6',
  check: 'M5 12.5l4.2 4.2L19 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 7.5h16M4 12h16M4 16.5h10',
  cart: 'M2.8 4h2.4l2.3 10.6a1.8 1.8 0 0 0 1.8 1.4h8a1.8 1.8 0 0 0 1.7-1.3L21 8H6.1M9.5 20.2h.01M17.5 20.2h.01',
  camera: 'M4 8.2A2.2 2.2 0 0 1 6.2 6h1.6l1.4-2h5.6l1.4 2h1.6A2.2 2.2 0 0 1 20 8.2v9.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.8zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  sparkle: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  link: 'M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1',
  layers: 'M12 3.5 21 8l-9 4.5L3 8zM3 12.5l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  tag: 'M3.5 12.2V4.8a1.3 1.3 0 0 1 1.3-1.3h7.4l8.3 8.3a1.3 1.3 0 0 1 0 1.8l-7.4 7.4a1.3 1.3 0 0 1-1.8 0zM8 8h.01',
  palette: 'M12 3.5a8.5 8.5 0 0 0 0 17c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9a4.2 4.2 0 0 0 4.2-4.2c0-4.1-3.8-7.4-8.5-7.4zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  panel: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 9h16M9 9v11',
  devices: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5V9M3 6.5v8A1.5 1.5 0 0 0 4.5 16H12M7 19h5M15.5 10h4a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5z',
  chevronDown: 'M6 9.5l6 6 6-6',
  replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9M4.5 4.5V9H9',
  store: 'M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3 9.5 5 4h14l2 5.5M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-5h4v5',
  stores: 'M3.5 10v9.5h10V10M2.5 10l1.6-4.5h8.8l1.6 4.5zM16.5 8.5l1-3h3.5v14h-4',
  box: 'M12 3.2 20 7.5v9L12 20.8 4 16.5v-9zM4 7.5l8 4.3 8-4.3M12 11.8v9',
  ticket: 'M3.5 8.5V6.2c0-.7.5-1.2 1.2-1.2h14.6c.7 0 1.2.5 1.2 1.2v2.3a3.5 3.5 0 0 0 0 7v2.3c0 .7-.5 1.2-1.2 1.2H4.7c-.7 0-1.2-.5-1.2-1.2v-2.3a3.5 3.5 0 0 0 0-7zM14 5v14',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6',
  wand: 'M4 20 15 9M14 4.5V2.5M14 9.5V7.5M17 6.5h2M10 6.5h2M19.5 2.5l-1.5 1.5',
  chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-7',
  bot: 'M12 4v3M6.5 7h11A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-6A2.5 2.5 0 0 1 6.5 7zM9 12.5h.01M15 12.5h.01M2 11.5v3M22 11.5v3',
  megaphone: 'M3.5 10.5v3a1 1 0 0 0 1 1H7l7 4V5.5l-7 4H4.5a1 1 0 0 0-1 1zM17.5 9a4 4 0 0 1 0 6M8 14.5l1.2 5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  shield: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z',
  send: 'M21 3.5 10.5 14M21 3.5l-6.5 17-4-6.5-6.5-4z',
  share: 'M18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.2 13.3l7.6 4.4M15.8 6.3l-7.6 4.4',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9h.01',
} as const

export type IconName = keyof typeof strokes | BrandIcon

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number; title?: string }

export function Icon({ name, size = 20, title, ...rest }: Props) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const }
  if (name in brandIcons) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" focusable="false" {...a11y} {...rest}>
        <path d={brandIcons[name as BrandIcon]} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" focusable="false" {...a11y} {...rest}>
      <path d={strokes[name as keyof typeof strokes]} />
    </svg>
  )
}
