import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured' })
    return
  }

  const segments = req.query.path
  const path = Array.isArray(segments) ? segments.join('/') : (segments ?? '')
  const url = `https://generativelanguage.googleapis.com/${path}`

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(req.body),
    })

    const text = await upstream.text()
    const contentType =
      upstream.headers.get('content-type') ?? 'application/json'
    res.status(upstream.status).setHeader('Content-Type', contentType)
    res.send(text)
  } catch {
    res.status(502).json({ error: 'Upstream request failed' })
  }
}
