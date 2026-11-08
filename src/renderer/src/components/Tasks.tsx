import { useState } from 'react'
import { Check, Flame, Play, Plus, Trash2, X } from 'lucide-react'
import { deadlineStatus, parseDue } from '@core/deadline'
import type { AppState, FocusTask, TaskStatus } from '@core/types'
import { api } from '../lib/api'
import { HeatMap } from './HeatMap'

const GROUPS: { status: TaskStatus; name: string }[] = [
  { status: 'doing', name: 'Doing' },
  { status: 'todo', name: 'To do' },
  { status: 'done', name: 'Done' },
]

function DueCell({ task }: { task: FocusTask }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const status = deadlineStatus(task.status === 'done' ? undefined : task.due)
  if (!editing) {
    return (
      <button className={`cell-due due ${status.level}`} onClick={() => setEditing(true)}>
        {status.level === 'none' ? 'Add date' : status.label}
      </button>
    )
  }
  const commit = (value: string): void => {
    setEditing(false)
    if (!value.trim()) void api.updateTask(task.id, { due: '' })
    else {
      const due = parseDue(value)
      if (due) void api.updateTask(task.id, { due })
    }
  }
  return (
    <input
      autoFocus
      className="cell-input"
      placeholder="fri 5pm"
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

function Row({ task, onHeat }: { task: FocusTask; onHeat: () => void }): React.JSX.Element {
  const done = task.status === 'done'
  return (
    <div
      className="row"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const id = e.dataTransfer.getData('text/plain')
        if (id !== task.id) void api.moveTask(id, task.id, task.status)
      }}
    >
      <button className={`check ${done ? 'on' : ''}`} onClick={() => void api.updateTask(task.id, { status: done ? 'todo' : 'done' })} aria-label={done ? 'Mark not done' : 'Mark done'}>
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <input
        className={`row-title ${done ? 'done' : ''}`}
        defaultValue={task.title}
        onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && void api.updateTask(task.id, { title: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="cell-app">{task.target?.box?.label ?? task.target?.host ?? task.target?.appName ?? '—'}</span>
      <span className="cell-progress">{task.progress > 0 ? `${Math.round(task.progress * 100)}%` : '—'}</span>
      <DueCell task={task} />
      <span className="row-actions">
        <button onClick={onHeat} title="Heat map" aria-label="Heat map">
          <Flame size={14} />
        </button>
        {!done && (
          <button onClick={() => void api.startTask(task.id, null, false)} title="Start" aria-label="Start">
            <Play size={14} />
          </button>
        )}
        <button onClick={() => void api.deleteTask(task.id)} title="Delete" aria-label="Delete">
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}

function NewRow({ status }: { status: TaskStatus }): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  if (!adding) {
    return (
      <button className="new-row" onClick={() => setAdding(true)}>
        <Plus size={14} /> New
      </button>
    )
  }
  const commit = (value: string): void => {
    if (value.trim()) void api.addTask(value, status)
  }
  return (
    <input
      autoFocus
      className="new-input"
      placeholder="Name it, and add a date if there is one"
      onBlur={(e) => {
        commit(e.target.value)
        setAdding(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value)
          e.currentTarget.value = ''
        }
        if (e.key === 'Escape') setAdding(false)
      }}
    />
  )
}

export function Tasks({ state }: { state: AppState }): React.JSX.Element {
  const [heatId, setHeatId] = useState<string | null>(null)
  const heatTask = state.tasks.find((t) => t.id === heatId)

  if (heatTask) {
    return (
      <main className="tasks review">
        <div className="heat-title">
          <h1>{heatTask.title}</h1>
          <button className="ghost" onClick={() => setHeatId(null)}>
            <X size={14} /> Close
          </button>
        </div>
        <div className="page-view">
          <HeatMap taskId={heatTask.id} live={false} />
        </div>
      </main>
    )
  }

  return (
    <main className="tasks">
      <h1>Tasks</h1>
      <div className="row head">
        <span className="check-space" />
        <span className="row-title">Name</span>
        <span className="cell-app">Attached to</span>
        <span className="cell-progress">Progress</span>
        <span className="cell-due">Deadline</span>
        <span className="row-actions" />
      </div>
      {GROUPS.map(({ status, name }) => {
        const items = state.tasks.filter((t) => t.status === status)
        return (
          <section
            key={status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void api.moveTask(e.dataTransfer.getData('text/plain'), null, status)}
          >
            <div className="group">
              {name} <span>{items.length}</span>
            </div>
            {items.map((task) => (
              <Row key={task.id} task={task} onHeat={() => setHeatId(task.id)} />
            ))}
            <NewRow status={status} />
          </section>
        )
      })}
    </main>
  )
}
