# MVP plan

Focussr has one job: **tell you, honestly, how much of something you've actually read.**
Everything in the MVP serves that job. Anything that doesn't can wait.

You never read inside Focussr. It attaches to the app you're already using, the way a Zoom bar sits on
your screen during a call.

## The core loop

1. Say what you're doing, or click something that's already open.
2. A floating bar attaches to it. Focussr's own window gets out of the way.
3. Slow reading fills the ribbon. Fast scrolling doesn't.
4. Focussr tells you when you're done, and remembers where you stopped.

## What the MVP must do

| # | Capability | Done means |
| --- | --- | --- |
| 1 | Attach to any app | Pick an open app and start with one click or one Enter |
| 2 | Attach to websites | Follows a site by host. Leaving the site counts as away |
| 3 | Attach to one box | Pick one pane or section on screen |
| 4 | Count real reading | Sustained fast scrolling earns nothing |
| 5 | Say when it's done | Notification and a full ribbon at 95% |
| 6 | Remember progress | Reopening the same document, site or box continues it |
| 7 | Forecast | Time remaining at your own pace |
| 8 | Task list | Inline editing, status groups, drag to reorder |
| 9 | Deadlines | Plain-English dates, reminders, a warning when the work won't fit |
| 10 | Heat map | Attention painted over screenshots of the real content, and on the live page |
| 11 | Any AI can connect | MCP tools for tasks, finding files and apps, and going to the right place |
| 12 | Offline and private | Works with no network. Video is never saved |

## Decisions

**Not chat first.** A chat makes you talk before anything happens. One bar starts tracking on Enter,
and past work is one click away. Asking questions is optional.

**The session lives in the floating bar.** Progress, the heat map, video and ending the session are
all on it, on top of the document you're reading.

**Nothing is highlighted unless you ask.** The bar's buttons show where it's attached and paint the
heat map, and both turn back off.

**Black and white, with one exception.** Each attached app gets its own ribbon colour.

**A bookmark, not a mascot.** It's an object that sits on what you're reading and keeps your place.
It fills from the top as you read, so the logo is also the progress bar.

## How "read" is calculated

The document is split into 100 slices. Time is credited only to slices on screen, and only while the
state is *reading*. One screen needs 12 seconds of attention to count, so scrolling slowly through a
document is enough to finish it.

| State | When | Earns progress |
| --- | --- | --- |
| Reading | App in front, normal scrolling | Yes |
| Skimming | More than 0.6 screens per second, averaged over 2.5 seconds | No |
| Idle | No input for 90 seconds, unless the camera sees your eyes | No |
| Away | Another app or site in front, or the camera sees no eyes | No |

With video on, credit goes to where your eyes are, not the whole screen.

## Not in the MVP

- Full scroll tracking on Windows and Linux. The app runs there and tracks focused time.
- Quizzes or comprehension checks.
- Accounts, sync or anything that needs a server.
- A bundled language model. Connect one over MCP or run one locally.
- Signed and notarized macOS builds, which need an Apple Developer account.

## Known limits

- Gaze comes from an ordinary webcam, so treat it as an estimate of the region, not the word.
- Scroll position depends on what each app exposes to Accessibility. Apps that expose nothing fall
  back to tracking time.
- The heat map needs the Screen Recording permission on macOS.

## Next

1. Sign and notarize the macOS build.
2. Windows sensor using UI Automation.
3. Linux sensor using AT-SPI.
4. Reading-speed calibration per person.
