import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResultPreview } from './components/ResultPreview'
import {
  BRICKS,
  BRICK_COLORS,
  type BrickColorId,
  type BrickFormatMm,
  type BrickProduct,
} from './data/bricks'
import { imageToJpegDataUrl } from './lib/imageDataUrl'
import { analyzeFacade } from './lib/detectFacade'
import { DEFAULT_FACADE_ANALYSIS } from './lib/facadeAnalysis'
import { measureBrickCoursesFromImage } from './lib/analyzeBrickScaleFromPhoto'
import {
  clearFacadeCornersCache,
  getCachedCorners,
  imageCacheKey,
  setCachedCorners,
} from './lib/facadeCornersCache'
import {
  generateFacadeImage,
  isSameImageDataUrl,
} from './lib/generateFacadeImage'
import { renderBrickComposite } from './lib/renderBrickComposite'
import { renderBrickMask } from './lib/renderBrickMask'
import {
  normalizeBrickStripCorners,
  normalizeFacadeCorners,
  type WallCorners,
} from './lib/homography'
import { DEFAULT_WALL_CORNERS } from './data/bricks'
import { calibrateTileRepeat, estimateFacadeScale } from './lib/facadeScale'
import type { FacadeAnalysis } from './lib/facadeAnalysis'
import {
  loadOrientedImageFromFile,
  loadOrientedImageFromUrl,
} from './lib/loadOrientedImage'
import {
  ESTIMATED_USD_PER_GENERATION,
  formatPhotoCount,
  getUsageStats,
  recordGeneration,
  type UsageStats,
} from './lib/usageStats'
import { augmentNoEditZones } from './lib/fallbackNoEditZones'
import { formatZonesForPrompt } from './lib/noEditZones'
import './App.css'

const SAMPLES = [
  {
    label: 'Pavyzdys: tamsi siena',
    url: '/samples/facade-anthrazit-wall.png',
  },
  {
    label: 'Pavyzdys: daugiabutis',
    url: '/samples/facade-gelb-bunt.png',
  },
  {
    label: 'Pavyzdys: gatvės fasadas',
    url: '/samples/facade-rot-bunt.png',
  },
] as const

type ViewTab = 'result' | 'original'

