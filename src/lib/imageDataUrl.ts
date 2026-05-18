export function imageToJpegDataUrl(
  img: HTMLImageElement,
  maxSide = 1536,
  quality = 0.88,
): string {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w <= 0 || h <= 0) throw new Error('Netinkamas paveikslėlis')

  const scale = Math.min(1, maxSide / Math.max(w, h))
  const tw = Math.round(w * scale)
  const th = Math.round(h * scale)

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas nepalaikomas')
  ctx.drawImage(img, 0, 0, tw, th)
  return canvas.toDataURL('image/jpeg', quality)
}
