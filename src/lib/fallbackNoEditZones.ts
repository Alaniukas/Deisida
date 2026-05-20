import type { FacadeAnalysis } from './facadeAnalysis'
import type { NoEditZone } from './noEditZones'
import { cornersToBBox } from './noEditZones'
import type { WallCorners } from './homography'

function quadWidthFrac(corners: WallCorners): number {
  const xs = corners.map((c) => c.x)
  return Math.max(...xs) - Math.min(...xs)
}

/** Centrinė stiklinė laiptinė (horizontalių langų juosta). */
function estimateCentralStairwell(corners: WallCorners): NoEditZone {
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = maxX - minX
  const cx = (minX + maxX) / 2
  const half = Math.max(w * 0.11, 0.04)
  return {
    label: 'stairwell_glass',
    corners: [
      { x: cx - half, y: minY },
      { x: cx + half, y: minY },
      { x: cx + half, y: maxY },
      { x: cx - half, y: maxY },
    ],
  }
}

function zonesOverlap(a: NoEditZone, b: NoEditZone): boolean {
  const ba = cornersToBBox(a.corners)
  const bb = cornersToBBox(b.corners)
  return !(
    ba.x1 < bb.x0 ||
    bb.x1 < ba.x0 ||
    ba.y1 < bb.y0 ||
    bb.y1 < ba.y0
  )
}

/** Pašalina per plačias „balkono“ zonas — liko tik sienos plytoms. */
export function sanitizeNoEditZones(
  zones: NoEditZone[],
  facadeCorners: WallCorners,
): NoEditZone[] {
  const fw = Math.max(0.2, quadWidthFrac(facadeCorners))
  return zones.filter((z) => {
    const w = quadWidthFrac(z.corners)
    const lab = z.label.toLowerCase()
    if (
      lab.includes('balcony') &&
      !lab.includes('glass') &&
      !lab.includes('railing') &&
      !lab.includes('glaz')
    ) {
      if (w > fw * 0.16) return false
    }
    if (lab.includes('window') || lab === 'protected') {
      if (w > fw * 0.26) return false
    }
    return true
  })
}

/** Visada įtraukia / papildo laiptinę; filtruoja per dideles zonas. */
export function augmentNoEditZones(analysis: FacadeAnalysis): NoEditZone[] {
  let zones = sanitizeNoEditZones(analysis.noEditZones, analysis.corners)

  const stair = estimateCentralStairwell(analysis.corners)
  const hasStair = zones.some((z) =>
    z.label.toLowerCase().includes('stair'),
  )
  if (!hasStair) {
    zones.push(stair)
  } else {
    const idx = zones.findIndex((z) =>
      z.label.toLowerCase().includes('stair'),
    )
    if (idx >= 0) {
      const existing = cornersToBBox(zones[idx].corners)
      const wider = cornersToBBox(stair.corners)
      if (wider.x1 - wider.x0 > existing.x1 - existing.x0) {
        zones[idx] = stair
      }
    }
  }

  const deduped: NoEditZone[] = []
  for (const z of zones) {
    if (deduped.some((d) => zonesOverlap(d, z) && d.label === z.label)) {
      continue
    }
    deduped.push(z)
    if (deduped.length >= 10) break
  }
  return deduped
}
