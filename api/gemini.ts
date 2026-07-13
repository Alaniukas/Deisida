import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
}

function getUpstreamPath(req: VercelRequest): string {
  const fromQuery = req.query.upstreamPath
  if (typeof fromQuery === 'string' && fromQuery.length > 0) {
    return decodeURIComponent(fromQuery)
  }
  if (Array.isArray(fromQuery) && fromQuery.length > 0) {
    return decodeURIComponent(fromQuery.join('/'))
  }

  const rawUrl = req.url ?? ''
  const match = rawUrl.match(/\/api\/gemini\/(.+?)(?:\?|$)/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
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

  const upstreamPath = getUpstreamPath(req)
  if (!upstreamPath) {
    res.status(400).json({ error: 'Missing Gemini API path' })
    return
  }

  const url = `https://generativelanguage.googleapis.com/${upstreamPath}`

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
