import type { BrickProduct } from '../data/bricks'
import { brickStepM } from '../data/bricks'
import type { FacadeAnalysis } from './facadeAnalysis'
import type { WallCorners } from './homography'

const FLOOR_HEIGHT_M = 3.05

function quadWidthFrac(corners: WallCorners): number {
  const xs = corners.map((c) => c.x)
  return Math.max(...xs) - Math.min(...xs)
}

function quadHeightFrac(corners: WallCorners): number {
  const ys = corners.map((c) => c.y)
  return Math.max(...ys) - Math.min(...ys)
}

export function estimateFacadeWidthM(widthFrac: number): number {
  if (widthFrac < 0.14) return Math.max(0.85, widthFrac * 14)
  if (widthFrac < 0.28) return Math.max(1.4, widthFrac * 16)
  if (widthFrac < 0.45) return widthFrac * 22
  return Math.max(6, Math.min(24, widthFrac * 20))
}

export function estimateFacadeHeightM(heightFrac: number, floors: number): number {
  return Math.max(floors * FLOOR_HEIGHT_M, heightFrac * 25)
}

export function coursesPerFloor(brick: BrickProduct): number {
  return FLOOR_HEIGHT_M / brickStepM(brick).stepVm
}

export interface FacadeScaleEstimate {
  facadeWidthM: number
  facadeHeightM: number
  repeatU: number
  repeatV: number
  bricksPerMeterU: number
  bricksPerMeterV: number
  widthFrac: number
  heightFrac: number
}

export function tileRepeatForMask(
  scale: FacadeScaleEstimate,
  maskCorners: WallCorners,
  scaleCorners: WallCorners,
): { repeatU: number; repeatV: number } {
  const maskW = Math.max(0.05, quadWidthFrac(maskCorners))
  const scaleW = Math.max(0.05, quadWidthFrac(scaleCorners))
  const maskH = Math.max(0.05, quadHeightFrac(maskCorners))
  const scaleH = Math.max(0.05, quadHeightFrac(scaleCorners))
  return {
    repeatU: scale.repeatU * (maskW / scaleW),
    repeatV: scale.repeatV * (maskH / scaleH),
  }
}

export function estimateFacadeScale(
  corners: WallCorners,
  brick: BrickProduct,
  floors: number,
): FacadeScaleEstimate {
  const widthFrac = quadWidthFrac(corners)
  const heightFrac = quadHeightFrac(corners)
  const facadeWidthM = estimateFacadeWidthM(widthFrac)
  const facadeHeightM = estimateFacadeHeightM(heightFrac, floors)
  const { stepUm, stepVm } = brickStepM(brick)
  const repeatU = Math.max(1, facadeWidthM / stepUm)
  const repeatV = Math.max(1, facadeHeightM / stepVm)
  return {
    facadeWidthM,
    facadeHeightM,
    repeatU,
    repeatV,
    bricksPerMeterU: 1 / stepUm,
    bricksPerMeterV: 1 / stepVm,
    widthFrac,
    heightFrac,
  }
}

export interface CalibratedTileRepeat {
  repeatU: number
  repeatV: number
  minVisibleCourses: number
  estimatedFloors: number
  coursesPerFloor: number
  /** Kampai plytų gido renderiui — dažniausiai siaura klinkerio juosta. */
  guideCorners: WallCorners
  hasExistingBrick: boolean
}

export function calibrateTileRepeat(
  brick: BrickProduct,
  analysis: FacadeAnalysis,
  maskCorners: WallCorners,
  photoCourses: number | null,
  userFloors: number | null,
): CalibratedTileRepeat {
  const floors = userFloors ?? analysis.estimatedFloors
  const cpf = coursesPerFloor(brick)
  const guideCorners = analysis.brickStrip ?? maskCorners
  const buildingH = Math.max(0.2, quadHeightFrac(analysis.corners))
  const stripH = quadHeightFrac(guideCorners)
  const heightShare = Math.min(1.15, stripH / buildingH)

  const scaleRegion = analysis.brickStrip ?? analysis.corners
  const scale = estimateFacadeScale(scaleRegion, brick, floors)
  const base = tileRepeatForMask(scale, maskCorners, scaleRegion)

  const coursesFromBuilding = Math.round(floors * cpf * heightShare)
  let minVisibleCourses = coursesFromBuilding

  if (analysis.visibleBrickCourses != null) {
    minVisibleCourses = Math.max(
      minVisibleCourses,
      Math.round(analysis.visibleBrickCourses * 1.15),
    )
  }
  if (photoCourses != null) {
    minVisibleCourses = Math.max(
      minVisibleCourses,
      Math.round(photoCourses * 1.15),
    )
  }

  const repeatV = Math.max(base.repeatV, minVisibleCourses)
  const repeatU = Math.max(base.repeatU, 2)

  return {
    repeatU,
    repeatV,
    minVisibleCourses,
    estimatedFloors: floors,
    coursesPerFloor: cpf,
    guideCorners,
    hasExistingBrick: analysis.hasExistingBrick,
  }
}
