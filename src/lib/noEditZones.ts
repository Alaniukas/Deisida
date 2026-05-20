import type { WallCorners } from './homography'

export interface NoEditZone {
  label: string
  corners: WallCorners
}

export type NormBBox = { x0: number; y0: number; x1: number; y1: number }

const MAX_ZONES = 8

export function cornersToBBox(corners: WallCorners): NormBBox {
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  }
}

/** WebGL: iki 8 dėžučių (x0,y0,x1,y1), y nuo viršaus. */
export function packExcludeBoxes(
  zones: NoEditZone[],
): { count: number; boxes: Float32Array } {
  const boxes = new Float32Array(MAX_ZONES * 4)
  const n = Math.min(zones.length, MAX_ZONES)
  for (let i = 0; i < n; i++) {
    const b = cornersToBBox(zones[i].corners)
    const pad = 0.008
    boxes[i * 4] = Math.max(0, b.x0 - pad)
    boxes[i * 4 + 1] = Math.max(0, b.y0 - pad)
    boxes[i * 4 + 2] = Math.min(1, b.x1 + pad)
    boxes[i * 4 + 3] = Math.min(1, b.y1 + pad)
  }
  return { count: n, boxes }
}

export function formatZonesForPrompt(zones: NoEditZone[]): string {
  if (zones.length === 0) return ''
  return zones
    .map((z) => z.label)
    .filter(Boolean)
    .join(', ')
}
