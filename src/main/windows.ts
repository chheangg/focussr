import { join } from 'node:path'
import { BrowserWindow, Notification, screen, type BrowserWindowConstructorOptions } from 'electron'
import type { AppState, OverlayFrame, Rect, SessionView } from '@core/types'
import type { Ui } from './controller'

const BAR = { width: 568, height: 64 }

const base: BrowserWindowConstructorOptions = {
  show: false,
  backgroundColor: '#000000',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    backgroundThrottling: false,
  },
}

function pageUrl(page: string): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? `${dev}/${page}.html` : `app://focussr/${page}.html`
}

const floating: BrowserWindowConstructorOptions = {
  ...base,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  resizable: false,
  focusable: false,
  hasShadow: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  fullscreenable: false,
}

/** The app's three surfaces: the main window, the pill, and the click-through overlay. */
export class Windows implements Ui {
  main!: BrowserWindow
  pill!: BrowserWindow
  layer!: BrowserWindow
  private lastBar = ''
  /** Once someone drags the bar, it stays where they put it for that session. */
  private placedByUser = false

  create(): void {
    this.main = new BrowserWindow({
      ...base,
      width: 1200,
      height: 780,
      minWidth: 860,
      minHeight: 600,
      title: 'Focussr',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
    })
    this.main.on('ready-to-show', () => this.main.show())
    void this.main.loadURL(pageUrl('index'))

    this.pill = new BrowserWindow({ ...floating, ...BAR })
    this.pill.on('will-move', () => (this.placedByUser = true))
    this.pill.setAlwaysOnTop(true, 'floating')
    this.pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    void this.pill.loadURL(pageUrl('hud'))

    this.layer = new BrowserWindow({ ...floating, width: 400, height: 400 })
    this.layer.setAlwaysOnTop(true, 'screen-saver')
    this.layer.setIgnoreMouseEvents(true)
    this.layer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    void this.layer.loadURL(pageUrl('overlay'))
  }

  broadcast(state: AppState): void {
    for (const window of [this.main, this.pill]) {
      if (!window.isDestroyed()) window.webContents.send('state', state)
    }
  }

  notify(title: string, body: string): void {
    new Notification({ title, body, silent: false }).show()
  }

  sessionChanged(view: SessionView | null): void {
    if (view && !this.pill.isVisible()) this.pill.showInactive()
    if (!view && this.pill.isVisible()) {
      this.pill.hide()
      this.placedByUser = false
      this.lastBar = ''
    }
  }

  /** The bar sits on the attached content, top centre, and travels with its window. */
  followTarget(frame: Rect | undefined): void {
    if (!frame || this.placedByUser) return
    const area = screen.getDisplayMatching({
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.max(1, Math.round(frame.width)),
      height: Math.max(1, Math.round(frame.height)),
    }).workArea
    const x = Math.min(area.x + area.width - BAR.width - 8, Math.max(area.x + 8, Math.round(frame.x + (frame.width - BAR.width) / 2)))
    const y = Math.max(area.y + 8, Math.round(frame.y + 8))
    const key = `${x},${y}`
    if (key === this.lastBar) return
    this.lastBar = key
    this.pill.setBounds({ x, y, ...BAR })
  }

  overlay(frame: OverlayFrame | null): void {
    if (!frame) {
      if (this.layer.isVisible()) this.layer.hide()
      this.layer.webContents.send('overlay', null)
      return
    }
    const pad = frame.mode === 'pick' ? 48 : 0
    const bounds = {
      x: Math.round(frame.frame.x),
      y: Math.round(frame.frame.y),
      width: Math.max(1, Math.round(frame.frame.width)),
      height: Math.max(1, Math.round(frame.frame.height) + pad),
    }
    this.layer.setBounds(bounds)
    if (!this.layer.isVisible()) this.layer.showInactive()
    this.layer.webContents.send('overlay', frame)
  }

  showMain(): void {
    this.main.show()
    this.main.focus()
  }

  hideMain(): void {
    this.main.minimize()
  }
}
