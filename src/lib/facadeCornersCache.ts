import type { FacadeAnalysis } from './facadeAnalysis'
import type { WallCorners } from './homography'

export interface FacadeCornersCacheEntry {
  maskCorners: WallCorners
  analysis: FacadeAnalysis
}

const cache = new Map<string, FacadeCornersCacheEntry>()

export function imageCacheKey(jpegDataUrl: string): string {
  const b64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '')
  const len = b64.length
  return `v6:${len}:${b64.slice(0, 64)}:${b64.slice(-64)}`
}

export function getCachedCorners(
  key: string,
): FacadeCornersCacheEntry | undefined {
  return cache.get(key)
}

export function setCachedCorners(
  key: string,
  entry: FacadeCornersCacheEntry,
): void {
  cache.set(key, entry)
  if (cache.size > 12) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

export function clearFacadeCornersCache(): void {
  cache.clear()
}
