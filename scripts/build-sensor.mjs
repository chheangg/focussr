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
const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
execFileSync('swiftc', ['-O', '-swift-version', '5', '-target', `${arch}-apple-macos13`, 'native/macos/sensor.swift', '-o', output], {
  stdio: 'inherit',
})
console.log('Built', output)
