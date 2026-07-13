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

function loadDataUrlAsImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nepavyko nuskaityti vaizdo'))
    img.src = dataUrl
  })
}

/** Sumažina JPEG data URL prieš siuntimą į API (Vercel limitas ~4.5 MB). */
export async function shrinkJpegDataUrl(
  dataUrl: string,
  maxSide = 1024,
  quality = 0.72,
): Promise<string> {
  const img = await loadDataUrlAsImage(dataUrl)
  return imageToJpegDataUrl(img, maxSide, quality)
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  return Math.ceil((base64.length * 3) / 4)
}