export default function App() {
  const [house, setHouse] = useState<HTMLImageElement | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultModel, setResultModel] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('original')
  const [houseError, setHouseError] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const genRunRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const [colorId, setColorId] = useState<BrickColorId>('anthrazit')
  const [formatMm, setFormatMm] = useState<BrickFormatMm>(52)
  /** 0 = auto iš nuotraukos */
  const [buildingFloors, setBuildingFloors] = useState(0)
  const [usage, setUsage] = useState<UsageStats | null>(null)

  useEffect(() => {
    setUsage(getUsageStats())
  }, [])

  const activeBrick = useMemo((): BrickProduct => {
    return (
      BRICKS.find((b) => b.colorId === colorId && b.heightMm === formatMm) ??
      BRICKS[0]
    )
  }, [colorId, formatMm])

  const houseDataUrl = useMemo(
    () => (house ? imageToJpegDataUrl(house, 1280, 0.88) : null),
    [house],
  )

  const hasResult = Boolean(resultUrl)

  const previewSrc =
    viewTab === 'result' && resultUrl ? resultUrl : houseDataUrl

  const previewKey =
    viewTab === 'result' && resultUrl ? `result-${resultUrl.length}` : `orig-${houseDataUrl?.length ?? 0}`

  const setHouseFromFile = useCallback(async (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) {
      setHouseError('Pasirinkite paveikslėlio failą (JPG arba PNG).')
      return
    }
    setHouseError(null)
    setGenError(null)
    try {
      const img = await loadOrientedImageFromFile(file)
      clearFacadeCornersCache()
      setHouse(img)
      setResultUrl(null)
      setResultModel(null)
      setViewTab('original')
      setGenError(null)
    } catch {
      setHouseError('Nepavyko nuskaityti failo.')
    }
  }, [])

  const loadSample = useCallback(async (url: string) => {
    setHouseError(null)
    setGenError(null)
    try {
      clearFacadeCornersCache()
      const img = await loadOrientedImageFromUrl(url)
      setHouse(img)
      setResultUrl(null)
      setResultModel(null)
      setViewTab('original')
      setGenError(null)
    } catch {
      setHouseError('Nepavyko įkelti pavyzdinės nuotraukos.')
    }
  }, [])

  const runGenerate = useCallback(async () => {
    if (!house) return

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    const runId = ++genRunRef.current
    const isActive = () => runId === genRunRef.current && !abort.signal.aborted

    setBusy(true)
    setGenError(null)
    setResultUrl(null)
    setResultModel(null)
    try {
      const dataUrl = imageToJpegDataUrl(house, 1280, 0.88)
      const cacheKey = imageCacheKey(dataUrl)

      setStatus('1/3 Atpažįstamas fasadas…')
      let maskCorners: WallCorners
      let analysis: FacadeAnalysis
      const cached = getCachedCorners(cacheKey)
      if (cached) {
        maskCorners = cached.maskCorners
        analysis = cached.analysis
        setStatus('1/3 Fasadas (iš atminties)…')
      } else {
        try {
          analysis = await analyzeFacade(dataUrl, {
            signal: abort.signal,
            timeoutMs: 30_000,
          })
          const buildingCorners = normalizeFacadeCorners(analysis.corners)
          maskCorners = analysis.brickStrip
            ? normalizeBrickStripCorners(analysis.brickStrip)
            : buildingCorners
          analysis = { ...analysis, corners: buildingCorners }
          setCachedCorners(cacheKey, { maskCorners, analysis })
        } catch {
          if (!isActive()) return
          analysis = {
            ...DEFAULT_FACADE_ANALYSIS,
            corners: [...DEFAULT_WALL_CORNERS],
          }
          maskCorners = normalizeFacadeCorners(analysis.corners)
          setCachedCorners(cacheKey, { maskCorners, analysis })
          setStatus('1/3 Fasadas (numatyti kampai)…')
        }
      }

      if (!isActive()) return

      analysis = {
        ...analysis,
        noEditZones: augmentNoEditZones(analysis),
      }

      const photoScale = measureBrickCoursesFromImage(
        house,
        analysis.brickStrip ?? maskCorners,
      )

      const tile = calibrateTileRepeat(
        activeBrick,
        analysis,
        maskCorners,
        photoScale?.visibleCourses ?? null,
        buildingFloors > 0 ? buildingFloors : null,
      )

      const floors = tile.estimatedFloors
      const scale = estimateFacadeScale(
        analysis.brickStrip ?? maskCorners,
        activeBrick,
        floors,
      )

      if (!isActive()) return

      const zoneHint =
        analysis.noEditZones.length > 0
          ? `, ${analysis.noEditZones.length} stiklo zonos`
          : ''
      setStatus(
        `2/3 Plytos (${floors} aukšt.${zoneHint}, ~${tile.minVisibleCourses} eilės)…`,
      )
      const compositeGuide = await renderBrickComposite({
        house,
        brick: activeBrick,
        corners: maskCorners,
        tileRepeatU: tile.repeatU,
        tileRepeatV: tile.repeatV,
        noEditZones: analysis.noEditZones,
      })

      const brickMask = renderBrickMask({
        width: house.naturalWidth,
        height: house.naturalHeight,
        corners: maskCorners,
        noEditZones: analysis.noEditZones,
      })

      if (!isActive()) return

      setStatus('3/3 DI keičia tik klinkerio zoną (iki 90 sek.)…')
      const { imageDataUrl, model } = await generateFacadeImage({
        originalJpeg: dataUrl,
        brickTextureUrl: activeBrick.textureUrl,
        brickLabel: activeBrick.label,
        compositeGuideJpeg: compositeGuide,
        brickLengthMm: activeBrick.lengthMm,
        brickHeightMm: activeBrick.heightMm,
        jointMm: activeBrick.jointMm,
        facadeWidthM: scale.facadeWidthM,
        facadeHeightM: scale.facadeHeightM,
        bricksPerMeterU: scale.bricksPerMeterU,
        bricksPerMeterV: scale.bricksPerMeterV,
        estimatedFloors: tile.estimatedFloors,
        coursesPerFloor: tile.coursesPerFloor,
        minVisibleCourses: tile.minVisibleCourses,
        hasExistingBrick: tile.hasExistingBrick,
        isAngledView: analysis.isAngledView,
        noEditZoneSummary: formatZonesForPrompt(analysis.noEditZones),
        brickMaskJpeg: brickMask,
        signal: abort.signal,
      })

      if (!isActive()) return

      if (isSameImageDataUrl(imageDataUrl, dataUrl)) {
        throw new Error(
          'DI grąžino tą patį vaizdą. Bandykite kitą nuotrauką be Google žemėlapio UI.',
        )
      }
      setResultUrl(imageDataUrl)
      setResultModel(model)
      setViewTab('result')
      setUsage(recordGeneration())
      setStatus(`Paruošta (${model})`)
    } catch (e) {
      if (!isActive()) return
      const msg = e instanceof Error ? e.message : 'Generavimas nepavyko'
      if (!msg.includes('atšaukt')) {
        setGenError(msg)
        setStatus(null)
      }
    } finally {
      if (isActive()) {
        setBusy(false)
        abortRef.current = null
      }
    }
  }, [house, activeBrick, buildingFloors])

  const downloadImage = () => {
    const src =
      viewTab === 'result' && resultUrl
        ? resultUrl
        : house
          ? houseDataUrl
          : null
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download =
      viewTab === 'result' ? 'klinker-fasadas-rezultatas.png' : 'klinker-originalas.jpg'
    a.click()
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Klinker fasado vizualizatorius</h1>
        <p className="subtitle">
          Įkelkite <strong>švarų fasado kadą</strong> (ne Google Maps ekrano
          nuotrauką), pasirinkite plytą ir spauskite <strong>Sugeneruoti</strong>.
          DI keičia <strong>tik klinkerio zoną</strong> — stiklas ir metalas lieka
          kaip nuotraukoje.
        </p>
      </header>

      <section className="toolbar">
        <input
          type="file"
          accept="image/*"
          className="visually-hidden"
          id="house-upload"
          onChange={(e) => {
            void setHouseFromFile(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <label className="btn primary" htmlFor="house-upload">
          Įkelti nuotrauką
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={!house || busy}
          onClick={() => void runGenerate()}
        >
          {busy ? 'Generuojama…' : 'Sugeneruoti fasadą'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!house && !resultUrl}
          onClick={downloadImage}
        >
          Atsisiųsti
        </button>
      </section>

      {status ? <p className="message status-msg">{status}</p> : null}
      {houseError ? (
        <p className="message error" role="alert">
          {houseError}
        </p>
      ) : null}
      {genError ? (
        <p className="message error" role="alert">
          {genError}
        </p>
      ) : null}

      <div className="samples-row">
        {SAMPLES.map((s) => (
          <button
            key={s.url}
            type="button"
            className="btn sample-btn"
            disabled={busy}
            onClick={() => void loadSample(s.url)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint samples-hint">
        Pavyzdinės nuotraukos — tik parodymui; plytą pasirenkate dešinėje.
        DI keičia tik ten, kur realiai dedamas klinkeris (ne stiklas / metalas).
      </p>

      <div className="layout">
        <div className="preview-column">
          {previewSrc ? (
            <div className="preview-stack">
              {busy ? (
                <div className="generating-overlay" aria-live="polite">
                  <div className="generating-spinner" />
                  <p>{status ?? 'Generuojama…'}</p>
                </div>
              ) : null}

              {hasResult ? (
                <div className="view-tabs">
                  <button
                    type="button"
                    className={`view-tab ${viewTab === 'result' ? 'active' : ''}`}
                    onClick={() => setViewTab('result')}
                  >
                    DI rezultatas
                  </button>
                  <button
                    type="button"
                    className={`view-tab ${viewTab === 'original' ? 'active' : ''}`}
                    onClick={() => setViewTab('original')}
                  >
                    Originalas
                  </button>
                </div>
              ) : (
                <p className="hint preview-hint">
                  Paspauskite „Sugeneruoti fasadą“ — laukiama DI rezultato.
                </p>
              )}
              <ResultPreview
                viewKey={previewKey}
                src={previewSrc}
                alt={
                  viewTab === 'result' && hasResult
                    ? 'Sugeneruotas fasadas su klinkeriu'
                    : 'Originali nuotrauka'
                }
              />
              {hasResult && resultModel && viewTab === 'result' ? (
                <p className="hint success-hint">
                  Sugeneruota modeliu: {resultModel}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="empty-preview">
              <p className="message">
                Įkelkite fasado nuotrauką ir pasirinkite plytą.
              </p>
            </div>
          )}
        </div>

        <aside className="controls">
          <h2 className="panel-title">Plyta</h2>
          <div className="brick-grid">
            {BRICK_COLORS.map((c) => (
              <button
                key={c.colorId}
                type="button"
                className={`brick-thumb ${c.colorId === colorId ? 'active' : ''}`}
                disabled={busy}
                onClick={() => {
                  setColorId(c.colorId)
                  setResultUrl(null)
                  setResultModel(null)
                  setGenError(null)
                }}
              >
                <img src={c.textureUrl} alt="" />
                <span className="brick-thumb-label">{c.label}</span>
              </button>
            ))}
          </div>

          <label className="field">
            <span className="field-label">Pastato aukštai</span>
            <select
              className="select"
              value={buildingFloors}
              disabled={busy}
              onChange={(e) => {
                setBuildingFloors(Number(e.target.value))
                setResultUrl(null)
                setResultModel(null)
                setGenError(null)
              }}
            >
              <option value={0}>Auto (iš nuotraukos)</option>
              {[3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => (
                <option key={n} value={n}>
                  {n} aukštai
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Plytos aukštis (formatas)</span>
            <select
              className="select"
              value={formatMm}
              disabled={busy}
              onChange={(e) => {
                setFormatMm(Number(e.target.value) as BrickFormatMm)
                setResultUrl(null)
                setResultModel(null)
                setGenError(null)
              }}
            >
              <option value={52}>52 mm (~62 vnt/m²)</option>
              <option value={71}>71 mm (~48 vnt/m²)</option>
            </select>
          </label>

          <p className="hint spec-hint">
            {activeBrick.label} — {activeBrick.lengthMm}×{activeBrick.heightMm}{' '}
            mm, siūlė {activeBrick.jointMm} mm
          </p>

          {usage ? (
            <p className="hint usage-hint">
              <strong>Šiandien sugeneruota:</strong>{' '}
              {formatPhotoCount(usage.todayCount)}
              {' · '}
              apytiksliai <strong>~${usage.estimatedUsdToday.toFixed(2)}</strong>{' '}
              (po ~${ESTIMATED_USD_PER_GENERATION.toFixed(2)} / vnt.)
            </p>
          ) : null}

          <p className="hint api-hint">
            Geriausia: nuotrauka be Google žemėlapio mygtukų. Reikia{' '}
            <code>GEMINI_API_KEY</code>. Skaičius saugomas šiame įrenginyje;
            tikram billing — Google AI Studio.
          </p>
        </aside>
      </div>
    </div>
  )
}
