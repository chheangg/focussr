import { useEffect, useState } from 'react'
import { BookmarkIcon, ListChecks, Plug } from 'lucide-react'
import { Connect } from './components/Connect'
import { Home } from './components/Home'
import { Session } from './components/Session'
import { Tasks } from './components/Tasks'
import { useAppState } from './lib/api'
import { useGaze } from './lib/gaze'

type View = 'focus' | 'tasks' | 'connect'

const NAV: { view: View; label: string; icon: typeof ListChecks }[] = [
  { view: 'focus', label: 'Focus', icon: BookmarkIcon },
  { view: 'tasks', label: 'Tasks', icon: ListChecks },
]

export function App(): React.JSX.Element | null {
  const state = useAppState()
  const [view, setView] = useState<View>('focus')
  useGaze(state?.session?.camera === true)
  useEffect(() => {
    window.__go = (next) => setView(next as View)
  }, [])

  if (!state) return null
  const recent = state.tasks.filter((t) => t.status !== 'done').slice(0, 6)

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">focussr</div>
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button key={v} className={`nav ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
            <Icon size={16} /> {label}
          </button>
        ))}
        {recent.length > 0 && <div className="side-label">Up next</div>}
        {recent.map((task) => (
          <button key={task.id} className="recent" onClick={() => setView('tasks')}>
            {task.title}
          </button>
        ))}
        <div className="spacer" />
        <button className={`nav ${view === 'connect' ? 'active' : ''}`} onClick={() => setView('connect')}>
          <Plug size={16} /> Connect an AI
        </button>
      </nav>
      {view === 'tasks' && <Tasks state={state} />}
      {view === 'connect' && <Connect state={state} />}
      {view === 'focus' && (state.session ? <Session session={state.session} state={state} /> : <Home state={state} />)}
    </div>
  )
}
