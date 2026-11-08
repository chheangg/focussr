import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { deadlineStatus, parseDue } from '@core/deadline'
import { captureBucket, heatGrid, viewportHeat } from '@core/heat'
import { formatDuration, looksOffTask, parseIntent } from '@core/intent'
import { DEFAULT_CONFIG, ReadingModel, type ReadingState } from '@core/reading-model'
import { hueForApp } from '@core/ribbon'
import {
  findResumable,
  type AppState,
  type AttachTarget,
  type FocusTask,
  type GazeReading,
  type Heatmap,
  type OverlayFrame,
  type Rect,
  type RunningApp,
  type SessionView,
  type TaskPatch,
  type TaskStatus,
} from '@core/types'
import type { CaptureStore } from './captures'
import { askLocalModel } from './llm'
import type { Picked, Sensor, SensorSample } from './sensor'

/** What the controller needs from the windows, kept narrow so it can run without any. */
export interface Ui {
  broadcast(state: AppState): void
  notify(title: string, body: string): void
  sessionChanged(view: SessionView | null): void
  followTarget(frame: Rect | undefined): void
  overlay(frame: OverlayFrame | null): void
  showMain(): void
  hideMain(): void
}

interface Active {
  task: FocusTask
  model: ReadingModel
  camera: boolean
  pid?: number
  gaze?: { reading: GazeReading; at: number }
  drifted: boolean
  reply?: string
  showWhere: boolean
  showHeat: boolean
  announced: boolean
  savedAt: number
  capturedAt: number
  captured: Set<number>
  sample?: SensorSample
}

const STATE_WORD: Record<ReadingState, string> = {
  reading: 'Reading',
  skimming: 'Skimming, not counted',
  idle: 'Idle',
  away: 'Away',
}

export class Controller {
  private tasks: FocusTask[] = []
  private apps: RunningApp[] = []
  private permission = false
  private active: Active | null = null
  private lastFront?: RunningApp
  private mcpEnabled = false
  private pendingPick: { text: string; camera: boolean } | null = null

  constructor(
    private readonly sensor: Sensor,
    private readonly ui: Ui,
    private readonly captures: CaptureStore,
    private readonly files: { tasks: string; settings: string },
    private readonly idleSeconds: () => number,
    private readonly mcpConfig: () => string,
    private readonly onMcpChange: (enabled: boolean) => void,
  ) {
    this.load()
    sensor.on('sample', (s: SensorSample) => this.tick(s))
    sensor.on('permission', (granted: boolean) => {
      this.permission = granted
      this.publish()
    })
    sensor.on('hover', (h: Rect & { label: string; app: string }) =>
      this.ui.overlay({
        frame: { x: h.x, y: h.y, width: h.width, height: h.height },
        mode: 'pick',
        hue: '#FFFFFF',
        label: `${h.label} · ${h.app}`,
      }),
    )
    sensor.on('picked', (p: Picked) => void this.finishPick(p))
    setInterval(() => void this.refreshApps(), 4000)
    setInterval(() => this.checkDeadlines(), 60_000)
    void this.refreshApps()
    if (this.mcpEnabled) this.onMcpChange(true)
  }

  // Storage

  private load(): void {
    try {
      if (existsSync(this.files.tasks)) this.tasks = JSON.parse(readFileSync(this.files.tasks, 'utf8'))
      if (existsSync(this.files.settings)) this.mcpEnabled = JSON.parse(readFileSync(this.files.settings, 'utf8')).mcpEnabled === true
    } catch (error) {
      // A corrupt file is kept aside rather than overwritten, so tasks can be recovered.
      console.error('Could not read saved tasks:', error)
      if (existsSync(this.files.tasks)) renameSync(this.files.tasks, `${this.files.tasks}.broken`)
    }
  }

