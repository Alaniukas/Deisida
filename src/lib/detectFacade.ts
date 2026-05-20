import { analyzeFacadeGemini } from './detectFacadeGemini'
import type { FacadeAnalysis } from './facadeAnalysis'

export type { DetectFacadeOptions } from './detectFacadeGemini'

export async function analyzeFacade(
  jpegDataUrl: string,
  options?: import('./detectFacadeGemini').DetectFacadeOptions,
): Promise<FacadeAnalysis> {
  return analyzeFacadeGemini(jpegDataUrl, options)
}
