import { createRoot } from 'react-dom/client'
import { Crosshair, Flame, Square, Video, VideoOff } from 'lucide-react'
import '@fontsource-variable/geist'
import './styles.css'
import { formatDuration } from '@core/intent'
import { hueForApp } from '@core/ribbon'
import { Ribbon } from './components/Ribbon'
import { stateLine } from './components/Session'
import { api, useAppState } from './lib/api'

/**
 * The session lives here, on top of whatever is being read, like a call bar.
 * Nothing on the page is highlighted unless these buttons ask for it.
 */
function Bar(): React.JSX.Element | null {
  const session = useAppState()?.session
  if (!session) return null
  const { reading } = session
  return (
    <div className="bar">
      <button className="bar-ribbon" onClick={() => void api.openMain()} title="Open Focussr" aria-label="Open Focussr">
        <Ribbon size={30} hue={hueForApp(session.target?.appId)} level={reading.done ? 1 : reading.progress} state={reading.done ? 'done' : reading.state} />
      </button>
      <span className="bar-text">
        <b>{session.title}</b>
        <small>{stateLine(session)}</small>
      </span>
      <span className="bar-percent">{reading.measurable ? `${Math.round(reading.progress * 100)}%` : formatDuration(reading.readingSeconds)}</span>
      <i className="bar-divider" />
      <button className={`bar-tool ${session.showWhere ? 'on' : ''}`} onClick={() => void api.toggleWhere()} title="Show where I'm attached" aria-label="Show where I'm attached">
        <Crosshair size={17} />
      </button>
      <button
        className={`bar-tool ${session.showHeat ? 'on' : ''}`}
        onClick={() => void api.toggleHeat()}
        disabled={!session.camera}
        title={session.camera ? 'Show the heat map on the page' : 'Turn on video for a heat map'}
        aria-label="Show the heat map on the page"
      >
        <Flame size={17} />
      </button>
      <button className={`bar-tool ${session.camera ? 'on' : ''}`} onClick={() => void api.setCamera(!session.camera)} title={session.camera ? 'Turn video off' : 'Turn video on'} aria-label="Toggle video">
        {session.camera ? <Video size={17} /> : <VideoOff size={17} />}
      </button>
      <button className="bar-tool" onClick={() => void api.endSession()} title="End session" aria-label="End session">
        <Square size={15} />
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Bar />)
