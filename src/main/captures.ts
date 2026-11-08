import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopCapturer, systemPreferences } from 'electron'
import type { HeatCapture, Rect } from '@core/types'

const MAX_TILES = 80

/** Screenshots of the attached content. They stay in this folder and go when the task goes. */
export class CaptureStore {
  constructor(private readonly root: string) {}

  private dir(taskId: string): string {
    return join(this.root, taskId.replace(/[^a-zA-Z0-9-]/g, ''))
  }

  get allowed(): boolean {
    // Asking for a capture is what makes macOS show its permission prompt, so only a refusal stops it.
    return process.platform !== 'darwin' || !['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))
  }

  /** Crops the content out of a window screenshot and files it by document position. */
  async capture(taskId: string, windowId: number, window: Rect, surface: Rect, top: number, height: number): Promise<void> {
    const dir = this.dir(taskId)
    mkdirSync(dir, { recursive: true })
    if (readdirSync(dir).length >= MAX_TILES) return
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: Math.round(window.width * 2), height: Math.round(window.height * 2) },
    })
    const source = sources.find((s) => s.id.startsWith(`window:${windowId}:`))
    if (!source || source.thumbnail.isEmpty()) return
    const size = source.thumbnail.getSize()
    const scale = size.width / window.width
    const crop = source.thumbnail.crop({
      x: Math.max(0, Math.round((surface.x - window.x) * scale)),
      y: Math.max(0, Math.round((surface.y - window.y) * scale)),
      width: Math.min(size.width, Math.round(surface.width * scale)),
      height: Math.min(size.height, Math.round(surface.height * scale)),
    })
    writeFileSync(join(dir, `${top.toFixed(5)}_${height.toFixed(5)}.jpg`), crop.toJPEG(72))
  }

  list(taskId: string): HeatCapture[] {
    const dir = this.dir(taskId)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    return names.flatMap((name) => {
      const match = /^([\d.]+)_([\d.]+)\.jpg$/.exec(name)
      if (!match) return []
      const src = `data:image/jpeg;base64,${readFileSync(join(dir, name)).toString('base64')}`
      return [{ top: Number(match[1]), height: Number(match[2]), src }]
    })
  }

  remove(taskId: string): void {
    rmSync(this.dir(taskId), { recursive: true, force: true })
  }
}
