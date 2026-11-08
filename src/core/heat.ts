import { COLUMNS, SLICES } from './reading-model'

export interface HeatInput {
  coverage: number[]
  gaze: number[][]
}

/** Attention by document row and column, 0..1. Uses gaze when there is any, otherwise coverage. */
export function heatGrid({ coverage, gaze }: HeatInput): number[][] {
  if (gaze.length === 0) return coverage.map((c) => new Array<number>(COLUMNS).fill(c))
  let max = 0
  for (const row of gaze) for (const cell of row) max = Math.max(max, cell)
  if (max === 0) return gaze.map((row) => row.map(() => 0))
  return gaze.map((row) => row.map((cell) => cell / max))
}

/** The rows of the grid that are on screen right now, for painting over the live window. */
export function viewportHeat(grid: number[][], position: number, viewport: number): number[][] {
  const top = Math.max(0, Math.min(1, position)) * (1 - viewport)
  const first = Math.min(SLICES - 1, Math.floor(top * SLICES))
  const last = Math.max(first + 1, Math.min(SLICES, Math.ceil((top + viewport) * SLICES)))
  return grid.slice(first, last)
}

/** Which screen-sized tile a scroll position belongs to, so each part is captured once. */
export function captureBucket(position: number, viewport: number): number {
  const top = position * (1 - viewport)
  return Math.floor(top / Math.max(viewport * 0.8, 0.01))
}
