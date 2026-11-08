import type { ReadingSnapshot, SavedModel } from './reading-model'

export type TaskStatus = 'todo' | 'doing' | 'done'

/** One part of a window, like a pane or a div. Stored relative to the window so it survives moves. */
export interface BoxTarget {
  label: string
  relX: number
  relY: number
}

/** What a task follows: an app, optionally a website, optionally one box inside it. */
export interface AttachTarget {
  appName: string
  appId: string
  windowTitle?: string
  host?: string
  box?: BoxTarget
}

export interface FocusTask {
  id: string
  title: string
  status: TaskStatus
  target?: AttachTarget
  progress: number
  secondsFocused: number
  due?: string
  createdAt: string
  model?: SavedModel
  /** The deadline a reminder was already sent for. */
  remindedFor?: string
}

export interface RunningApp {
  name: string
  appId: string
  pid: number
  title?: string
  host?: string
}

export interface SensorStatus {
  platform: string
  /** Whether this platform's sensor can read scroll position. */
  canReadScroll: boolean
  permissionGranted: boolean
}

export interface SessionView {
  taskId: string
  title: string
  target?: AttachTarget
  camera: boolean
  reading: ReadingSnapshot
  drifted: boolean
  reply?: string
  showWhere: boolean
  showHeat: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** One screenshot of the content and where it sits in the document, 0..1. */
export interface HeatCapture {
  top: number
  height: number
  src: string
}

export interface Heatmap {
  title: string
  hue: string
  grid: number[][]
  captures: HeatCapture[]
}

/** What the click-through overlay draws on top of the attached app. */
export interface OverlayFrame {
  frame: Rect
  mode: 'pick' | 'where' | 'heat'
  hue: string
  label?: string
  heat?: number[][]
}

export interface GazeReading {
  eyesOnScreen: boolean
  gazeX?: number
  gazeY?: number
}

export interface McpInfo {
  enabled: boolean
  config: string
}

export interface AppState {
  tasks: FocusTask[]
  apps: RunningApp[]
  sensor: SensorStatus
  session: SessionView | null
  mcp: McpInfo
}

export type TaskPatch = Partial<Pick<FocusTask, 'title' | 'status' | 'due'>>

/** Everything the interface can ask the main process to do. */
export interface FocussrApi {
  getState(): Promise<AppState>
  submit(text: string, app: RunningApp | null, camera: boolean): Promise<void>
  pickBox(text: string, camera: boolean): Promise<void>
  addTask(title: string, status: TaskStatus): Promise<void>
  updateTask(id: string, patch: TaskPatch): Promise<void>
  moveTask(id: string, beforeId: string | null, status: TaskStatus): Promise<void>
  deleteTask(id: string): Promise<void>
  startTask(id: string, app: RunningApp | null, camera: boolean): Promise<void>
  endSession(): Promise<void>
  ask(text: string): Promise<void>
  sendGaze(reading: GazeReading): Promise<void>
  setCamera(on: boolean): Promise<void>
  setMcpEnabled(on: boolean): Promise<void>
  requestPermission(): Promise<void>
  openMain(): Promise<void>
  toggleWhere(): Promise<void>
  toggleHeat(): Promise<void>
  getHeatmap(taskId: string): Promise<Heatmap | null>
}

export type ApiMethod = keyof FocussrApi

export const API_METHODS: ApiMethod[] = [
  'getState',
  'submit',
  'pickBox',
  'addTask',
  'updateTask',
  'moveTask',
  'deleteTask',
  'startTask',
  'endSession',
  'ask',
  'sendGaze',
  'setCamera',
  'setMcpEnabled',
  'requestPermission',
  'openMain',
  'toggleWhere',
  'toggleHeat',
  'getHeatmap',
]

/** Same document, same website or same box means the same work. */
export function targetKey(target: AttachTarget): string {
  return [target.appId, target.host ?? target.windowTitle ?? '', target.box?.label ?? ''].join('|')
}

/** The unfinished task already following this target, so progress is picked up where it stopped. */
export function findResumable(tasks: FocusTask[], target: AttachTarget): FocusTask | undefined {
  const key = targetKey(target)
  return tasks.find((t) => t.status !== 'done' && t.target && targetKey(t.target) === key)
}
