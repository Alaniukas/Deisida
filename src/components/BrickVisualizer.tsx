import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { blendModeToGlIndex } from '../lib/blendMode'
import type { BrickProduct } from '../data/bricks'
import {
  homographyUnitSquareToImage,
  invert3RowMajor,
  rowMajorToGlColumnMajor3,
  type WallCorners,
} from '../lib/homography'

const MAX_W = 920
const MAX_H = 640
const MIN_PAINT_W = 120

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_house;
uniform sampler2D u_brick;
uniform mat3 u_Hinv;
uniform vec2 u_tileRepeat;
uniform float u_rotationRad;
uniform float u_opacity;
uniform int u_blendMode;
uniform float u_edgeFeather;
out vec4 outColor;

vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blendOverlay(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend,
    vec3(1.0) - 2.0 * (vec3(1.0) - base) * (vec3(1.0) - blend),
    step(vec3(0.5), base)
  );
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (vec3(1.0) - 2.0 * blend),
    sqrt(base) * (2.0 * blend - vec3(1.0)) + 2.0 * base * (vec3(1.0) - blend),
    step(vec3(0.5), blend)
  );
}

void main() {
  // WebGL tekstūroje Y=0 apačioje; kampai ir nuotrauka – viršuje kairėje.
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 house = texture(u_house, uv);
  vec3 p = u_Hinv * vec3(uv, 1.0);
  vec2 wuv = p.xy / p.z;

  if (wuv.x < 0.0 || wuv.x > 1.0 || wuv.y < 0.0 || wuv.y > 1.0) {
    outColor = house;
    return;
  }

  float edge = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  float mask = smoothstep(0.0, u_edgeFeather, edge);
  if (mask < 0.001) {
    outColor = house;
    return;
  }

  vec2 c = wuv - 0.5;
  float cr = cos(u_rotationRad);
  float sr = sin(u_rotationRad);
  vec2 rot = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) + 0.5;
  vec2 brickUV = fract(rot * u_tileRepeat);
  vec3 brick = texture(u_brick, brickUV).rgb;

  vec3 blended;
  if (u_blendMode == 0) blended = blendMultiply(house.rgb, brick);
  else if (u_blendMode == 1) blended = blendOverlay(house.rgb, brick);
  else if (u_blendMode == 2) blended = blendSoftLight(house.rgb, brick);
  else blended = brick;

  float a = u_opacity * mask;
  outColor = vec4(mix(house.rgb, blended, a), 1.0);
}`

function fitImageSize(
  naturalW: number,
  naturalH: number,
  containerCapW: number,
): { displayW: number; displayH: number } {
  const maxW = Math.max(MIN_PAINT_W, Math.min(MAX_W, containerCapW))
  let displayW = Math.min(maxW, naturalW)
  let displayH = (displayW * naturalH) / naturalW
  if (displayH > MAX_H) {
    displayH = MAX_H
    displayW = (displayH * naturalW) / naturalH
  }
  return { displayW, displayH }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function createProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgram | null {
  const vsh = compileShader(gl, gl.VERTEX_SHADER, vs)
  const fsh = compileShader(gl, gl.FRAGMENT_SHADER, fs)
  if (!vsh || !fsh) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vsh)
  gl.attachShader(prog, fsh)
  gl.linkProgram(prog)
  gl.deleteShader(vsh)
  gl.deleteShader(fsh)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    return null
  }
  return prog
}

export interface BrickVisualizerHandle {
  downloadPng: () => void
}

interface BrickVisualizerProps {
  house: HTMLImageElement | null
  brick: BrickProduct
  textureUrl: string
  corners: WallCorners
  onCornersChange: (c: WallCorners) => void
  tileRepeatU: number
  tileRepeatV: number
  rotationDeg: number
  opacity: number
  blendMode: GlobalCompositeOperation
  edgeFeather: number
}

export const BrickVisualizer = forwardRef<
  BrickVisualizerHandle,
  BrickVisualizerProps
>(function BrickVisualizer(
  {
    house,
    brick,
    textureUrl,
    corners,
    onCornersChange,
    tileRepeatU,
    tileRepeatV,
    rotationDeg,
    opacity,
    blendMode,
    edgeFeather,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const progRef = useRef<WebGLProgram | null>(null)
  const houseTexRef = useRef<WebGLTexture | null>(null)
  const brickTexRef = useRef<WebGLTexture | null>(null)
  const [brickSurface, setBrickSurface] = useState<HTMLImageElement | null>(
    null,
  )
  const [containerCapW, setContainerCapW] = useState(() =>
    typeof window !== 'undefined'
      ? Math.min(MAX_W, Math.max(MIN_PAINT_W, window.innerWidth - 40))
      : MAX_W,
  )
  const dragRef = useRef<{ index: number } | null>(null)
  const displayRef = useRef({ w: 0, h: 0 })

  useEffect(() => {
    setBrickSurface(null)
    const img = new Image()
    img.decoding = 'async'
    img.src = textureUrl
    img.onload = () => setBrickSurface(img)
    img.onerror = () => setBrickSurface(null)
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [textureUrl, brick.id])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setContainerCapW(Math.min(MAX_W, Math.floor(w - 4)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    downloadPng: () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = 'klinker-fasadas.png'
      a.click()
    },
  }))

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !house?.complete || house.naturalWidth === 0) return
    if (!brickSurface?.complete || brickSurface.naturalWidth === 0) return

    const { displayW, displayH } = fitImageSize(
      house.naturalWidth,
      house.naturalHeight,
      containerCapW,
    )
    displayRef.current = { w: displayW, h: displayH }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(displayW * dpr)
    canvas.height = Math.round(displayH * dpr)
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    let gl = glRef.current
    if (!gl) {
      gl = canvas.getContext('webgl2', { premultipliedAlpha: false })
      if (!gl) return
      glRef.current = gl
      const prog = createProgram(gl, VERT_SRC, FRAG_SRC)
      if (!prog) return
      progRef.current = prog
    }

    const prog = progRef.current
    if (!gl || !prog) return

    gl.viewport(0, 0, canvas.width, canvas.height)

    const uploadTex = (
      tex: WebGLTexture | null,
      img: HTMLImageElement,
      unit: number,
    ) => {
      let t = tex
      if (!t) {
        t = gl.createTexture()
        if (!t) return null
      }
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      return t
    }

    houseTexRef.current = uploadTex(houseTexRef.current, house, 0) ?? null
    brickTexRef.current =
      uploadTex(brickTexRef.current, brickSurface, 1) ?? null
    if (!houseTexRef.current || !brickTexRef.current) return

    const H = homographyUnitSquareToImage(corners)
    const Hinv = H ? invert3RowMajor(H) : null
    if (!Hinv) return
    const HinvGl = rowMajorToGlColumnMajor3(Hinv)

    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const locPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(locPos)
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0)

    gl.uniform1i(gl.getUniformLocation(prog, 'u_house'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'u_brick'), 1)
    gl.uniformMatrix3fv(
      gl.getUniformLocation(prog, 'u_Hinv'),
      false,
      HinvGl,
    )
    gl.uniform2f(
      gl.getUniformLocation(prog, 'u_tileRepeat'),
      tileRepeatU,
      tileRepeatV,
    )
    gl.uniform1f(
      gl.getUniformLocation(prog, 'u_rotationRad'),
      (rotationDeg * Math.PI) / 180,
    )
    gl.uniform1f(gl.getUniformLocation(prog, 'u_opacity'), opacity)
    gl.uniform1i(
      gl.getUniformLocation(prog, 'u_blendMode'),
      blendModeToGlIndex(blendMode),
    )
    gl.uniform1f(gl.getUniformLocation(prog, 'u_edgeFeather'), edgeFeather)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.deleteBuffer(buf)
  }, [
    house,
    brickSurface,
    corners,
    containerCapW,
    tileRepeatU,
    tileRepeatV,
    rotationDeg,
    opacity,
    blendMode,
    edgeFeather,
  ])

  useEffect(() => {
    paint()
  }, [paint])

  const clientToNorm = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      return { x, y }
    },
    [],
  )

  const startDrag = (index: number, e: React.PointerEvent) => {
    dragRef.current = { index }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const pt = clientToNorm(e.clientX, e.clientY)
    if (!pt) return
    const next = [...corners] as WallCorners
    next[dragRef.current.index] = pt
    onCornersChange(next)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={wrapRef} className="brick-visualizer-wrap">
      <canvas
        ref={canvasRef}
        className="brick-canvas"
        aria-label="Fasado peržiūra su klinkerio plytelėmis"
      />
      <svg
        className="corner-overlay"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-label="Sienos zona — vilkite kampus"
      >
        <polygon
          points={corners.map((c) => `${c.x},${c.y}`).join(' ')}
          className="corner-poly"
        />
        {corners.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={0.028}
            className="corner-handle-hit"
            onPointerDown={(e) => startDrag(i, e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        ))}
        {corners.map((c, i) => (
          <circle
            key={`vis-${i}`}
            cx={c.x}
            cy={c.y}
            r={0.012}
            className="corner-handle"
            pointerEvents="none"
          />
        ))}
      </svg>
    </div>
  )
})
