import type { WallCorners } from './homography'

const cache = new Map<string, WallCorners>()

/** Pigus raktas pagal nuotraukos turinį — kad nebekartotų DI kiekvieną kartą. */
export function imageCacheKey(jpegDataUrl: string): string {
  const b64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '')
  const len = b64.length
  // v2 — seni siauri kampai nebevartojami
  return `v2:${len}:${b64.slice(0, 64)}:${b64.slice(-64)}`
}

export function getCachedCorners(key: string): WallCorners | undefined {
  return cache.get(key)
}

export function setCachedCorners(key: string, corners: WallCorners): void {
  cache.set(key, corners)
  if (cache.size > 12) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

export function clearFacadeCornersCache(): void {
  cache.clear()
}
