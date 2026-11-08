import { contextBridge, ipcRenderer } from 'electron'

const call =
  (method: string) =>
  (...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke('focussr', method, ...args)

// The list is repeated here because a sandboxed preload cannot import shared modules.
const methods = [
  'getState', 'submit', 'pickBox', 'addTask', 'updateTask', 'moveTask', 'deleteTask', 'startTask', 'endSession',
  'ask', 'sendGaze', 'setCamera', 'setMcpEnabled', 'requestPermission', 'openMain', 'toggleWhere', 'toggleHeat',
  'getHeatmap',
]

const listen = (channel: string) => (listener: (value: unknown) => void) => {
  const handler = (_: unknown, value: unknown): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('focussr', {
  ...Object.fromEntries(methods.map((m) => [m, call(m)])),
  onState: listen('state'),
  onOverlay: listen('overlay'),
})
