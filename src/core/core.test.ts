import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, ReadingModel, SLICES, type Sample } from './reading-model'
import { formatDuration, looksOffTask, parseIntent } from './intent'
import { hueForApp } from './ribbon'
import { deadlineStatus, parseDue } from './deadline'
import { captureBucket, heatGrid, viewportHeat } from './heat'
import { findResumable, type FocusTask } from './types'

const VIEWPORT = 0.1

function sample(time: number, position: number, extra: Partial<Sample> = {}): Sample {
  return { time, position, viewport: VIEWPORT, frontmost: true, idleSeconds: 0, ...extra }
}

/** Scrolls top to bottom at a fixed speed, sampling four times a second. */
function scrollThrough(model: ReadingModel, screensPerSecond: number): void {
  const screens = (1 - VIEWPORT) / VIEWPORT
  const seconds = screens / screensPerSecond
  for (let t = 0; t <= seconds * 4; t++) model.ingest(sample(t / 4, Math.min((t / 4 / seconds), 1)))
}

describe('ReadingModel', () => {
  it('finishes a document scrolled through slowly', () => {
    const model = new ReadingModel()
    scrollThrough(model, 1 / DEFAULT_CONFIG.secondsPerScreen)
    expect(model.progress).toBeGreaterThan(0.9)
  })

  it('gives fast scrolling no credit', () => {
    const model = new ReadingModel()
    scrollThrough(model, 3)
    // Only the first sampling window, before the speed average fills, can earn anything.
    expect(model.progress).toBeLessThan(0.02)
    expect(model.snapshot().state).toBe('skimming')
    expect(model.snapshot().skimmingSeconds).toBeGreaterThan(0)
  })

  it('does not treat one flick of the wheel as skimming', () => {
    const model = new ReadingModel()
    model.ingest(sample(0, 0.1))
    model.ingest(sample(0.25, 0.14))
    expect(model.snapshot().state).toBe('reading')
  })

  it('earns nothing while another app is in front', () => {
    const model = new ReadingModel()
    for (let t = 0; t < 40; t++) model.ingest(sample(t, 0, { frontmost: false }))
    expect(model.progress).toBe(0)
    expect(model.snapshot().state).toBe('away')
  })

  it('goes idle without input, unless the camera sees eyes', () => {
    const idle = new ReadingModel()
    idle.ingest(sample(0, 0, { idleSeconds: 200 }))
    idle.ingest(sample(1, 0, { idleSeconds: 201 }))
    expect(idle.snapshot().state).toBe('idle')

    const watching = new ReadingModel()
    watching.ingest(sample(0, 0, { idleSeconds: 200, eyesOnScreen: true }))
    watching.ingest(sample(1, 0, { idleSeconds: 201, eyesOnScreen: true }))
    expect(watching.snapshot().state).toBe('reading')
  })

  it('counts as away when the camera sees no eyes', () => {
    const model = new ReadingModel()
    model.ingest(sample(0, 0, { eyesOnScreen: false }))
    model.ingest(sample(1, 0, { eyesOnScreen: false }))
    expect(model.snapshot().state).toBe('away')
  })

  it('credits only where the eyes are when gaze is available', () => {
    const model = new ReadingModel()
    for (let t = 0; t < 200; t++) model.ingest(sample(t, 0, { eyesOnScreen: true, gazeX: 0.5, gazeY: 0.1 }))
    const { coverage, gaze } = model.snapshot()
    expect(coverage[1]).toBe(1)
    expect(coverage[8]).toBe(0)
    expect(gaze.length).toBe(SLICES)
  })

  it('caps time from a sleeping laptop', () => {
    const model = new ReadingModel()
    model.ingest(sample(0, 0))
    model.ingest(sample(10_000, 0))
    expect(model.snapshot().readingSeconds).toBe(5)
  })

  it('tracks time but not progress when scroll is unavailable', () => {
    const model = new ReadingModel()
    for (let t = 0; t < 10; t++) model.ingest({ ...sample(t, 0), position: null, viewport: null })
    const snap = model.snapshot()
    expect(snap.readingSeconds).toBe(9)
    expect(snap.measurable).toBe(false)
    expect(snap.progress).toBe(0)
  })

  it('forecasts from the observed pace', () => {
    const model = new ReadingModel()
    expect(model.secondsRemaining).toBeNull()
    for (let t = 0; t <= 30; t++) model.ingest(sample(t, 0))
    expect(model.secondsRemaining).toBeGreaterThan(0)
  })

  it('resumes from a save', () => {
    const model = new ReadingModel()
    for (let t = 0; t <= 30; t++) model.ingest(sample(t, 0))
    const restored = new ReadingModel(DEFAULT_CONFIG, JSON.parse(JSON.stringify(model.save())))
    expect(restored.progress).toBeCloseTo(model.progress)
  })
})

