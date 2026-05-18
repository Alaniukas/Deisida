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
  /** Geometrinė plytų peržiūra — DI turi ją patobulinti, ne išgalvoti iš naujo */
  compositeGuideJpeg: string
  brickLengthMm: number
  brickHeightMm: number
  jointMm: number
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
  const { brickLabel, brickLengthMm, brickHeightMm, jointMm } = input
  return `TASK: WALL SURFACE TEXTURE SWAP ONLY (clinker brick cladding visualization).

You receive THREE images in order:
• IMAGE 1 — ORIGINAL photograph. This is the ground truth. Your output must be IMAGE 1 with ONLY wall plaster/concrete changed to brick.
• IMAGE 2 — Flat brick texture swatch (${brickLabel}). Material sample only — NOT a building.
• IMAGE 3 — Draft showing WHERE on the wall the brick should appear. Cover ALL wall panels of the building front (full elevation), not only one central strip.

Brick: ~${brickLengthMm}×${brickHeightMm} mm, ~${jointMm} mm joints, running bond.

=== WHAT YOU MAY CHANGE (ONLY THIS) ===
Replace the color/texture of exposed WALL SUBSTRATE (concrete, plaster, painted panels) in the areas indicated by IMAGE 3 with realistic ${brickLabel} clinker brick from IMAGE 2.
Add natural lighting/shadows ON THE BRICK only.

=== WHAT MUST STAY IDENTICAL TO IMAGE 1 (PIXEL-ACCURATE) ===
Copy unchanged from IMAGE 1 — do NOT redraw, redesign, clean up, or "improve":
• Every WINDOW: frame, glass, reflections, mullions, size, position, color
• Every BALCONY: slab, railing, enclosure, glazing, frames, rust, curtains — exact same shape and count
• Every DOOR, entrance, canopy, stairwell window column
• Roof line, cornice, floor count, building silhouette
• Pipes, AC units, signs, graffiti, parking signs, cars, trees, sky, ground
• Any Google Maps / UI overlays if present

=== ABSOLUTE PROHIBITIONS ===
• Do NOT add, remove, resize, or move balconies
• Do NOT add, remove, or change windows or doors
• Do NOT change balcony glass, railings, or enclosure style
• Do NOT change window frame color or material
• Do NOT copy any building geometry from IMAGE 2
• Do NOT modernize or renovate the building — only change bare wall texture to brick

If a pixel belongs to window/balcony/door/sky/ground → keep it exactly as IMAGE 1.
When unsure → leave unchanged from IMAGE 1.

Output: one photorealistic photo = IMAGE 1 + brick on wall panels only.`
}

async function callImageModel(
  model: string,
  input: GenerateFacadeInput,
): Promise<string> {
  const origB64 = stripDataUrl(input.originalJpeg)
  const guideB64 = stripDataUrl(input.compositeGuideJpeg)
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
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
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
