import { useState } from 'react'
import { ArrowRight, ArrowUp, Check, Link2, Scan, Video, VideoOff } from 'lucide-react'
import { deadlineStatus } from '@core/deadline'
import { hueForApp } from '@core/ribbon'
import type { AppState, FocusTask, RunningApp } from '@core/types'
import { api } from '../lib/api'
import { Ribbon } from './Ribbon'

const label = (app: RunningApp): string => (app.host ? `${app.name} · ${app.host}` : app.name)

function continueList(tasks: FocusTask[]): FocusTask[] {
  const dueTime = (t: FocusTask): number => (t.due ? new Date(t.due).getTime() : Infinity)
  return tasks
    .filter((t) => t.status !== 'done' && t.target)
    .sort((a, b) => dueTime(a) - dueTime(b))
    .slice(0, 3)
}

export function Home({ state }: { state: AppState }): React.JSX.Element {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<RunningApp | null>(null)
  const [camera, setCamera] = useState(false)
  const [menu, setMenu] = useState(false)
  const attach = picked ?? state.apps[0] ?? null
  const needsPermission = state.sensor.canReadScroll && !state.sensor.permissionGranted

  const start = (): void => {
    if (!text.trim() && !attach) return
    void api.submit(text, attach, camera)
    setText('')
  }

  return (
    <main className="home">
      <Ribbon size={64} hue="#FFFFFF" level={1} />
      <h1>What's next?</h1>

      {needsPermission && (
        <button className="notice" onClick={() => void api.requestPermission()}>
          Allow Accessibility so Focussr can follow your scrolling <ArrowRight size={14} />
        </button>
      )}
      {!state.sensor.canReadScroll && (
        <p className="notice plain">Scroll tracking is macOS only for now. Here, Focussr tracks focused time.</p>
      )}

      <div className="composer">
        <input
          autoFocus
          value={text}
          placeholder="Read chapter 4 in Preview by Friday"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
        <div className="toolbar">
          <div className="chips">
            <div className="menu-anchor">
              <button className="chip" onClick={() => setMenu(!menu)} disabled={state.apps.length === 0}>
                <Link2 size={14} /> {attach ? `Attach ${attach.name}` : 'No apps open'}
              </button>
              {menu && (
                <div className="menu">
                  {state.apps.map((app) => (
                    <button
                      key={app.pid}
                      onClick={() => {
                        setPicked(app)
                        setMenu(false)
                      }}
                    >
                      <i className="dot" style={{ background: hueForApp(app.appId) }} />
                      <span>{label(app)}</span>
                      {attach?.pid === app.pid && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {state.sensor.canReadScroll && (
              <button className="chip" onClick={() => void api.pickBox(text, camera)} title="Click any pane or section on screen">
                <Scan size={14} /> Pick a box
              </button>
            )}
            <button className={`chip ${camera ? 'on' : ''}`} onClick={() => setCamera(!camera)} title="Builds a heat map. Video is never saved.">
              {camera ? <Video size={14} /> : <VideoOff size={14} />} Video {camera ? 'on' : 'off'}
            </button>
          </div>
          <button className="send" onClick={start} aria-label="Start">
            <ArrowUp size={18} />
          </button>
        </div>
      </div>

      {continueList(state.tasks).length > 0 && (
        <section className="continue">
          {continueList(state.tasks).map((task) => {
            const deadline = deadlineStatus(task.due)
            return (
              <button key={task.id} onClick={() => void api.startTask(task.id, null, camera)}>
                <i className="dot" style={{ background: hueForApp(task.target?.appId) }} />
                <span className="title">{task.title}</span>
                <span className="where">{task.target?.box?.label ?? task.target?.host ?? task.target?.windowTitle ?? task.target?.appName}</span>
                {deadline.level !== 'none' && <span className={`due ${deadline.level}`}>{deadline.label}</span>}
                <span className="percent">{Math.round(task.progress * 100)}%</span>
                <ArrowRight size={15} />
              </button>
            )
          })}
        </section>
      )}

      {state.apps.length > 0 && (
        <div className="open-now">
          <span>Open now</span>
          {state.apps.slice(0, 6).map((app) => (
            <button key={app.pid} onClick={() => void api.submit(text, app, camera)}>
              {label(app)}
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
