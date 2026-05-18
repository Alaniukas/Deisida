interface ResultPreviewProps {
  src: string
  alt: string
  viewKey: string
}

export function ResultPreview({ src, alt, viewKey }: ResultPreviewProps) {
  return (
    <img
      key={viewKey}
      src={src}
      alt={alt}
      className="result-image"
      decoding="async"
    />
  )
}
