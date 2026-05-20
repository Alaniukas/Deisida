import type { FacadeAnalysis } from './facadeAnalysis'
import type { NoEditZone } from './noEditZones'
import type { WallCorners } from './homography'

export const FACADE_CORNERS_JSON_PROMPT = `You are analyzing a building photo for brick-cladding visualization.

Return JSON only:
{
  "corners":[{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number}],
  "estimatedFloors": number,
  "hasExistingBrick": boolean,
  "visibleBrickCourses": number | null,
  "brickStrip": {"corners":[...]} | null,
  "isAngledView": boolean,
  "noEditZones": [
    {"label":"stairwell_glass","corners":[{"x":number,"y":number},...]},
    {"label":"window","corners":[...]}
  ]
}

=== corners ===
Full front elevation. Order: top_left, top_right, bottom_right, bottom_left.
x=0 left, x=1 right; y=0 top, y=1 bottom.

=== isAngledView ===
true if the building is photographed at an angle (perspective, not straight frontal).

=== noEditZones (CRITICAL — GLASS ONLY) ===
Mark ONLY glass / openings — tight boxes. NEVER mark entire balcony bays or wall fields.
• Each WINDOW: glass + frame only (small box per window)
• STAIRWELL: full vertical column of stairwell windows / glass blocks — label "stairwell_glass" (wide enough to cover the whole central strip)
• Balcony GLASS railings only — label "balcony_glass" (NOT the concrete wall under the balcony)
• Do NOT mark: balcony side walls, spandrel panels, plain facade between windows — those MUST receive brick

=== APPLY BRICK (do not put in noEditZones) ===
• All plain facade plaster/concrete between windows
• Balcony side walls and panels under balcony slabs (concrete parts)
• Recessed facade sections on the sides

=== brickStrip / brick courses ===
If mixed facade, brickStrip = existing brick cladding only.
Count visible brick courses if brick is present.

Exclude sky, ground, cars, neighbors, map UI from corners.`

export function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

function parseCornerSet(
  raw: { x: number; y: number }[] | undefined,
): WallCorners | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null
  try {
    return raw.map((p) => {
      const x = Number(p.x)
      const y = Number(p.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('bad')
      }
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      }
    }) as WallCorners
  } catch {
    return null
  }
}

function parseNoEditZones(raw: unknown): NoEditZone[] {
  if (!Array.isArray(raw)) return []
  const zones: NoEditZone[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as { label?: string; corners?: { x: number; y: number }[] }
    const corners = parseCornerSet(o.corners)
    if (!corners) continue
    zones.push({
      label: typeof o.label === 'string' ? o.label : 'protected',
      corners,
    })
    if (zones.length >= 12) break
  }
  return zones
}

export function parseFacadeAnalysisJson(text: string): FacadeAnalysis {
  const parsed = JSON.parse(extractJsonText(text)) as {
    corners?: { x: number; y: number }[]
    estimatedFloors?: number
    hasExistingBrick?: boolean
    visibleBrickCourses?: number | null
    brickStrip?: { corners?: { x: number; y: number }[] }
    isAngledView?: boolean
    noEditZones?: unknown
  }

  const corners = parseCornerSet(parsed.corners)
  if (!corners) {
    throw new Error('Neteisingas AI atsakymas: reikia 4 kampų')
  }

  const floors = Number(parsed.estimatedFloors)
  const estimatedFloors =
    Number.isFinite(floors) && floors >= 1 && floors <= 40
      ? Math.round(floors)
      : 4

  let visibleBrickCourses: number | null = null
  if (parsed.visibleBrickCourses != null) {
    const n = Number(parsed.visibleBrickCourses)
    if (Number.isFinite(n) && n >= 4 && n <= 400) {
      visibleBrickCourses = Math.round(n)
    }
  }

  const brickStrip = parseCornerSet(parsed.brickStrip?.corners)
  const noEditZones = parseNoEditZones(parsed.noEditZones)

  return {
    corners,
    estimatedFloors,
    hasExistingBrick: Boolean(parsed.hasExistingBrick),
    visibleBrickCourses,
    brickStrip,
    isAngledView: Boolean(parsed.isAngledView),
    noEditZones,
  }
}

/** @deprecated */
export function parseCornersJson(text: string): WallCorners {
  return parseFacadeAnalysisJson(text).corners
}
