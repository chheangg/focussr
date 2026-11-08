import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Heatmap } from '@core/types'
import { api } from '../lib/api'
import { paintHeat } from '../lib/heat'

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })

/** The real content, rebuilt from screenshots in document order, with attention painted on top. */
export function HeatMap({ taskId, live }: { taskId: string; live: boolean }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<Heatmap | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    observer.observe(holder.current!)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchHeat = (): void => void api.getHeatmap(taskId).then((value) => !cancelled && setData(value))
    fetchHeat()
    if (!live) return () => void (cancelled = true)
    const timer = setInterval(fetchHeat, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [taskId, live])

  useEffect(() => {
    const element = canvas.current
    if (!data || !element || !width) return
    let cancelled = false
    void (async () => {
      const images = await Promise.all(data.captures.map(async (c) => ({ ...c, image: await load(c.src) })))
      if (cancelled) return
      const first = images[0]
      const docHeight = first ? Math.min(12000, (width * first.image.naturalHeight) / first.image.naturalWidth / first.height) : width * 1.3
      const ratio = window.devicePixelRatio || 1
      element.width = width * ratio
      element.height = docHeight * ratio
      element.style.width = `${width}px`
      element.style.height = `${docHeight}px`
      const ctx = element.getContext('2d')!
      ctx.scale(ratio, ratio)
      ctx.fillStyle = '#111111'
      ctx.fillRect(0, 0, width, docHeight)
      for (const c of images) ctx.drawImage(c.image, 0, c.top * docHeight, width, c.height * docHeight)
      paintHeat(ctx, data.grid, 0, 0, width, docHeight, data.hue)
    })()
    return () => {
      cancelled = true
    }
  }, [data, width])

  const empty = data && data.captures.length === 0
  return (
    <div className="heat">
      <div className="heat-scroll" ref={holder}>
        <canvas ref={canvas} />
      </div>
      {empty && <p className="note">Screenshots appear as you read. macOS asks for Screen Recording the first time.</p>}
    </div>
  )
}
