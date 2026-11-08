/** The only colour in the product. Each attached app always gets the same ribbon. */
const HUES = [
  '#FF6B5E', // coral
  '#FFB020', // amber
  '#F5E050', // lemon
  '#5EE08A', // mint
  '#3DD6D0', // teal
  '#5AA9FF', // sky
  '#8C7BFF', // iris
  '#D97BFF', // orchid
  '#FF7BC0', // rose
  '#B8E04A', // lime
] as const

export const NEUTRAL_HUE = '#FFFFFF'

export function hueForApp(appId: string | undefined): string {
  if (!appId) return NEUTRAL_HUE
  // FNV-1a keeps the colour stable between launches.
  let hash = 0x811c9dc5
  for (let i = 0; i < appId.length; i++) {
    hash ^= appId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return HUES[(hash >>> 0) % HUES.length]!
}
