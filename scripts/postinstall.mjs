// Downloads Electron and the eye-tracking files. GitHub's download server sometimes times out,
// so a failed download is retried rather than failing the whole install.
import { spawnSync } from 'node:child_process'

const ATTEMPTS = 8
const pause = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)

for (let attempt = 1; ; attempt++) {
  const { status } = spawnSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' })
  if (status === 0) break
  if (attempt === ATTEMPTS) process.exit(status ?? 1)
  console.log(`Electron download failed. Retrying (${attempt}/${ATTEMPTS})...`)
  pause(attempt * 15)
}

await import('./setup-vision.mjs')
