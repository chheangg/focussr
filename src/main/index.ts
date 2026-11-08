import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, ipcMain, net, powerMonitor, protocol, session, systemPreferences } from 'electron'
import { API_METHODS, type ApiMethod } from '@core/types'
import { ToolBridge } from './bridge'
import { CaptureStore } from './captures'
import { Controller } from './controller'
import { createSensor } from './sensor'
import { Windows } from './windows'

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:"

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

function serveRenderer(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const path = normalize(join(root, decodeURIComponent(url.pathname)))
    if (path !== root && !path.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(path).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(response.body, { status: response.status, headers })
  })
}

function allowCameraOnly(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, done) => done(permission === 'media'))
}

function mcpConfig(socket: string): string {
  const script = join(__dirname, 'mcp.js')
  return JSON.stringify(
    {
      mcpServers: {
        focussr: {
          command: process.execPath,
          args: [script],
          env: { ELECTRON_RUN_AS_NODE: '1', FOCUSSR_SOCKET: socket },
        },
      },
    },
    null,
    2,
  )
}

if (!app.requestSingleInstanceLock()) app.quit()

void app.whenReady().then(async () => {
  serveRenderer()
  allowCameraOnly()

  const data = app.getPath('userData')
  const socket =
    process.platform === 'win32' ? '\\\\.\\pipe\\focussr-mcp' : join(tmpdir(), `focussr-${process.getuid?.() ?? 0}.sock`)
  const binary = app.isPackaged
    ? join(process.resourcesPath, 'bin/focussr-sensor')
    : join(app.getAppPath(), 'resources/bin/focussr-sensor')

  const sensor = createSensor(binary)
  const windows = new Windows()
  windows.create()

  let controller: Controller
  const bridge = new ToolBridge(socket, () => controller, sensor)
  const captures = new CaptureStore(join(data, 'captures'))
  controller = new Controller(
    sensor,
    windows,
    captures,
    { tasks: join(data, 'tasks.json'), settings: join(data, 'settings.json') },
    () => powerMonitor.getSystemIdleTime(),
    () => mcpConfig(socket),
    (enabled) => bridge.setEnabled(enabled),
  )

  const handlers: Record<ApiMethod, (...args: never[]) => unknown> = {
    getState: () => controller.state(),
    submit: (text: string, target, camera: boolean) => controller.submit(text, target, camera),
    pickBox: (text: string, camera: boolean) => controller.pickBox(text, camera),
    addTask: (title: string, status) => controller.addTask(title, status),
    updateTask: (id: string, patch) => controller.updateTask(id, patch),
    moveTask: (id: string, before: string | null, status) => controller.moveTask(id, before, status),
    deleteTask: (id: string) => controller.deleteTask(id),
    startTask: (id: string, target, camera: boolean) => controller.startTask(id, target, camera),
    endSession: () => controller.endSession(),
    ask: (text: string) => controller.ask(text),
    sendGaze: (reading) => controller.setGaze(reading),
    setCamera: (on: boolean) => controller.setCamera(on),
    setMcpEnabled: (on: boolean) => controller.setMcpEnabled(on),
    requestPermission: async () => {
      controller.promptPermission()
      if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('camera').catch(() => false)
    },
    openMain: () => windows.showMain(),
    toggleWhere: () => controller.toggleWhere(),
    toggleHeat: () => controller.toggleHeat(),
    getHeatmap: (taskId: string) => controller.getHeatmap(taskId),
  }

  ipcMain.handle('focussr', (_event, method: ApiMethod, ...args: unknown[]) => {
    if (!API_METHODS.includes(method)) throw new Error(`Unknown method: ${method}`)
    return handlers[method](...(args as never[]))
  })

  app.on('activate', () => windows.showMain())
  app.on('before-quit', () => {
    controller.endSessionForQuit()
    bridge.setEnabled(false)
    sensor.stop()
  })

})

app.on('window-all-closed', () => app.quit())
