import type { WallCorners } from '../lib/homography'

export type BrickColorId =
  | 'anthrazit'
  | 'gelb-bunt-carbon'
  | 'perlweiss'
  | 'rot-bunt'
  | 'rot-bunt-carbon'

export type BrickFormatMm = 52 | 71

export interface BrickProduct {
  id: string
  colorId: BrickColorId
  label: string
  textureUrl: string
  lengthMm: number
  depthMm: number
  heightMm: BrickFormatMm
  jointMm: number
  piecesPerM2: number
  weightKgPerM2: number
  textureBricksWide: number
  textureBricksTall: number
}

const BASE = {
  lengthMm: 240,
  depthMm: 14,
  jointMm: 12,
} as const

const COLORS: {
  colorId: BrickColorId
  label: string
  subtitle: string
  textureUrl: string
  textureBricksWide: number
  textureBricksTall: number
}[] = [
  {
    colorId: 'anthrazit',
    label: 'AARHUS anthrazit',
    subtitle: 'Tamsiai pilka',
    textureUrl: '/textures/anthrazit.jpg',
    textureBricksWide: 4,
    textureBricksTall: 5,
  },
  {
    colorId: 'gelb-bunt-carbon',
    label: 'AARHUS gelb-bunt, carbon',
    subtitle: 'Geltona su anglies atspalviu',
    textureUrl: '/textures/gelb-bunt-carbon.jpg',
    textureBricksWide: 5,
    textureBricksTall: 6,
  },
  {
    colorId: 'perlweiss',
    label: 'AARHUS perlweiß',
    subtitle: 'Perlinė balta',
    textureUrl: '/textures/perlweiss.jpg',
    textureBricksWide: 5,
    textureBricksTall: 6,
  },
  {
    colorId: 'rot-bunt',
    label: 'AARHUS rot-bunt',
    subtitle: 'Raudonai marga',
    textureUrl: '/textures/rot-bunt.jpg',
    textureBricksWide: 5,
    textureBricksTall: 6,
  },
  {
    colorId: 'rot-bunt-carbon',
    label: 'AARHUS rot-bunt, carbon',
    subtitle: 'Raudona su anglies atspalviu',
    textureUrl: '/textures/rot-bunt-carbon.jpg',
    textureBricksWide: 5,
    textureBricksTall: 6,
  },
]

const FORMATS: {
  heightMm: BrickFormatMm
  piecesPerM2: number
  weightKgPerM2: number
}[] = [
  { heightMm: 52, piecesPerM2: 62, weightKgPerM2: 25 },
  { heightMm: 71, piecesPerM2: 48, weightKgPerM2: 26 },
]

export const BRICKS: BrickProduct[] = COLORS.flatMap((c) =>
  FORMATS.map((f) => ({
    id: `${c.colorId}-${f.heightMm}`,
    colorId: c.colorId,
    label: `${c.label} (${f.heightMm} mm)`,
    textureUrl: c.textureUrl,
    ...BASE,
    heightMm: f.heightMm,
    piecesPerM2: f.piecesPerM2,
    weightKgPerM2: f.weightKgPerM2,
    textureBricksWide: c.textureBricksWide,
    textureBricksTall: c.textureBricksTall,
  })),
)

export const DEFAULT_WALL_CORNERS: WallCorners = [
  { x: 0.12, y: 0.14 },
  { x: 0.88, y: 0.12 },
  { x: 0.9, y: 0.82 },
  { x: 0.1, y: 0.84 },
]

export const BRICK_COLORS = COLORS

export function brickStepM(b: BrickProduct): { stepUm: number; stepVm: number } {
  return {
    stepUm: (b.lengthMm + b.jointMm) / 1000,
    stepVm: (b.heightMm + b.jointMm) / 1000,
  }
}

export function tileRepeatFromFacade(
  b: BrickProduct,
  facadeWidthM: number,
  facadeHeightM: number,
): { repeatU: number; repeatV: number } {
  const { stepUm, stepVm } = brickStepM(b)
  return {
    repeatU: Math.max(1, facadeWidthM / stepUm),
    repeatV: Math.max(1, facadeHeightM / stepVm),
  }
}
