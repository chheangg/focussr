// Puts the eye-tracking runtime and model next to the app so the camera feature works offline.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const modelPath = 'src/renderer/public/models/face_landmarker.task'

mkdirSync('src/renderer/public/models', { recursive: true })
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'src/renderer/public/wasm', { recursive: true })

if (!existsSync(modelPath)) {
  const response = await fetch(MODEL_URL)
  if (!response.ok) throw new Error(`Could not download the face model: ${response.status}`)
  writeFileSync(modelPath, Buffer.from(await response.arrayBuffer()))
  console.log('Downloaded', modelPath)
}
