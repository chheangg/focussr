import * as chrono from 'chrono-node'

export interface ParsedIntent {
  title: string
  appHint?: string
  host?: string
  due?: Date
}

const HOST = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/i

/** "Read chapter 4 in Preview by friday" becomes a title, an app and a due date. Fully offline. */
export function parseIntent(text: string, knownApps: string[] = [], now = new Date()): ParsedIntent {
  let title = text.trim()
  const result: ParsedIntent = { title }

  const host = HOST.exec(title)?.[1]
  if (host) result.host = host.toLowerCase().replace(/^www\./, '')

  const date = chrono.parse(title, now, { forwardDate: true })[0]
  if (date) {
    result.due = date.start.date()
    title = (title.slice(0, date.index) + title.slice(date.index + date.text.length)).replace(
      /\s+(by|due|before|on|until)\s*$/i,
      '',
    )
  }

  const byLength = [...knownApps].sort((a, b) => b.length - a.length)
  for (const app of byLength) {
    const escaped = app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`\\s+(?:in|on|with|using)\\s+${escaped}\\b`, 'i')
    if (pattern.test(title)) {
      result.appHint = app
      title = title.replace(pattern, '')
      break
    }
  }

  title = title.trim().replace(/[.,;:!?]+$/, '')
  result.title = title ? title[0]!.toUpperCase() + title.slice(1) : text.trim()
  return result
}

const DISTRACTIONS = ['youtube', 'netflix', 'reddit', 'tiktok', 'instagram', 'twitter', 'facebook', 'twitch']

/** True when the title is a known distraction that the task itself doesn't mention. */
export function looksOffTask(task: string, windowTitle: string): boolean {
  const title = windowTitle.toLowerCase()
  const lowerTask = task.toLowerCase()
  return DISTRACTIONS.some((d) => title.includes(d) && !lowerTask.includes(d))
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
