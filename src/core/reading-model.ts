export type ReadingState = 'reading' | 'skimming' | 'idle' | 'away'

/** One observation of the attached window. */
export interface Sample {
  time: number // seconds
  /** Top of the viewport, 0..1 of the scrollable range. Null when the app exposes no scroll info. */
  position: number | null
  /** Fraction of the document visible at once, 0..1. Null when unknown. */
  viewport: number | null
  frontmost: boolean
  /** Seconds since the last keyboard or mouse input on this computer. */
  idleSeconds: number
  /** Camera off: undefined. Camera on: whether eyes are on the screen. */
  eyesOnScreen?: boolean
  /** Gaze inside the viewport, 0..1. Undefined when unknown. */
  gazeX?: number
  gazeY?: number
}

export interface ReadingConfig {
  /** Sustained scrolling above this many screens per second is skimming. */
  skimScreensPerSecond: number
  /** The window the scroll speed is averaged over, so one flick of the wheel isn't skimming. */
  speedWindowSeconds: number
  /** Attention one screen needs before it counts as read. */
  secondsPerScreen: number
  idleAfterSeconds: number
  doneAt: number
}

export const DEFAULT_CONFIG: ReadingConfig = {
  skimScreensPerSecond: 0.6,
  speedWindowSeconds: 2.5,
  secondsPerScreen: 12,
  idleAfterSeconds: 90,
  doneAt: 0.95,
}

export const SLICES = 100
export const COLUMNS = 12

export interface ReadingSnapshot {
  state: ReadingState
  progress: number
  measurable: boolean
  coverage: number[]
  gaze: number[][]
  readingSeconds: number
  skimmingSeconds: number
  awaySeconds: number
  secondsRemaining: number | null
  done: boolean
}

export interface SavedModel {
  dwell: number[]
  gaze: number[][]
  readingSeconds: number
  skimmingSeconds: number
  awaySeconds: number
  measurable: boolean
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * Turns samples into coverage, progress and a forecast.
 *
 * The document is split into slices. Time is credited only to visible slices and only while the
 * state is `reading`, so fast scrolling can never raise progress.
 */
export class ReadingModel {
  private dwell = new Array<number>(SLICES).fill(0)
  private gaze: number[][] = []
  private readingSeconds = 0
  private skimmingSeconds = 0
  private awaySeconds = 0
  private measurable = false
  private state: ReadingState = 'idle'
  private last: Sample | null = null
  private travel: { time: number; screens: number }[] = []

  constructor(
    private readonly config: ReadingConfig = DEFAULT_CONFIG,
    saved?: SavedModel,
  ) {
    if (saved) {
      this.dwell = [...saved.dwell]
      this.gaze = saved.gaze.map((row) => [...row])
      this.readingSeconds = saved.readingSeconds
      this.skimmingSeconds = saved.skimmingSeconds
      this.awaySeconds = saved.awaySeconds
      this.measurable = saved.measurable
    }
  }

  ingest(sample: Sample): void {
    const previous = this.last
    this.last = sample
    if (!previous) return
    const elapsed = sample.time - previous.time
    if (elapsed <= 0) return
    // A long gap, like a sleeping laptop, earns nothing.
    const dt = Math.min(elapsed, 5)

    this.trackTravel(previous, sample)
    this.state = this.classify(sample)

    if (this.state === 'reading') {
      this.readingSeconds += dt
      if (sample.position !== null && sample.viewport !== null) this.credit(sample, dt)
    } else if (this.state === 'skimming') {
      this.skimmingSeconds += dt
    } else if (this.state === 'away') {
      this.awaySeconds += dt
    }
  }

