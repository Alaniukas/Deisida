import type { WallCorners } from './homography'

function quadBounds(corners: WallCorners) {
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  }
}

/** Iš nuotraukos matuoja plytų eilių periodą (px / eilė) — atsarginis mastelis. */
export function measureBrickCoursesFromImage(
  image: HTMLImageElement,
  region: WallCorners,
): { visibleCourses: number; pixelsPerCourse: number } | null {
  const w = image.naturalWidth
  const h = image.naturalHeight
  const { x0, x1, y0, y1 } = quadBounds(region)
  const px0 = Math.floor(x0 * w)
  const px1 = Math.ceil(x1 * w)
  const py0 = Math.floor(y0 * h)
  const py1 = Math.ceil(y1 * h)
  const rw = Math.max(8, px1 - px0)
  const rh = Math.max(24, py1 - py0)
  if (rw < 8 || rh < 24) return null

  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(image, px0, py0, rw, rh, 0, 0, rw, rh)
  const { data } = ctx.getImageData(0, 0, rw, rh)

  const profile = new Float32Array(rh)
  for (let y = 0; y < rh; y++) {
    let sum = 0
    const cx0 = Math.floor(rw * 0.2)
    const cx1 = Math.ceil(rw * 0.8)
    for (let x = cx0; x < cx1; x++) {
      const i = (y * rw + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      sum += lum
    }
    profile[y] = sum / Math.max(1, cx1 - cx0)
  }

  const mean = profile.reduce((a, b) => a + b, 0) / profile.length
  for (let i = 0; i < profile.length; i++) profile[i] -= mean

  const minLag = 5
  const maxLag = Math.min(48, Math.floor(rh / 4))
  let bestLag = 12
  let bestScore = -Infinity

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    let n = 0
    for (let i = 0; i + lag < profile.length; i++) {
      score += profile[i] * profile[i + lag]
      n++
    }
    if (n > 0 && score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  if (bestScore < 1) return null

  const visibleCourses = Math.max(8, Math.round(rh / bestLag))
  return { visibleCourses, pixelsPerCourse: bestLag }
}
