import { detectFacadeCornersGemini } from './detectFacadeGemini'
import type { WallCorners } from './homography'

export type { DetectFacadeOptions } from './detectFacadeGemini'

export async function detectFacadeCorners(
  jpegDataUrl: string,
  options?: import('./detectFacadeGemini').DetectFacadeOptions,
): Promise<WallCorners> {
  return detectFacadeCornersGemini(jpegDataUrl, options)
}
