import { useCallback, useMemo, useRef, useState } from 'react'
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
import { formatUserError } from './lib/formatUserError'
import { augmentNoEditZones } from './lib/fallbackNoEditZones'
import { formatZonesForPrompt } from './lib/noEditZones'
import { recordGeneration } from './lib/usageStats'
import './App.css'

const SAMPLES = [
  {
    label: 'Tamsi siena',
    url: '/samples/facade-anthrazit-wall.png',
  },
  {
    label: 'Daugiabutis',
    url: '/samples/facade-gelb-bunt.png',
  },
  {
    label: 'Gatvės fasadas',
    url: '/samples/facade-rot-bunt.png',
  },
] as const

const GENERATION_STEPS = [
  'Analizuojama nuotrauka',
  'Taikoma plytų tekstūra',
  'Kuriama vizualizacija',
] as const

type ViewTab = 'result' | 'original'
type GenerationStep = 1 | 2 | 3 | null

export default function App() {
  const [house, setHouse] = useState<HTMLImageElement | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('original')
  const [houseError, setHouseError] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [generationStep, setGenerationStep] = useState<GenerationStep>(null)
  const [busy, setBusy] = useState(false)

  const genRunRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const [colorId, setColorId] = useState<BrickColorId>('anthrazit')
  const [formatMm, setFormatMm] = useState<BrickFormatMm>(52)
  /** 0 = auto iš nuotraukos */
  const [buildingFloors, setBuildingFloors] = useState(0)

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

  const activeColor = useMemo(
    () => BRICK_COLORS.find((c) => c.colorId === colorId) ?? BRICK_COLORS[0],
    [colorId],
  )

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
    setGenerationStep(1)
    try {
      const dataUrl = imageToJpegDataUrl(house, 1280, 0.88)
      const cacheKey = imageCacheKey(dataUrl)

      setStatus(`${GENERATION_STEPS[0]}…`)
      let maskCorners: WallCorners
      let analysis: FacadeAnalysis
      const cached = getCachedCorners(cacheKey)
      if (cached) {
        maskCorners = cached.maskCorners
        analysis = cached.analysis
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

      setGenerationStep(2)
      setStatus(`${GENERATION_STEPS[1]}…`)
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

      setGenerationStep(3)
      setStatus(`${GENERATION_STEPS[2]}…`)
      const { imageDataUrl } = await generateFacadeImage({
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
      setViewTab('result')
      recordGeneration()
      setStatus('Vizualizacija paruošta!')
    } catch (e) {
      if (!isActive()) return
      const msg = e instanceof Error ? e.message : 'Generavimas nepavyko'
      if (!msg.includes('atšaukt')) {
        setGenError(formatUserError(msg))
        setStatus(null)
        setGenerationStep(null)
      }
    } finally {
      if (isActive()) {
        setBusy(false)
        setGenerationStep(null)
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
          Įkelkite pastato nuotrauką, pasirinkite klinkerio spalvą ir
          pamatykite, kaip atrodys jūsų fasadas. Langai ir kitos detalės
          lieka nepakitę.
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
          {busy ? 'Kuriama vizualizacija…' : 'Sugeneruoti fasadą'}
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

      {status && !busy ? (
        <p className="message status-msg">{status}</p>
      ) : null}
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
        <span className="samples-label">Arba išbandykite:</span>
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

      <div className="layout">
        <div className="preview-column">
          {previewSrc ? (
            <div className="preview-stack">
              {busy ? (
                <div className="generating-overlay" aria-live="polite">
                  <div className="generating-spinner" />
                  <ol className="progress-steps">
                    {GENERATION_STEPS.map((label, i) => {
                      const stepNum = i + 1
                      const state =
                        generationStep === stepNum
                          ? 'active'
                          : generationStep !== null && generationStep > stepNum
                            ? 'done'
                            : 'pending'
                      return (
                        <li key={label} className={`progress-step ${state}`}>
                          <span className="progress-step-num">{i + 1}</span>
                          <span className="progress-step-label">{label}</span>
                        </li>
                      )
                    })}
                  </ol>
                  <p className="generating-status">{status ?? 'Palaukite…'}</p>
                </div>
              ) : null}

              {hasResult ? (
                <div className="view-tabs">
                  <button
                    type="button"
                    className={`view-tab ${viewTab === 'result' ? 'active' : ''}`}
                    onClick={() => setViewTab('result')}
                  >
                    Su klinkeriu
                  </button>
                  <button
                    type="button"
                    className={`view-tab ${viewTab === 'original' ? 'active' : ''}`}
                    onClick={() => setViewTab('original')}
                  >
                    Prieš
                  </button>
                </div>
              ) : house ? (
                <p className="hint preview-hint">
                  Paspauskite „Sugeneruoti fasadą“, kad pamatytumėte rezultatą.
                </p>
              ) : null}
              <ResultPreview
                viewKey={previewKey}
                src={previewSrc}
                alt={
                  viewTab === 'result' && hasResult
                    ? 'Sugeneruotas fasadas su klinkeriu'
                    : 'Originali nuotrauka'
                }
              />
              {hasResult && viewTab === 'result' && !busy ? (
                <p className="hint success-hint">Vizualizacija paruošta!</p>
              ) : null}
            </div>
          ) : (
            <div className="empty-preview">
              <div className="empty-icon" aria-hidden="true">🏠</div>
              <p className="empty-title">Pradėkite čia</p>
              <p className="message">
                Įkelkite pastato nuotrauką arba pasirinkite pavyzdį, tada
                dešinėje pasirinkite klinkerio spalvą.
              </p>
            </div>
          )}
        </div>

        <aside className="controls">
          <h2 className="panel-title">Pasirinkite klinkerį</h2>
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
                  setGenError(null)
                }}
              >
                <img src={c.textureUrl} alt="" />
                <span className="brick-thumb-label">{c.label}</span>
                <span className="brick-thumb-subtitle">{c.subtitle}</span>
              </button>
            ))}
          </div>

          <label className="field">
            <span className="field-label">Pastato aukštų skaičius</span>
            <select
              className="select"
              value={buildingFloors}
              disabled={busy}
              onChange={(e) => {
                setBuildingFloors(Number(e.target.value))
                setResultUrl(null)
                setGenError(null)
              }}
            >
              <option value={0}>Nustatyti automatiškai</option>
              {[3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => (
                <option key={n} value={n}>
                  {n} aukštai
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Plytos dydis</span>
            <select
              className="select"
              value={formatMm}
              disabled={busy}
              onChange={(e) => {
                setFormatMm(Number(e.target.value) as BrickFormatMm)
                setResultUrl(null)
                setGenError(null)
              }}
            >
              <option value={52}>Standartinis (52 mm)</option>
              <option value={71}>Didelis (71 mm)</option>
            </select>
          </label>

          <p className="hint spec-hint">
            {activeColor.subtitle} · {activeBrick.lengthMm}×{activeBrick.heightMm} mm
          </p>
        </aside>
      </div>
    </div>
  )
}