describe('parseIntent', () => {
  const now = new Date('2026-11-08T10:00:00')

  it('pulls out the app and due date', () => {
    const parsed = parseIntent('read chapter 4 in Preview by friday', ['Preview', 'Safari'], now)
    expect(parsed.title).toBe('Read chapter 4')
    expect(parsed.appHint).toBe('Preview')
    expect(parsed.due?.getDay()).toBe(5)
  })

  it('finds a website', () => {
    expect(parseIntent('finish the docs on https://www.example.com/guide', [], now).host).toBe('example.com')
  })

  it('keeps plain text as the title', () => {
    expect(parseIntent('clear my inbox', [], now)).toEqual({ title: 'Clear my inbox' })
  })
})

describe('findResumable', () => {
  const target = { appName: 'Preview', appId: 'com.apple.Preview', windowTitle: 'book.pdf' }
  const task: FocusTask = { id: '1', title: 'Read', status: 'doing', target, progress: 0.4, secondsFocused: 9, createdAt: '' }

  it('finds the same document', () => {
    expect(findResumable([task], { ...target })?.id).toBe('1')
  })

  it('ignores finished work and other documents', () => {
    expect(findResumable([{ ...task, status: 'done' }], target)).toBeUndefined()
    expect(findResumable([task], { ...target, windowTitle: 'other.pdf' })).toBeUndefined()
  })

  it('treats a box as separate from its whole window', () => {
    expect(findResumable([task], { ...target, box: { label: 'Notes', relX: 0.5, relY: 0.5 } })).toBeUndefined()
  })
})

describe('helpers', () => {
  it('flags distractions unless the task is about them', () => {
    expect(looksOffTask('Read chapter 4', 'cats - YouTube')).toBe(true)
    expect(looksOffTask('Watch the YouTube lecture', 'lecture - YouTube')).toBe(false)
  })

  it('formats durations', () => {
    expect(formatDuration(42)).toBe('42s')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(3900)).toBe('1h 5m')
  })

  it('gives an app the same colour every time', () => {
    expect(hueForApp('com.apple.Preview')).toBe(hueForApp('com.apple.Preview'))
    const distinct = new Set(['com.apple.Preview', 'com.apple.Safari', 'com.microsoft.Word', 'com.google.Chrome'].map(hueForApp))
    expect(distinct.size).toBeGreaterThan(1)
  })
})

describe('deadlines', () => {
  const now = new Date('2026-11-08T10:00:00')

  it('reads natural dates', () => {
    expect(new Date(parseDue('friday 5pm', now)!).getDay()).toBe(5)
    expect(parseDue('banana', now)).toBeUndefined()
  })

  it('reports lateness', () => {
    expect(deadlineStatus('2026-11-06T10:00:00', now)).toEqual({ level: 'late', label: '2d late' })
  })

  it('warns early when the forecast will not fit', () => {
    const due = '2026-11-12T10:00:00'
    expect(deadlineStatus(due, now).level).toBe('ok')
    expect(deadlineStatus(due, now, 60 * 60 * 24 * 5).level).toBe('soon')
  })

  it('shows nothing without a deadline', () => {
    expect(deadlineStatus(undefined, now).level).toBe('none')
  })
})

describe('heat', () => {
  it('falls back to coverage without gaze', () => {
    const grid = heatGrid({ coverage: new Array(SLICES).fill(0.5), gaze: [] })
    expect(grid[3]![4]).toBe(0.5)
  })

  it('normalises gaze to its peak', () => {
    const grid = heatGrid({ coverage: [], gaze: [[1, 4]] })
    expect(grid[0]).toEqual([0.25, 1])
  })

  it('returns only the rows on screen', () => {
    const grid = Array.from({ length: SLICES }, (_, i) => [i])
    expect(viewportHeat(grid, 0, 0.1).map((r) => r[0])[0]).toBe(0)
    expect(viewportHeat(grid, 1, 0.1).at(-1)![0]).toBe(99)
    expect(viewportHeat(grid, 0.5, 0.1).length).toBeLessThanOrEqual(11)
  })

  it('captures each screen once', () => {
    expect(captureBucket(0, 0.1)).toBe(0)
    expect(captureBucket(0.01, 0.1)).toBe(0)
    expect(captureBucket(0.5, 0.1)).toBeGreaterThan(0)
  })
})
