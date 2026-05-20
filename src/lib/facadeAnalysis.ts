import type { NoEditZone } from './noEditZones'
import type { WallCorners } from './homography'

export interface FacadeAnalysis {
  corners: WallCorners
  estimatedFloors: number
  hasExistingBrick: boolean
  visibleBrickCourses: number | null
  /** Siaura esamo klinkerio juosta — tik ten keičiama tekstūra. */
  brickStrip: WallCorners | null
  /** Nuotrauka iš kampo (ne tiesiai iš priekio). */
  isAngledView: boolean
  /** Langai, stiklinė laiptinė ir kt. — nekeisti. */
  noEditZones: NoEditZone[]
}

export const DEFAULT_FACADE_ANALYSIS: Omit<FacadeAnalysis, 'corners'> = {
  estimatedFloors: 4,
  hasExistingBrick: false,
  visibleBrickCourses: null,
  brickStrip: null,
  isAngledView: false,
  noEditZones: [],
}
