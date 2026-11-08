import { useState } from 'react'
import type { AppState } from '@core/types'
import { api } from '../lib/api'

const TOOLS = [
  ['Tasks', 'List tasks, add them with deadlines, start and end sessions, read progress.'],
  ['Find', 'Find files by name in your home folder and see which apps are open.'],
  ['Go there', 'Open a file or link, switch to an app, and scroll to the right text.'],
  ['Read', 'Read the visible text of the front window.'],
]

export function Connect({ state }: { state: AppState }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const { enabled, config } = state.mcp

  const copy = (): void => {
    void navigator.clipboard.writeText(config)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="tasks connect">
      <h1>Connect an AI</h1>
      <p className="lede">Works with any assistant that speaks MCP. It runs on this computer and is off until you turn it on.</p>

      <label className="switch-row">
        <span>
          <strong>Let connected AI tools use Focussr</strong>
          <small>They can do everything listed below while this is on.</small>
        </span>
        <button className={`switch ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} onClick={() => void api.setMcpEnabled(!enabled)}>
          <i />
        </button>
      </label>

      <dl className="tool-list">
        {TOOLS.map(([name, text]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>

      <div className="config">
        <div className="config-head">
          <span>Add this to your AI tool's MCP settings</span>
          <button className="ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre>{config}</pre>
      </div>
    </main>
  )
}
