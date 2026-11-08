import { spawn } from 'node:child_process'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { shell } from 'electron'
import type { Controller } from './controller'
import type { Sensor } from './sensor'

/** Folders full of files nobody means when they ask for a document. */
const NOISE = /\/(node_modules|\.git|\.cache|Library|\.Trash)\//

/** Opening these would run code, which is more than "show me this file". */
const BLOCKED_EXTENSIONS = new Set([
  '.app', '.command', '.sh', '.zsh', '.bash', '.pkg', '.dmg', '.exe', '.msi', '.bat', '.cmd', '.ps1',
  '.scpt', '.scptd', '.applescript', '.terminal', '.jar', '.workflow', '.action', '.dylib', '.url', '.webloc',
])

type Args = Record<string, unknown>

/** Stops as soon as it has enough, because a common name can match hundreds of thousands of files. */
function findFiles(query: string, limit: number): Promise<string[]> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('File search is only available on macOS for now.'))
  return new Promise((done, fail) => {
    const search = spawn('mdfind', ['-onlyin', homedir(), '-name', query], { stdio: ['ignore', 'pipe', 'ignore'] })
    const found: string[] = []
    const timer = setTimeout(() => search.kill(), 8000)
    createInterface({ input: search.stdout }).on('line', (path) => {
      if (found.length >= limit || NOISE.test(path)) return
      found.push(path)
      if (found.length === limit) search.kill()
    })
    search.on('error', fail)
    search.on('close', () => {
      clearTimeout(timer)
      done(found)
    })
  })
}

async function openItem(args: Args, controller: Controller): Promise<unknown> {
  if (typeof args.url === 'string') {
    const url = new URL(args.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links can be opened.')
    await shell.openExternal(url.href)
    return { opened: url.href }
  }
  if (typeof args.path === 'string') {
    const path = resolve(args.path)
    if (!path.startsWith(homedir() + sep)) throw new Error('Only files in your home folder can be opened.')
    if (BLOCKED_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('Focussr will not open programs or scripts.')
    if (!existsSync(path)) throw new Error('That file does not exist.')
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
    return { opened: path }
  }
  if (typeof args.app === 'string') {
    if (!controller.activateByName(args.app)) throw new Error(`"${args.app}" is not open.`)
    return { activated: args.app }
  }
  throw new Error('Give a path, a url or an app.')
}

/** Runs one tool. The MCP process holds no logic of its own. */
async function call(tool: string, args: Args, controller: Controller, sensor: Sensor): Promise<unknown> {
  switch (tool) {
    case 'list_tasks':
      return controller.listTasksForTools()
    case 'add_task':
      return controller.addTaskForTools(String(args.title), args.due ? String(args.due) : undefined)
    case 'start_focus':
      return controller.startForTools(args as { task_id?: string; title?: string; app?: string })
    case 'focus_status':
      return controller.statusForTools()
    case 'end_focus':
      controller.endSession()
      return { ended: true }
    case 'list_open_apps':
      return controller.openApps()
    case 'find_files':
      return findFiles(String(args.query), Math.min(Number(args.limit ?? 20), 100))
    case 'open_item':
      return openItem(args, controller)
    case 'find_on_screen':
      return sensor.findText(String(args.text))
    case 'read_screen':
      return { text: await sensor.readWindow() }
    default:
      throw new Error(`Unknown tool: ${tool}`)
  }
}

/** A socket only this user can reach. It exists only while "Connect an AI" is on. */
export class ToolBridge {
  private server: Server | null = null

  constructor(
    private readonly socket: string,
    private readonly getController: () => Controller,
    private readonly sensor: Sensor,
  ) {}

  private clear(): void {
    if (process.platform !== 'win32' && existsSync(this.socket)) unlinkSync(this.socket)
  }

  setEnabled(on: boolean): void {
    if (on && !this.server) {
      this.clear()
      this.server = createServer((connection) => {
        const lines = createInterface({ input: connection })
        lines.on('error', () => undefined)
        lines.on('line', async (line) => {
          let id: unknown
          try {
            const message = JSON.parse(line) as { id: unknown; tool: string; args?: Args }
            id = message.id
            const result = await call(message.tool, message.args ?? {}, this.getController(), this.sensor)
            connection.write(JSON.stringify({ id, result }) + '\n')
          } catch (error) {
            connection.write(JSON.stringify({ id, error: (error as Error).message }) + '\n')
          }
        })
        connection.on('error', () => connection.destroy())
      })
      this.server.on('error', (error) => console.error('MCP bridge failed:', error))
      this.server.listen(this.socket, () => {
        if (process.platform !== 'win32') chmodSync(this.socket, 0o600)
      })
    } else if (!on && this.server) {
      this.server.close()
      this.server = null
      this.clear()
    }
  }
}
