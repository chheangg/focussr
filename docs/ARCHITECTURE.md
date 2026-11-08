# Architecture

```
 Your apps                  Focussr
┌───────────┐  scroll   ┌──────────────┐  samples  ┌─────────────────┐
│ Word, PDF │◄──────────│ Native sensor│──────────►│ Main process    │
│ browsers  │  windows  │ (per OS)     │ JSON lines│ session + store │
└───────────┘           └──────────────┘           └───────┬─────────┘
                                                           │ IPC
 Any AI ──MCP──► src/mcp ──local socket──► Main    ┌───────▼─────────┐
                                                   │ Window, bar,    │
                                                   │ overlay (React) │
                                                   └─────────────────┘
```

| Folder | What lives there | Rule |
| --- | --- | --- |
| `src/core` | Reading model, deadlines, heat, parsing | Pure TypeScript. No Electron, fully unit tested |
| `src/main` | Session controller, windows, storage, screenshots, tool bridge | The only code that touches the OS through Electron |
| `src/preload` | The bridge the interface may call | Allowlisted methods only |
| `src/renderer` | Main window, floating bar, overlay, camera | Talks to main through `window.focussr` |
| `src/mcp` | The MCP server | Holds no logic. Forwards to the app |
| `native/macos` | The macOS sensor, in Swift | Speaks the protocol below |
| `design` | The `.pen` source for the interface and README images | Open it with [Pen](https://pen.dev) |

## The sensor protocol

Each platform has one small program that prints JSON lines and reads commands from stdin. The rest of
the app doesn't know which operating system it's on.

**Porting Focussr to a new platform means implementing this and nothing else.**

| Direction | Message | Meaning |
| --- | --- | --- |
| out | `sample` | Four times a second: front app, and `scroll`, `surface`, `window`, `windowId` when attached |
| out | `permission` | Whether the OS has granted access |
| out | `hover`, `picked` | Box picking |
| in | `list` | Open apps. Answers `apps` |
| in | `attach`, `detach` | Follow a process, optionally one box |
| in | `pick`, `activate`, `prompt` | Pick a box, bring an app forward, ask for permission |
| in | `find`, `read` | Find text and scroll to it, read the front window. Answers `result` |

Requests with an `id` get a reply with the same `id`. `src/main/sensor.ts` has the TypeScript side and
a `BasicSensor` fallback for platforms that don't have a native sensor yet.

## Where data goes

Everything stays in the app's data folder.

| Data | File | Removed when |
| --- | --- | --- |
| Tasks and progress | `tasks.json` | You delete the task |
| Content screenshots, only with video on | `captures/<task>/` | You delete the task |
| Camera video | Nowhere. Frames are analysed in memory and dropped | Immediately |

The app makes no network requests of its own. The optional local-model call is restricted to loopback
in `src/main/llm.ts`.
