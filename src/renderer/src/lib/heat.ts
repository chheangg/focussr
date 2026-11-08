const parseHue = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** Paints attention as soft blobs: transparent, then the app's colour, then white at the peak. */
export function paintHeat(target: CanvasRenderingContext2D, grid: number[][], x: number, y: number, width: number, height: number, hue: string): void {
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  if (!rows || !columns || width < 2 || height < 2) return
  const scale = Math.min(0.5, 700 / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale))
  const h = Math.max(2, Math.round(height * scale))
  const buffer = document.createElement('canvas')
  buffer.width = w
  buffer.height = h
  const ctx = buffer.getContext('2d', { willReadFrequently: true })!
  const cellW = w / columns
  const cellH = h / rows
  const radius = Math.max(cellW, cellH * 3) * 1.15
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const value = grid[r]![c]!
      if (value < 0.02) continue
      const cx = (c + 0.5) * cellW
      const cy = (r + 0.5) * cellH
      const blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      blob.addColorStop(0, `rgba(0,0,0,${Math.min(1, value * 0.3)})`)
      blob.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = blob
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    }
  }
  const image = ctx.getImageData(0, 0, w, h)
  const [hr, hg, hb] = parseHue(hue)
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]! / 255
    const hot = a * a
    image.data[i] = hr + (255 - hr) * hot
    image.data[i + 1] = hg + (255 - hg) * hot
    image.data[i + 2] = hb + (255 - hb) * hot
    image.data[i + 3] = Math.min(0.78, a * 1.25) * 255
  }
  ctx.putImageData(image, 0, 0)
  target.imageSmoothingQuality = 'high'
  target.drawImage(buffer, x, y, width, height)
}
