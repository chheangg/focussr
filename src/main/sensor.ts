import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Rect, RunningApp } from '@core/types'

export interface SensorSample {
  t: number
  frontmost?: RunningApp
  scroll?: { position: number; viewport: number; visible: boolean }
  surface?: Rect
  window?: Rect
  windowId?: number
}

export interface Picked {
  cancelled: boolean
  label?: string
  relX?: number
  relY?: number
  name?: string
  appId?: string
  pid?: number
  title?: string
  host?: string
}

export interface FoundText {
  found: boolean
  snippet?: string
  frame?: Rect
}

/**
 * One sensor per platform, one protocol. Events: `sample`, `permission`, `hover`, `picked`.
 * Porting Focussr means implementing this for a new OS. See docs/ARCHITECTURE.md.
 */
export interface Sensor extends EventEmitter {
  readonly platform: string
  readonly canReadScroll: boolean
  listApps(): Promise<RunningApp[]>
  attach(pid: number, box?: { relX: number; relY: number }): void
  detach(): void
  pick(): void
  activate(pid: number): void
  findText(text: string): Promise<FoundText>
  readWindow(): Promise<string>
  promptPermission(): void
  stop(): void
}

/** Runs the native helper and speaks JSON lines with it. */
export class NativeSensor extends EventEmitter implements Sensor {
  readonly platform = process.platform
  readonly canReadScroll = true
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, (message: Record<string, unknown>) => void>()

  constructor(binary: string) {
    super()
    this.child = spawn(binary, [], { stdio: 'pipe' })
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line))
    this.child.on('error', (error) => console.error('Sensor failed:', error))
  }

  private receive(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const id = message.id as number | undefined
    if (id && this.pending.has(id)) {
      this.pending.get(id)!(message)
      this.pending.delete(id)
      return
    }
    if (message.type === 'sample') this.emit('sample', message)
    else if (message.type === 'permission') this.emit('permission', message.granted === true)
    else if (message.type === 'hover') this.emit('hover', message)
    else if (message.type === 'picked') this.emit('picked', message)
  }

  private send(command: Record<string, unknown>): void {
    if (this.child.stdin.writable) this.child.stdin.write(JSON.stringify(command) + '\n')
  }

  private request(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The sensor did not answer in time.'))
      }, 8000)
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      this.send({ ...command, id })
    })
  }

  async listApps(): Promise<RunningApp[]> {
    return (await this.request({ cmd: 'list' })).apps as RunningApp[]
  }
  attach(pid: number, box?: { relX: number; relY: number }): void {
    this.send({ cmd: 'attach', pid, ...box })
  }
  detach(): void {
    this.send({ cmd: 'detach' })
  }
  pick(): void {
    this.send({ cmd: 'pick' })
  }
  activate(pid: number): void {
    this.send({ cmd: 'activate', pid })
  }
  async findText(text: string): Promise<FoundText> {
    return (await this.request({ cmd: 'find', text })) as unknown as FoundText
  }
  async readWindow(): Promise<string> {
    return (await this.request({ cmd: 'read' })).text as string
  }
  promptPermission(): void {
    this.send({ cmd: 'prompt' })
  }
  stop(): void {
    this.child.kill()
  }
}

/** Used where no native sensor exists yet: tracks focused time, not scroll position. */
export class BasicSensor extends EventEmitter implements Sensor {
  readonly platform = process.platform
  readonly canReadScroll = false
  private timer: NodeJS.Timeout

  constructor() {
    super()
    this.timer = setInterval(() => this.emit('sample', { t: Date.now() / 1000 }), 1000)
    setImmediate(() => this.emit('permission', true))
  }
  async listApps(): Promise<RunningApp[]> {
    return []
  }
  attach(): void {}
  detach(): void {}
  pick(): void {
    this.emit('picked', { cancelled: true })
  }
  activate(): void {}
  async findText(): Promise<FoundText> {
    throw new Error('Searching the screen is only available on macOS for now.')
  }
  async readWindow(): Promise<string> {
    throw new Error('Reading the screen is only available on macOS for now.')
  }
  promptPermission(): void {}
  stop(): void {
    clearInterval(this.timer)
  }
}

export function createSensor(binary: string): Sensor {
  return process.platform === 'darwin' && existsSync(binary) ? new NativeSensor(binary) : new BasicSensor()
}
