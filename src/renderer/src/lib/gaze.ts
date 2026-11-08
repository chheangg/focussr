import { useEffect } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { api } from './api'

type Point = { x: number; y: number }

/** Maps raw eye positions onto 0..1 using the range this person's eyes have actually covered. */
class Range {
  private values: number[] = []
  map(value: number): number {
    this.values.push(value)
    if (this.values.length > 400) this.values.shift()
    const sorted = [...this.values].sort((a, b) => a - b)
    const low = sorted[Math.floor(sorted.length * 0.05)]!
    const high = sorted[Math.floor(sorted.length * 0.95)]!
    return high - low < 0.02 ? 0.5 : Math.min(1, Math.max(0, (value - low) / (high - low)))
  }
}

const ratio = (value: number, from: number, to: number): number => (value - from) / (to - from || 1)

/**
 * Estimates gaze from the webcam. Frames are analysed in memory and dropped.
 * Only three numbers per reading leave this function, and no video is ever written anywhere.
 */
export function useGaze(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let stream: MediaStream | undefined
    let timer: number | undefined
    let landmarker: FaceLandmarker | undefined

    void (async () => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      if (stopped) return stream.getTracks().forEach((t) => t.stop())
      video.srcObject = stream
      await video.play()
      const vision = await FilesetResolver.forVisionTasks('./wasm')
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      })
      const rangeX = new Range()
      const rangeY = new Range()
      timer = window.setInterval(() => {
        if (stopped || !landmarker || video.readyState < 2) return
        const face = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] as Point[] | undefined
        if (!face || face.length < 478) {
          void api.sendGaze({ eyesOnScreen: false })
          return
        }
        const eye = (iris: number, a: number, b: number, top: number, bottom: number) => ({
          x: ratio(face[iris]!.x, face[a]!.x, face[b]!.x),
          y: ratio(face[iris]!.y, face[top]!.y, face[bottom]!.y),
          open: Math.abs(face[bottom]!.y - face[top]!.y) / Math.abs(face[b]!.x - face[a]!.x || 1),
        })
        const left = eye(468, 33, 133, 159, 145)
        const right = eye(473, 362, 263, 386, 374)
        const x = (left.x + right.x) / 2
        const y = (left.y + right.y) / 2
        const open = (left.open + right.open) / 2 > 0.12
        const facing = x > 0.2 && x < 0.8
        void api.sendGaze({ eyesOnScreen: open && facing, gazeX: 1 - rangeX.map(x), gazeY: rangeY.map(y) })
      }, 200)
    })().catch((error) => console.error('Camera unavailable:', error))

    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      landmarker?.close()
    }
  }, [enabled])
}
