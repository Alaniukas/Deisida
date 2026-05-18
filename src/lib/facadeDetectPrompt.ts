import type { WallCorners } from './homography'

export const FACADE_CORNERS_JSON_PROMPT = `You are marking the FULL FRONT ELEVATION of the main building for a brick-cladding visualization.

Return JSON only:
{"corners":[{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number},{"x":number,"y":number}]}

Corner order:
1) top_left — where the building's front wall meets the sky (left side)
2) top_right — top-right of the same front wall
3) bottom_right — bottom-right of the wall (above ground/sidewalk)
4) bottom_left — bottom-left of the wall

Coordinates: x=0 left, x=1 right of image; y=0 top, y=1 bottom. Decimals 0..1.

CRITICAL — include the ENTIRE visible front of the building:
• Horizontal span: from the leftmost outer corner of the building to the rightmost outer corner.
  Include ALL wall sections: every window bay, stairwell strip, and wall between balconies.
  Do NOT return only one narrow column or a single window bay in the center.
• Vertical span: from the roof line / top floor down to the ground floor (above sidewalk).
  Include the top floor — do not stop halfway up the building.

Windows, balcony slabs, and doors lie INSIDE this area (we mask them later). Still include those regions in the quadrilateral.

Exclude only: sky above the roof, street/ground below the building, trees, cars, neighboring buildings, Google Maps UI.

For a typical frontal apartment photo, width is often 0.55–0.92 of image width and height 0.50–0.88 of image height.`

export function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

export function parseCornersJson(text: string): WallCorners {
  const parsed = JSON.parse(extractJsonText(text)) as {
    corners?: { x: number; y: number }[]
  }
  const c = parsed.corners
  if (!Array.isArray(c) || c.length !== 4) {
    throw new Error('Neteisingas AI atsakymas: reikia 4 kampų')
  }
  return c.map((p) => {
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Kampų koordinatės turi būti skaičiai')
    }
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    }
  }) as WallCorners
}
