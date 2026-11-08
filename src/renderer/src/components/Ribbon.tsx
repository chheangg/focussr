import { useId, type CSSProperties } from 'react'
import type { ReadingState } from '@core/reading-model'

const SHAPE = 'M3 2 H21 A1 1 0 0 1 22 3 V30 L12 23 L2 30 V3 A1 1 0 0 1 3 2 Z'

interface Props {
  size: number
  hue: string
  /** How much of the ribbon is filled, 0..1. It fills from the top, like reading down a page. */
  level: number
  state?: ReadingState | 'done' | 'still'
}

/** The bookmark. It sits on whatever you're reading and keeps your place. */
export function Ribbon({ size, hue, level, state = 'still' }: Props): React.JSX.Element {
  const clip = useId()
  const fill = Math.max(0, Math.min(1, level)) * 32
  return (
    <svg
      className={`ribbon ribbon-${state}`}
      viewBox="0 0 24 32"
      width={size * 0.75}
      height={size}
      style={{ '--hue': hue } as CSSProperties}
      aria-hidden
    >
      <defs>
        <clipPath id={clip}>
          <rect className="ribbon-level" x="0" y="0" width="24" height={fill} />
        </clipPath>
      </defs>
      <path d={SHAPE} className="ribbon-fill" clipPath={`url(#${clip})`} />
      <path d={SHAPE} className="ribbon-edge" />
    </svg>
  )
}