  private save(): void {
    mkdirSync(dirname(this.files.tasks), { recursive: true })
    const temp = `${this.files.tasks}.tmp`
    writeFileSync(temp, JSON.stringify(this.tasks))
    renameSync(temp, this.files.tasks)
  }

  // State

  state(): AppState {
    return {
      tasks: this.tasks.map(({ model: _model, ...task }) => task),
      apps: this.apps,
      sensor: {
        platform: this.sensor.platform,
        canReadScroll: this.sensor.canReadScroll,
        permissionGranted: this.permission,
      },
      session: this.view(),
      mcp: { enabled: this.mcpEnabled, config: this.mcpConfig() },
    }
  }

  private view(): SessionView | null {
    const a = this.active
    if (!a) return null
    return {
      taskId: a.task.id,
      title: a.task.title,
      target: a.task.target,
      camera: a.camera,
      reading: a.model.snapshot(),
      drifted: a.drifted,
      reply: a.reply,
      showWhere: a.showWhere,
      showHeat: a.showHeat,
    }
  }

  private publish(): void {
    const state = this.state()
    this.ui.broadcast(state)
    this.ui.sessionChanged(state.session)
  }

  private async refreshApps(): Promise<void> {
    try {
      const apps = await this.sensor.listApps()
      const front = this.lastFront
      this.apps = [...apps].sort((a, b) => Number(b.appId === front?.appId) - Number(a.appId === front?.appId))
      this.publish()
    } catch {
      // The next refresh will try again.
    }
  }

  // Sessions

  private toTarget(app: RunningApp): AttachTarget {
    return { appName: app.name, appId: app.appId, windowTitle: app.title || undefined, host: app.host }
  }

  async submit(text: string, app: RunningApp | null, camera: boolean): Promise<void> {
    const trimmed = text.trim()
    const parsed = parseIntent(trimmed, this.apps.map((a) => a.name))
    const hinted = this.apps.find((a) => a.name === parsed.appHint)
    const byHost = parsed.host ? this.apps.find((a) => a.host === parsed.host) : undefined
    const chosen = hinted ?? byHost ?? app ?? this.apps[0] ?? null
    const target = chosen ? this.toTarget(chosen) : undefined
    if (!trimmed && !target) return

    const resumable = target && findResumable(this.tasks, target)
    if (resumable && (!trimmed || resumable.title === parsed.title)) {
      await this.begin(resumable, chosen, camera)
      return
    }
    const sameName = this.tasks.find((t) => t.status !== 'done' && t.title.toLowerCase() === parsed.title.toLowerCase() && (!t.target || t.target.appId === target?.appId))
    if (trimmed && sameName) {
      sameName.target ??= target
      await this.begin(sameName, chosen, camera)
      return
    }
    const fallback = chosen?.title || (chosen ? `Focus in ${chosen.name}` : 'Focus')
    const task = this.createTask(trimmed ? parsed.title : fallback, 'doing', parsed.due?.toISOString())
    task.target = target
    await this.begin(task, chosen, camera)
  }

  private createTask(title: string, status: TaskStatus, due?: string): FocusTask {
    const task: FocusTask = {
      id: randomUUID(),
      title,
      status,
      progress: 0,
      secondsFocused: 0,
      createdAt: new Date().toISOString(),
      ...(due ? { due } : {}),
    }
    this.tasks.unshift(task)
    this.save()
    return task
  }

