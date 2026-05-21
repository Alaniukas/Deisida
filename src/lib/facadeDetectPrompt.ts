import type { FacadeAnalysis } from './facadeAnalysis'
import type { NoEditZone } from './noEditZones'
import type { WallCorners } from './homography'

export const FACADE_CORNERS_JSON_PROMPT = `You are analyzing a building photo for brick-clinker cladding visualization.

Return JSON only:
{
  "corners":[{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number}],
  "estimatedFloors": number,
  "hasExistingBrick": boolean,
  "visibleBrickCourses": number | null,
  "brickStrip": {"corners":[...]} | null,
  "isAngledView": boolean,
  "noEditZones": [
    {"label":"glass_facade","corners":[...]},
    {"label":"metal_siding","corners":[...]},
    {"label":"window","corners":[...]}
  ]
}

=== corners ===
Bounding box of the ENTIRE visible building (all materials). Order: top_left, top_right, bottom_right, bottom_left.
x=0 left, x=1 right; y=0 top, y=1 bottom.

=== brickStrip (CRITICAL — WHERE BRICK MAY BE APPLIED) ===
Required when the facade has MORE than one material (mixed facade).
Quad around ONLY surfaces where clinker/brick/tile cladding is realistic:
• Existing brick or clinker (solid or perforated)
• Plaster, concrete, or render panels meant as wall cladding
• NOT glass curtain walls, NOT window glass, NOT metal/corrugated siding, NOT plastic panels

Examples:
• Grey brick wall + perforated brick strip + glass on the right → brickStrip covers brick+perforated only (left/middle), stops before glass.
• Blue corrugated metal + beige brick + glass → brickStrip = beige brick column ONLY (not blue metal, not glass).

If the whole visible wall is one uniform cladding substrate, brickStrip may equal corners.
If only recoloring existing brick, brickStrip = that brick area exactly.

=== noEditZones (DO NOT APPLY BRICK) ===
Tight quads. Label clearly:
• glass_facade / curtain_wall — entire glass grid (stairwell, offices)
• metal_siding — corrugated or flat metal panels
• window — individual window glass + frame
• stairwell_glass — vertical glass with stairs visible inside
• balcony_glass — railing glass only (NOT concrete under slab)

Never mark brick, clinker, plaster, or concrete cladding fields as noEdit.

=== hasExistingBrick / visibleBrickCourses ===
true if real brick/clinker is already visible. Count horizontal mortar courses in brickStrip.

=== isAngledView ===
true if photographed at an angle (perspective, not straight frontal).

Exclude sky, ground, cars, neighbors, interior windowsill/laptop/blinds from corners.`

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
