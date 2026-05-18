import {
  FACADE_CORNERS_JSON_PROMPT,
  extractJsonText,
  parseCornersJson,
} from './facadeDetectPrompt'
import { fetchWithTimeout } from './fetchWithTimeout'
import type { WallCorners } from './homography'

export interface DetectFacadeOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

const MODEL =
  (import.meta.env.VITE_GEMINI_VISION_MODEL as string | undefined) ||
  (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ||
  'gemini-flash-latest'

export async function detectFacadeCornersGemini(
  jpegDataUrl: string,
  options?: DetectFacadeOptions,
): Promise<WallCorners> {
  const base64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '')

  const res = await fetchWithTimeout(
    `/api/gemini/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? 25_000,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: FACADE_CORNERS_JSON_PROMPT },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!res.ok) {
    const errText = await res.text()
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Gemini API raktas neveikia. Patikrinkite GEMINI_API_KEY faile .env',
      )
    }
    throw new Error(`Gemini klaida (${res.status}): ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini negrąžino teksto atsakymo')
  return parseCornersJson(extractJsonText(text))
}
