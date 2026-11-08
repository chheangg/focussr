import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './styles.css'
import type { OverlayFrame } from '@core/types'
import { api } from './lib/api'
import { paintHeat } from './lib/heat'

/** Click-through layer: the box picker, "show where", and heat painted on the live page. */
function Overlay(): React.JSX.Element | null {
  const [frame, setFrame] = useState<OverlayFrame | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const painted = useRef(0)

  useEffect(() => api.onOverlay(setFrame), [])

  useEffect(() => {
    if (frame?.mode !== 'heat' || !canvas.current || !frame.heat) return
    if (Date.now() - painted.current < 700) return
    painted.current = Date.now()
    const { width, height } = frame.frame
    const ratio = window.devicePixelRatio || 1
    canvas.current.width = width * ratio
    canvas.current.height = height * ratio
    const ctx = canvas.current.getContext('2d')!
    ctx.scale(ratio, ratio)
    paintHeat(ctx, frame.heat, 0, 0, width, height, frame.hue)
  }, [frame])

  if (!frame) return null
  if (frame.mode === 'heat') return <canvas ref={canvas} className="overlay-canvas" />
  const { width, height } = frame.frame
  return (
    <div className="overlay" style={{ '--hue': frame.hue } as CSSProperties}>
      <div className="bracket-box" style={{ width, height }}>
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>
      {frame.mode === 'pick' && (
        <div className="overlay-hint">
          <b>{frame.label}</b> <span>Click to attach · Esc to cancel</span>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
