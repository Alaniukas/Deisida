export async function fetchImageAsBase64(url: string): Promise<{
  base64: string
  mimeType: string
}> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Nepavyko įkelti tekstūros: ${url}`)
  const blob = await res.blob()
  const mimeType = blob.type || 'image/jpeg'
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return { base64: btoa(binary), mimeType }
}