  async startTask(id: string, app: RunningApp | null, camera: boolean): Promise<void> {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) return
    const running = app ?? (task.target ? this.apps.find((a) => a.appId === task.target!.appId) : undefined) ?? this.apps[0] ?? null
    if (!task.target && running) task.target = this.toTarget(running)
    await this.begin(task, running, camera)
  }

  private async begin(task: FocusTask, app: RunningApp | null, camera: boolean): Promise<void> {
    this.end()
    task.status = 'doing'
    this.active = {
      task,
      model: new ReadingModel(DEFAULT_CONFIG, task.model),
      camera,
      pid: app?.pid,
      drifted: false,
      showWhere: false,
      showHeat: false,
      announced: task.progress >= DEFAULT_CONFIG.doneAt,
      savedAt: 0,
      capturedAt: 0,
      captured: new Set(),
    }
    if (app) {
      this.sensor.attach(app.pid, task.target?.box)
      this.ui.hideMain()
    }
    this.save()
    this.publish()
  }

  endSession(): void {
    this.end()
    this.ui.showMain()
    this.publish()
  }

  private end(): void {
    const a = this.active
    if (!a) return
    this.store(a)
    this.sensor.detach()
    this.active = null
    this.ui.overlay(null)
    this.save()
  }

  endSessionForQuit(): void {
    this.end()
  }

  private store(a: Active): void {
    const snap = a.model.snapshot()
    a.task.model = a.model.save()
    a.task.progress = snap.progress
    a.task.secondsFocused = snap.readingSeconds
  }

  private matchesTarget(sample: SensorSample, target?: AttachTarget): boolean {
    // Without a native sensor there is no way to know what is in front.
    if (!target || !this.sensor.canReadScroll) return true
    const front = sample.frontmost
    if (!front || front.appId !== target.appId) return false
    // Switching tab to another site is leaving the task, even in the same browser.
    return !target.host || !front.host || front.host === target.host
  }

  private tick(sample: SensorSample): void {
    if (sample.frontmost) this.lastFront = sample.frontmost
    const a = this.active
    if (!a) return
    a.sample = sample

    const gaze = a.camera && a.gaze && sample.t - a.gaze.at < 2 ? a.gaze.reading : undefined
    const inFront = this.matchesTarget(sample, a.task.target) && sample.scroll?.visible !== false
    a.model.ingest({
      time: sample.t,
      position: sample.scroll?.position ?? null,
      viewport: sample.scroll?.viewport ?? null,
      frontmost: inFront,
      idleSeconds: this.idleSeconds(),
      ...(gaze ? { eyesOnScreen: gaze.eyesOnScreen, gazeX: gaze.gazeX, gazeY: gaze.gazeY } : {}),
    })
    a.drifted = !!sample.frontmost?.title && looksOffTask(a.task.title, sample.frontmost.title)

    const snap = a.model.snapshot()
    a.task.progress = snap.progress
    a.task.secondsFocused = snap.readingSeconds

    if (inFront) this.ui.followTarget(sample.surface ?? sample.window)
    this.paintOverlay(a)
    if (a.camera && snap.state === 'reading') void this.captureContent(a, sample)

    if (snap.done && !a.announced) {
      a.announced = true
      a.task.status = 'done'
      a.reply = `Done. ${formatDuration(snap.readingSeconds)} of real reading.`
      this.ui.notify('Finished', a.task.title)
      this.store(a)
      this.save()
    }
    if (sample.t - a.savedAt > 10) {
      a.savedAt = sample.t
      this.store(a)
      this.save()
    }
    this.publish()
  }

  private paintOverlay(a: Active): void {
    const sample = a.sample
    const frame = sample?.surface ?? sample?.window
    if (!frame || !(a.showWhere || a.showHeat) || !this.matchesTarget(sample!, a.task.target)) {
      this.ui.overlay(null)
      return
    }
    const hue = hueForApp(a.task.target?.appId)
    if (a.showHeat && sample!.scroll) {
      const grid = heatGrid(a.model.snapshot())
      const heat = viewportHeat(grid, sample!.scroll.position, sample!.scroll.viewport)
      this.ui.overlay({ frame, mode: 'heat', hue, heat })
      return
    }
    this.ui.overlay({ frame, mode: 'where', hue })
  }

  private async captureContent(a: Active, sample: SensorSample): Promise<void> {
    const { scroll, windowId, window, surface } = sample
    if (!scroll || !windowId || !window || !surface || !this.captures.allowed) return
    const bucket = captureBucket(scroll.position, scroll.viewport)
    // Wait for the page to settle so a tile is never captured mid-scroll.
    if (a.captured.has(bucket) || sample.t - a.capturedAt < 1.5) return
    a.capturedAt = sample.t
    a.captured.add(bucket)
    const top = scroll.position * (1 - scroll.viewport)
    await this.captures.capture(a.task.id, windowId, window, surface, top, scroll.viewport).catch((error) => {
      a.captured.delete(bucket)
      console.error('Capture failed:', error)
    })
  }

  toggleWhere(): void {
    if (!this.active) return
    this.active.showWhere = !this.active.showWhere
    this.paintOverlay(this.active)
    this.publish()
  }

  toggleHeat(): void {
    if (!this.active) return
    this.active.showHeat = !this.active.showHeat
    this.paintOverlay(this.active)
    this.publish()
  }

  setCamera(on: boolean): void {
    if (!this.active) return
    this.active.camera = on
    this.publish()
  }

  setGaze(reading: GazeReading): void {
    if (this.active) this.active.gaze = { reading, at: Date.now() / 1000 }
  }

  getHeatmap(taskId: string): Heatmap | null {
    const live = this.active?.task.id === taskId ? this.active : null
    const task = this.tasks.find((t) => t.id === taskId)
    if (!task) return null
    const snap = live ? live.model.snapshot() : new ReadingModel(DEFAULT_CONFIG, task.model).snapshot()
    return {
      title: task.title,
      hue: hueForApp(task.target?.appId),
      grid: heatGrid(snap),
      captures: this.captures.list(taskId),
    }
  }

  // Picking a box

  pickBox(text: string, camera: boolean): void {
    this.pendingPick = { text, camera }
    this.ui.hideMain()
    this.sensor.pick()
  }

  private async finishPick(picked: Picked): Promise<void> {
    this.ui.overlay(null)
    const pending = this.pendingPick
    this.pendingPick = null
    if (picked.cancelled || !pending || picked.pid === undefined) {
      this.ui.showMain()
      return
    }
    const app: RunningApp = { name: picked.name!, appId: picked.appId!, pid: picked.pid, title: picked.title, host: picked.host }
    const target: AttachTarget = {
      ...this.toTarget(app),
      box: { label: picked.label!, relX: picked.relX!, relY: picked.relY! },
    }
    const existing = findResumable(this.tasks, target)
    if (existing) {
      await this.begin(existing, app, pending.camera)
      return
    }
    const parsed = parseIntent(pending.text)
    const task = this.createTask(pending.text.trim() ? parsed.title : `${picked.label} in ${picked.name}`, 'doing', parsed.due?.toISOString())
    task.target = target
    await this.begin(task, app, pending.camera)
  }

  // Task list

  addTask(title: string, status: TaskStatus, due?: string): FocusTask {
    const parsed = parseIntent(title, this.apps.map((a) => a.name))
    const task = this.createTask(parsed.title, status, due ?? parsed.due?.toISOString())
    this.publish()
    return task
  }

  updateTask(id: string, patch: TaskPatch): void {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) return
    Object.assign(task, patch)
    if (patch.due !== undefined && !patch.due) delete task.due
    this.save()
    this.publish()
  }

  moveTask(id: string, beforeId: string | null, status: TaskStatus): void {
    const from = this.tasks.findIndex((t) => t.id === id)
    if (from < 0) return
    const [task] = this.tasks.splice(from, 1)
    task!.status = status
    const at = beforeId ? this.tasks.findIndex((t) => t.id === beforeId) : -1
    if (at >= 0) this.tasks.splice(at, 0, task!)
    else this.tasks.push(task!)
    this.save()
    this.publish()
  }

  deleteTask(id: string): void {
    if (this.active?.task.id === id) this.end()
    this.tasks = this.tasks.filter((t) => t.id !== id)
    this.captures.remove(id)
    this.save()
    this.publish()
  }

  private checkDeadlines(): void {
    const now = Date.now()
    let changed = false
    for (const task of this.tasks) {
      if (task.status === 'done' || !task.due || task.remindedFor === task.due) continue
      const until = new Date(task.due).getTime() - now
      if (until < 3_600_000) {
        task.remindedFor = task.due
        changed = true
        this.ui.notify(until < 0 ? 'Past its deadline' : 'Due within the hour', task.title)
      }
    }
    if (changed) this.save()
  }

  // Asking

  private describe(a: Active): string {
    const s = a.model.snapshot()
    const parts = [
      s.measurable
        ? `${Math.round(s.progress * 100)}% through "${a.task.title}".`
        : `Working on "${a.task.title}".`,
      `${formatDuration(s.readingSeconds)} reading, ${formatDuration(s.skimmingSeconds)} skimming.`,
    ]
    if (s.secondsRemaining) parts.push(`About ${formatDuration(s.secondsRemaining)} left at this pace.`)
    if (a.task.due) parts.push(`Due ${deadlineStatus(a.task.due, new Date(), s.secondsRemaining).label}.`)
    return parts.join(' ')
  }

  async ask(question: string): Promise<void> {
    const a = this.active
    if (!a) return
    const facts = this.describe(a)
    a.reply = 'Thinking…'
    this.publish()
    const prompt = `You help someone stay focused. Facts: ${facts}\nAnswer in one short sentence.\nQuestion: ${question}`
    const answer = await askLocalModel(prompt)
    if (this.active === a) {
      a.reply = answer ?? facts
      this.publish()
    }
  }

  setMcpEnabled(on: boolean): void {
    this.mcpEnabled = on
    mkdirSync(dirname(this.files.settings), { recursive: true })
    writeFileSync(this.files.settings, JSON.stringify({ mcpEnabled: on }))
    this.onMcpChange(on)
    this.publish()
  }

  promptPermission(): void {
    this.sensor.promptPermission()
  }

  // Tools for connected AI

  listTasksForTools(): unknown[] {
    return this.tasks.map(({ model: _model, remindedFor: _reminded, ...t }) => ({
      ...t,
      deadline: deadlineStatus(t.due).label,
    }))
  }

  addTaskForTools(title: string, due?: string): unknown {
    const task = this.addTask(title, 'todo', due ? parseDue(due) : undefined)
    return { id: task.id, title: task.title, due: task.due ?? null }
  }

  async startForTools(input: { task_id?: string; title?: string; app?: string }): Promise<unknown> {
    const app = input.app ? this.apps.find((a) => a.name.toLowerCase() === input.app!.toLowerCase()) : undefined
    if (input.app && !app) throw new Error(`"${input.app}" is not open.`)
    if (input.task_id) await this.startTask(input.task_id, app ?? null, false)
    else if (input.title) await this.submit(input.title, app ?? null, false)
    else throw new Error('Give a task_id or a title.')
    return this.statusForTools()
  }

  statusForTools(): unknown {
    const a = this.active
    if (!a) return { active: false }
    const s = a.model.snapshot()
    return {
      active: true,
      title: a.task.title,
      target: a.task.target ?? null,
      state: STATE_WORD[s.state],
      percent: s.measurable ? Math.round(s.progress * 100) : null,
      seconds_reading: Math.round(s.readingSeconds),
      seconds_skimming: Math.round(s.skimmingSeconds),
      seconds_remaining: s.secondsRemaining === null ? null : Math.round(s.secondsRemaining),
      done: s.done,
    }
  }

  openApps(): RunningApp[] {
    return this.apps
  }

  activateByName(name: string): boolean {
    const app = this.apps.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (app) this.sensor.activate(app.pid)
    return !!app
  }

  stateWord(state: ReadingState): string {
    return STATE_WORD[state]
  }
}
