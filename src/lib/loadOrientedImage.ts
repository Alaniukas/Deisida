/** Įkelia paveikslą su teisinga EXIF orientacija (telefono nuotraukos). */
async function bitmapToImage(bitmap: ImageBitmap): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas nepalaikomas')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nepavyko sukurti paveikslėlio'))
    img.src = canvas.toDataURL('image/jpeg', 0.92)
  })
}

export async function loadOrientedImageFromFile(
  file: File,
): Promise<HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      })
      return bitmapToImage(bitmap)
    } catch {
      /* fallback */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await loadOrientedImageFromUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function loadOrientedImageFromUrl(
  src: string,
): Promise<HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      })
      return bitmapToImage(bitmap)
    } catch {
      /* fallback */
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nepavyko įkelti paveikslėlio'))
    img.src = src
  })
}
