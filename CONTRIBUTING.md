# Contributing

Thanks for helping. Small fixes are as welcome as big features, and first-time contributors are too.

## Set up

```sh
git clone https://github.com/chheangg/focussr.git
cd focussr
npm install
npm run dev
```

You need Node 22 or newer. On macOS, install the Xcode command line tools with `xcode-select --install`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app with live reload |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Checks types |
| `npm run package` | Builds an installer for your platform |

## Where to start

- [Good first issues](https://github.com/chheangg/focussr/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are small and self-contained.
- **Porting to Windows or Linux** has the most impact. [The sensor protocol](docs/ARCHITECTURE.md#the-sensor-protocol) is all you need to implement.
- **App compatibility reports** help a lot. If an app's progress looks wrong, open an issue naming the app.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit, and [docs/MVP.md](docs/MVP.md) explains what the product is trying to be.

## Pull requests

1. Open an issue first for anything large, so nobody builds the wrong thing.
2. Keep each pull request to one change.
3. Add a test when you change anything in `src/core`.
4. Run `npm test` and `npm run typecheck`.
5. For interface changes, include a screenshot.

## Product principles

- **Your app is the reading surface.** Focussr attaches to it and never replaces it.
- **Dead simple.** One action to start. Say no to settings.
- **Black and white.** The ribbon is the only colour.
- **Honest numbers.** Never show progress that wasn't earned.
- **Offline and private.** No new network calls, ever, without discussion first.

## Design

The interface source is `design/focussr.pen`. It opens in [Pen](https://pen.dev).

## Be kind

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
