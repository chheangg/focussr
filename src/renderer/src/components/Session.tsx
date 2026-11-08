import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { deadlineStatus } from '@core/deadline'
import { formatDuration } from '@core/intent'
import { hueForApp } from '@core/ribbon'
import type { AppState, SessionView } from '@core/types'
import { api } from '../lib/api'
import { HeatMap } from './HeatMap'
import { Ribbon } from './Ribbon'

export function stateLine(session: SessionView): string {
  const { reading, drifted } = session
  if (reading.done) return 'Done'
  if (drifted) return 'This looks off task'
  const word = { reading: 'Reading', skimming: 'Skimming, not counted', idle: 'Idle', away: 'Away' }[reading.state]
  return reading.secondsRemaining ? `${word} · about ${formatDuration(reading.secondsRemaining)} left` : word
}

/** Reading happens in the attached app. This is the review of it, with the page full size. */
export function Session({ session, state }: { session: SessionView; state: AppState }): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const { reading } = session
  const task = state.tasks.find((t) => t.id === session.taskId)
  const deadline = deadlineStatus(task?.due, new Date(), reading.secondsRemaining)
  const target = session.target
  const percent = reading.measurable ? `${Math.round(reading.progress * 100)}%` : formatDuration(reading.readingSeconds)

  const ask = (): void => {
    if (!question.trim()) return
    void api.ask(question)
    setQuestion('')
  }

  return (
    <main className="session">
      <header>
        <strong>{session.title}</strong>
        <span className="where">{target ? (target.box ? `${target.box.label} · ${target.appName}` : (target.host ?? target.windowTitle ?? target.appName)) : 'No app attached'}</span>
        {deadline.level !== 'none' && <span className={`due ${deadline.level}`}>{deadline.label}</span>}
        {session.camera && (
          <span className="live">
            {stateLine(session)} <b>{percent}</b>
          </span>
        )}
        <button className="ghost" onClick={() => void api.endSession()}>
          End session
        </button>
      </header>

      {session.camera ? (
        <div className="page-view">
          <HeatMap taskId={session.taskId} live />
        </div>
      ) : (
        <div className="waiting">
          <Ribbon size={112} hue={hueForApp(target?.appId)} level={reading.done ? 1 : reading.progress} state={reading.done ? 'done' : reading.state} />
          <div className="percent-big">{percent}</div>
          <div className="state-line">{stateLine(session)}</div>
          <p className="note">{target ? `Keep reading in ${target.appName}. The bar stays with it.` : 'Keep reading. The bar stays on top.'}</p>
          <button className="ghost" onClick={() => void api.setCamera(true)}>
            Turn on video for a heat map
          </button>
        </div>
      )}

      {session.reply && <div className="reply">{session.reply}</div>}
      <div className="ask">
        <input value={question} placeholder="Ask how it's going" onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <button className="send small" onClick={ask} aria-label="Ask">
          <ArrowUp size={16} />
        </button>
      </div>
    </main>
  )
}
