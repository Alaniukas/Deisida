import { fetchImageAsBase64 } from './fetchImageBase64'
import { fetchWithTimeout } from './fetchWithTimeout'

/** Pirmiausia geresnis redagavimui, po to greitesnis. */
const IMAGE_MODELS = (
  import.meta.env.VITE_GEMINI_IMAGE_MODEL as string | undefined
)
  ? [(import.meta.env.VITE_GEMINI_IMAGE_MODEL as string)]
  : ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image']

export interface GenerateFacadeInput {
  originalJpeg: string
  brickTextureUrl: string
  brickLabel: string
  /** Geometrinė plytų peržiūra — DI turi laikytis jos mastelio */
  compositeGuideJpeg: string
  brickLengthMm: number
  brickHeightMm: number
  jointMm: number
  facadeWidthM: number
  facadeHeightM: number
  bricksPerMeterU: number
  bricksPerMeterV: number
  estimatedFloors: number
  coursesPerFloor: number
  minVisibleCourses: number
  hasExistingBrick: boolean
  isAngledView: boolean
  noEditZoneSummary: string
  brickMaskJpeg: string
  signal?: AbortSignal
}

export interface GenerateFacadeResult {
  imageDataUrl: string
  model: string
}

function stripDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '')
}

function extractImageDataUrl(response: unknown): string | null {
  const candidates = (
    response as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
            inlineData?: { mimeType?: string; data?: string }
            inline_data?: { mime_type?: string; data?: string }
          }>
        }
        finishReason?: string
        finishMessage?: string
      }>
    }
  ).candidates

  const c0 = candidates?.[0]
  if (c0?.finishReason === 'SAFETY' || c0?.finishReason === 'BLOCKLIST') {
    throw new Error(
      c0.finishMessage || 'DI atsisakė (saugumo filtras).',
    )
  }

  for (const part of c0?.content?.parts ?? []) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) {
      const mime =
        ('mimeType' in inline && inline.mimeType) ||
        ('mime_type' in inline && inline.mime_type) ||
        'image/png'
      return `data:${mime};base64,${inline.data}`
    }
  }

  const textPart = c0?.content?.parts?.find((p) => p.text)?.text
  if (textPart) {
    throw new Error(`DI grąžino tekstą: ${textPart.slice(0, 120)}…`)
  }
  return null
}

