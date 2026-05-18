/** Normalizuota nuotraukos koordinatė: (0,0) viršuje kairėje, (1,1) apačioje dešinėje. */
export type NormPoint = { x: number; y: number }

/** Kampai: viršus kairė, viršus dešinė, apačia dešinė, apačia kairė. */
export type WallCorners = [NormPoint, NormPoint, NormPoint, NormPoint]

function swapRows(M: number[][], a: number, b: number) {
  const t = M[a]
  M[a] = M[b]
  M[b] = t
}

function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    if (pivot !== col) swapRows(M, pivot, col)

    const div = M[col][col]
    for (let c = col; c <= n; c++) M[col][c] /= div

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col]
      if (Math.abs(f) < 1e-15) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }

  return M.map((row) => row[n])
}

export function homographyUnitSquareToImage(
  corners: WallCorners,
): Float32Array | null {
  const src: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [su, sv] = src[i]
    const Xi = corners[i].x
    const Yi = corners[i].y
    A.push([su, sv, 1, 0, 0, 0, -su * Xi, -sv * Xi])
    b.push(Xi)
    A.push([0, 0, 0, su, sv, 1, -su * Yi, -sv * Yi])
    b.push(Yi)
  }
  const h = solveLinear8(A, b)
  if (!h) return null
  return new Float32Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1])
}

export function invert3RowMajor(m: Float32Array): Float32Array | null {
  const a = m[0],
    b = m[1],
    c = m[2],
    d = m[3],
    e = m[4],
    f = m[5],
    g = m[6],
    h = m[7],
    i = m[8]
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-14) return null
  const id = 1 / det
  return new Float32Array([
    (e * i - f * h) * id,
    (c * h - b * i) * id,
    (b * f - c * e) * id,
    (f * g - d * i) * id,
    (a * i - c * g) * id,
    (c * d - a * f) * id,
    (d * h - e * g) * id,
    (b * g - a * h) * id,
    (a * e - b * d) * id,
  ])
}

export function rowMajorToGlColumnMajor3(m: Float32Array): Float32Array {
  return new Float32Array([
    m[0],
    m[3],
    m[6],
    m[1],
    m[4],
    m[7],
    m[2],
    m[5],
    m[8],
  ])
}

export function clampCorners(corners: WallCorners): WallCorners {
  return corners.map((p) => ({
    x: Math.max(0.01, Math.min(0.99, p.x)),
    y: Math.max(0.01, Math.min(0.99, p.y)),
  })) as WallCorners
}

/** Išplėsti keturkampį nuo centro — saugumo marža. */
export function expandWallCorners(
  corners: WallCorners,
  margin = 0.05,
): WallCorners {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  return corners.map((p) => ({
    x: cx + (p.x - cx) * (1 + margin),
    y: cy + (p.y - cy) * (1 + margin),
  })) as WallCorners
}

/**
 * DI kartais grąžina tik vieną sienos „juostą“ — išlyginame iki viso fasado.
 */
export function ensureMinimumFacadeCoverage(corners: WallCorners): WallCorners {
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  let [tl, tr, br, bl] = corners

  const minWidth = 0.52
  const w = maxX - minX
  if (w < minWidth) {
    const cx = (minX + maxX) / 2
    const scale = minWidth / Math.max(w, 0.08)
    const stretchX = (p: NormPoint): NormPoint => ({
      x: cx + (p.x - cx) * scale,
      y: p.y,
    })
    tl = stretchX(tl)
    tr = stretchX(tr)
    br = stretchX(br)
    bl = stretchX(bl)
  }

  const minHeight = 0.58
  const h = maxY - minY
  if (h < minHeight) {
    const cy = (minY + maxY) / 2
    const scale = minHeight / Math.max(h, 0.08)
    const stretchY = (p: NormPoint): NormPoint => ({
      x: p.x,
      y: cy + (p.y - cy) * scale,
    })
    tl = stretchY(tl)
    tr = stretchY(tr)
    br = stretchY(br)
    bl = stretchY(bl)
  }

  const topY = Math.min(tl.y, tr.y)
  if (topY > 0.14) {
    const lift = (topY - 0.08) * 0.75
    tl = { ...tl, y: tl.y - lift }
    tr = { ...tr, y: tr.y - lift }
  }

  const bottomY = Math.max(bl.y, br.y)
  if (bottomY < 0.8) {
    const drop = (0.86 - bottomY) * 0.55
    bl = { ...bl, y: bl.y + drop }
    br = { ...br, y: br.y + drop }
  }

  return clampCorners([tl, tr, br, bl])
}

export function normalizeFacadeCorners(corners: WallCorners): WallCorners {
  return ensureMinimumFacadeCoverage(
    expandWallCorners(clampCorners(corners), 0.04),
  )
}