  private trackTravel(previous: Sample, sample: Sample): void {
    this.travel = this.travel.filter((t) => sample.time - t.time <= this.config.speedWindowSeconds)
    if (
      previous.position === null ||
      sample.position === null ||
      sample.viewport === null ||
      sample.viewport >= 1
    )
      return
    const viewport = clamp(sample.viewport, 0.0001, 1)
    // Position spans only the scrollable part of the document, (1 - viewport).
    const screens = (Math.abs(sample.position - previous.position) * (1 - viewport)) / viewport
    if (screens > 0) this.travel.push({ time: sample.time, screens })
  }

  private classify(sample: Sample): ReadingState {
    if (!sample.frontmost || sample.eyesOnScreen === false) return 'away'
    const screens = this.travel.reduce((sum, t) => sum + t.screens, 0)
    if (screens / this.config.speedWindowSeconds > this.config.skimScreensPerSecond) return 'skimming'
    // Eyes confirmed on screen beat the idle timer: a long page needs no scrolling.
    if (sample.eyesOnScreen !== true && sample.idleSeconds > this.config.idleAfterSeconds) return 'idle'
    return 'reading'
  }

  private credit(sample: Sample, dt: number): void {
    this.measurable = true
    const viewport = clamp(sample.viewport ?? 1, 0.0001, 1)
    const top = clamp(sample.position ?? 0, 0, 1) * (1 - viewport)
    const first = clamp(Math.floor(top * SLICES), 0, SLICES - 1)
    const last = clamp(Math.ceil((top + viewport) * SLICES), first + 1, SLICES)

    if (sample.gazeY === undefined) {
      for (let i = first; i < last; i++) this.dwell[i]! += dt
      return
    }
    // With gaze, attention lands where the eyes are, spread over about a fifth of the screen.
    const centre = top + clamp(sample.gazeY, 0, 1) * viewport
    const half = Math.max(viewport * 0.1, 0.5 / SLICES)
    const from = clamp(Math.floor((centre - half) * SLICES), first, last - 1)
    const to = clamp(Math.ceil((centre + half) * SLICES), from + 1, last)
    // Keep the total credit per screen equal to the no-camera case so both forecasts agree.
    const share = (dt * (last - first)) / (to - from)
    for (let i = from; i < to; i++) this.dwell[i]! += share
    this.recordGaze(Math.floor((from + to) / 2), sample.gazeX ?? 0.5, dt)
  }

  private recordGaze(row: number, x: number, dt: number): void {
    if (this.gaze.length === 0) {
      this.gaze = Array.from({ length: SLICES }, () => new Array<number>(COLUMNS).fill(0))
    }
    const column = clamp(Math.floor(x * COLUMNS), 0, COLUMNS - 1)
    this.gaze[clamp(row, 0, SLICES - 1)]![column]! += dt
  }

  get progress(): number {
    return this.coverage().reduce((sum, c) => sum + c, 0) / SLICES
  }

  private coverage(): number[] {
    return this.dwell.map((d) => Math.min(d / this.config.secondsPerScreen, 1))
  }

  /** Seconds left at this reader's pace. Null until there is enough signal. */
  get secondsRemaining(): number | null {
    const remaining = this.config.doneAt - this.progress
    if (remaining <= 0) return 0
    if (this.readingSeconds < 20 || this.progress < 0.005) return null
    return remaining / (this.progress / this.readingSeconds)
  }

  snapshot(): ReadingSnapshot {
    const progress = this.progress
    return {
      state: this.state,
      progress,
      measurable: this.measurable,
      coverage: this.coverage(),
      gaze: this.gaze,
      readingSeconds: this.readingSeconds,
      skimmingSeconds: this.skimmingSeconds,
      awaySeconds: this.awaySeconds,
      secondsRemaining: this.secondsRemaining,
      done: progress >= this.config.doneAt,
    }
  }

  save(): SavedModel {
    return {
      dwell: this.dwell,
      gaze: this.gaze,
      readingSeconds: this.readingSeconds,
      skimmingSeconds: this.skimmingSeconds,
      awaySeconds: this.awaySeconds,
      measurable: this.measurable,
    }
  }
}