function buildPrompt(input: GenerateFacadeInput): string {
  const {
    brickLabel,
    brickLengthMm,
    brickHeightMm,
    jointMm,
    facadeWidthM,
    facadeHeightM,
    bricksPerMeterU,
    bricksPerMeterV,
    estimatedFloors,
    coursesPerFloor,
    minVisibleCourses,
    hasExistingBrick,
    isAngledView,
    noEditZoneSummary,
  } = input
  const courseMm = brickHeightMm + jointMm
  const existingBrickNote = hasExistingBrick
    ? `IMAGE 1 ALREADY HAS real clinker at correct scale — count its mortar courses and match that count exactly (recolor to IMAGE 2 only).`
    : ''

  const angleNote = isAngledView
    ? `PHOTO IS AT AN ANGLE (perspective). Do NOT flatten or redraw openings — preserve depth, glass reflections, and stair geometry exactly as IMAGE 1.`
    : ''

  const protectNote = noEditZoneSummary
    ? `PROTECTED (pixel-copy from IMAGE 1, zero brick): ${noEditZoneSummary}.`
    : `PROTECTED: every window, every glass panel, any stairwell/lift glass shaft — pixel-copy from IMAGE 1.`

  return `TASK: IN-PLACE TEXTURE SWAP — recolor ONLY the cladding zone in IMAGE 4 mask.

FOUR images:
• IMAGE 1 — Original photo. ${existingBrickNote} ${angleNote}
• IMAGE 2 — Color swatch (${brickLabel}) only.
• IMAGE 3 — Brick preview ONLY where IMAGE 4 is white.
• IMAGE 4 — MASK: WHITE = apply ${brickLabel} brick/clinker, BLACK = copy IMAGE 1 pixel-perfect.

${protectNote}
Follow IMAGE 4 as law: if a pixel is BLACK, output must match IMAGE 1 exactly.

NEVER apply brick to: glass facades, curtain walls, windows, metal/corrugated siding, plastic panels, stairs visible through glass, sky, cars, interior (windowsill, blinds).

WHITE mask = only realistic clinker/brick/tile substrates (existing masonry, plaster panels). If IMAGE 1 already has brick, recolor in place — same course count and perforation pattern.

Physical scale:
• Building: ${estimatedFloors} floors × ~3.05 m = ~${(estimatedFloors * 3.05).toFixed(1)} m
• Brick: ${brickLengthMm}×${brickHeightMm} mm + ${jointMm} mm joint → ${courseMm} mm/course
• ~${coursesPerFloor.toFixed(0)} courses per floor (NOT 3–5 giant blocks per floor)
• Brick zone needs ≥ ${minVisibleCourses} visible horizontal mortar courses — your common error is ~20–35 oversized rows; that is WRONG.

Wall estimate: ~${facadeWidthM.toFixed(1)} m × ~${facadeHeightM.toFixed(1)} m (~${bricksPerMeterU.toFixed(1)} bricks/m, ~${bricksPerMeterV.toFixed(1)} courses/m).

=== SCALE (HIGHEST PRIORITY) ===
• Clinker courses are TINY on a ${estimatedFloors}-floor building — like IMAGE 1 grey brick, NOT large orange tiles.
• Match IMAGE 3 mortar line density exactly — same pixels between courses as IMAGE 3.
• If IMAGE 1 has existing brick: same course count + perforated pattern; change color only.
• Never cover glass, stairwell glass, windows, siding, or metal with brick.

=== EDIT RULES ===
Change texture ONLY inside WHITE mask. Do not extend brick beyond the mask onto glass or metal.

=== LOCK FROM IMAGE 1 (ABSOLUTE) ===
Everything BLACK in IMAGE 4 — unchanged pixels.

Output: IMAGE 1 with ${brickLabel} only in WHITE mask (≥ ${minVisibleCourses} mortar courses in that zone).`
}

async function callImageModel(
  model: string,
  input: GenerateFacadeInput,
): Promise<string> {
  const origB64 = stripDataUrl(input.originalJpeg)
  const guideB64 = stripDataUrl(input.compositeGuideJpeg)
  const maskB64 = stripDataUrl(input.brickMaskJpeg)
  const brick = await fetchImageAsBase64(input.brickTextureUrl)

  const res = await fetchWithTimeout(
    `/api/gemini/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      timeoutMs: 90_000,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(input) },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: origB64,
                },
              },
              {
                inline_data: {
                  mime_type: brick.mimeType,
                  data: brick.base64,
                },
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: guideB64,
                },
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: maskB64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature: 0,
        },
      }),
    },
  )

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`${model}: ${res.status} ${raw.slice(0, 320)}`)
  }

  const data = JSON.parse(raw) as unknown
  const imageUrl = extractImageDataUrl(data)
  if (!imageUrl) {
    throw new Error(`${model}: atsakyme nebuvo paveikslėlio`)
  }
  return imageUrl
}

export function isSameImageDataUrl(a: string, b: string): boolean {
  const aa = stripDataUrl(a)
  const bb = stripDataUrl(b)
  if (aa === bb) return true
  if (Math.abs(aa.length - bb.length) < 50) {
    const n = Math.min(800, aa.length, bb.length)
    return aa.slice(0, n) === bb.slice(0, n)
  }
  return false
}

export async function generateFacadeImage(
  input: GenerateFacadeInput,
): Promise<GenerateFacadeResult> {
  const errors: string[] = []

  for (const model of IMAGE_MODELS) {
    if (input.signal?.aborted) {
      throw new Error('Generavimas atšauktas.')
    }
    try {
      const imageDataUrl = await callImageModel(model, input)
      return { imageDataUrl, model }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(msg)
      if (input.signal?.aborted || msg.includes('atšaukt')) {
        throw new Error(msg)
      }
    }
  }

  throw new Error(`Generavimas nepavyko.\n${errors.join('\n')}`)
}
