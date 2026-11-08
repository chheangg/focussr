// Builds the native sensor for this platform. Platforms without one fall back to the basic sensor.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

if (process.platform !== 'darwin') {
  console.log(`No native sensor for ${process.platform} yet. Using the basic sensor.`)
  mkdirSync('resources/bin', { recursive: true })
  process.exit(0)
}

mkdirSync('resources/bin', { recursive: true })
const output = 'resources/bin/focussr-sensor'
const build = (arch, out) =>
  execFileSync(
    'swiftc',
    ['-O', '-swift-version', '5', '-target', `${arch}-apple-macos13`, 'native/macos/sensor.swift', '-o', out],
    { stdio: 'inherit' },
  )

if (process.env.FOCUSSR_UNIVERSAL) {
  build('arm64', `${output}-arm64`)
  build('x86_64', `${output}-x64`)
  execFileSync('lipo', ['-create', `${output}-arm64`, `${output}-x64`, '-output', output], { stdio: 'inherit' })
} else {
  build(process.arch === 'arm64' ? 'arm64' : 'x86_64', output)
}
console.log('Built', output)
