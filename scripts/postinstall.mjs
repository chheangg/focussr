// Downloads Electron and the eye-tracking files.
//
// Electron's release downloads sometimes go down for long stretches, so after a couple of tries this
// falls back to a mirror. That is safe because the electron npm package pins a SHA-256 for every
// file and the download is rejected if it doesn't match.
import { spawnSync } from 'node:child_process'

const OFFICIAL_TRIES = 2
const MIRROR_TRIES = 4
const mirror = { ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/', ELECTRON_CUSTOM_DIR: '{{ version }}' }
const pause = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)
const install = (env) =>
  spawnSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit', env: { ...process.env, ...env } }).status === 0

function download() {
  for (let attempt = 1; attempt <= OFFICIAL_TRIES; attempt++) {
    if (install({})) return true
    console.log(`Electron download failed (${attempt}/${OFFICIAL_TRIES}).`)
    if (attempt < OFFICIAL_TRIES) pause(10)
  }
  console.log('Trying the mirror. The file is checked against the checksum pinned by the electron package.')
  for (let attempt = 1; attempt <= MIRROR_TRIES; attempt++) {
    if (install(mirror)) return true
    if (attempt < MIRROR_TRIES) pause(attempt * 15)
  }
  return false
}

if (!download()) process.exit(1)
await import('./setup-vision.mjs')
