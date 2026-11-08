import * as chrono from 'chrono-node'

export type DeadlineLevel = 'none' | 'ok' | 'soon' | 'late'

export interface DeadlineStatus {
  level: DeadlineLevel
  label: string
}

const DAY = 86_400_000
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Reads "fri 5pm" or "next tuesday". Returns an ISO date or undefined. */
export function parseDue(text: string, now = new Date()): string | undefined {
  return chrono.parseDate(text, now, { forwardDate: true })?.toISOString()
}

/**
 * How a deadline looks right now. `secondsRemaining` is the reading forecast, so work that won't
 * fit before the deadline warns early, not just when the date gets close.
 */
export function deadlineStatus(due: string | undefined, now = new Date(), secondsRemaining?: number | null): DeadlineStatus {
  if (!due) return { level: 'none', label: '—' }
  const date = new Date(due)
  const until = date.getTime() - now.getTime()
  if (until < 0) {
    const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
    return { level: 'late', label: days <= 0 ? 'Late today' : `${days}d late` }
  }
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY)
  const label =
    days === 0
      ? `Today ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : days === 1
        ? 'Tomorrow'
        : days < 7
          ? date.toLocaleDateString(undefined, { weekday: 'short' })
          : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const tight = secondsRemaining != null && secondsRemaining * 1000 > until
  return { level: tight || until < DAY ? 'soon' : 'ok', label }
}
