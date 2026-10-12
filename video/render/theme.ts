/** Colours, fonts and layout for the 1080×1920 vertical video. Mirrors the web app's palette. */

export const W = 1080
export const H = 1920

/** Same pastel region colours as src/components/Cell.vue so the channel matches the game. */
export const REGION_COLORS = [
  '#ffd6d6', '#ffe8c4', '#fff5c0', '#cff5ce', '#c8e6ff', '#ddd0ff',
  '#ffd0f7', '#c8fff2', '#e0ffc8', '#ffc8d8', '#c8d0ff', '#f5e8c0',
]

export const COLORS = {
  bgTop: '#141432',
  bgBottom: '#07070f',
  boardFrame: '#0d0d1c',
  regionBorder: '#1a1a2e',
  gridLine: 'rgba(26, 26, 46, 0.18)',
  text: '#f4f4ff',
  muted: '#9a9ac4',
  gold: '#f7c948',
  goldDeep: '#f39c12',
  red: '#ff4d5e',
  dot: 'rgba(26, 26, 46, 0.42)',
  cursor: 'rgba(255, 255, 255, 0.16)',
  accent: '#4aa3df',
}

/** Heavy rounded-ish system face (macOS ships Avenir Next); falls back to any sans. */
export const FONT_FAMILY = '"Avenir Next", "Helvetica Neue", Arial, sans-serif'
export const font = (weight: number, px: number) => `${weight} ${px}px ${FONT_FAMILY}`

/** Board placement. Kept clear of the Shorts UI (top bar, right-hand buttons, bottom caption). */
export const BOARD = { x: 90, y: 468, size: 900 }

/** Everything important stays above y≈1560 — below that the Shorts caption overlays the video. */
export const LAYOUT = {
  hook1Y: 196,
  hook2Y: 292,
  subY: 368,
  rulesY: 418,
  slotsY: 1428,
  countersY: 1516,
}
