import { useEffect, useState } from 'react'
import type { AppState, FocussrApi, OverlayFrame } from '@core/types'

type Unsubscribe = () => void

declare global {
  interface Window {
    focussr: FocussrApi & {
      onState(listener: (state: AppState) => void): Unsubscribe
      onOverlay(listener: (frame: OverlayFrame | null) => void): Unsubscribe
    }
    __go?: (view: string) => void
  }
}

export const api = window.focussr

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    void api.getState().then(setState)
    return api.onState(setState)
  }, [])
  return state
}
