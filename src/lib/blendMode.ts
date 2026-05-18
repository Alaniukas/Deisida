const BLEND_OPTIONS: GlobalCompositeOperation[] = [
  'multiply',
  'soft-light',
  'overlay',
  'source-over',
]

export function isBlendMode(v: string): v is GlobalCompositeOperation {
  return (BLEND_OPTIONS as string[]).includes(v)
}

export function blendModeToGlIndex(mode: GlobalCompositeOperation): number {
  switch (mode) {
    case 'multiply':
      return 0
    case 'overlay':
      return 1
    case 'soft-light':
      return 2
    case 'source-over':
      return 3
    default:
      return 0
  }
}
