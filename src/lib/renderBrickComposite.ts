import type { BrickProduct } from '../data/bricks'
import {
  homographyUnitSquareToImage,
  invert3RowMajor,
  rowMajorToGlColumnMajor3,
  type WallCorners,
} from './homography'

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
out vec4 outColor;

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 house = texture(u_house, uv);
  vec3 p = u_Hinv * vec3(uv, 1.0);
  vec2 wuv = p.xy / p.z;
  if (wuv.x < 0.0 || wuv.x > 1.0 || wuv.y < 0.0 || wuv.y > 1.0) {
    outColor = house;
    return;
  }
  float edge = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  float mask = smoothstep(0.0, 0.006, edge);
  vec2 brickUV = fract(wuv * u_tileRepeat);
  vec3 brick = texture(u_brick, brickUV).rgb;
  vec3 blended = house.rgb * brick;
  outColor = vec4(mix(house.rgb, blended, mask * 0.95), 1.0);
}`

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null
  return sh
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vsh = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fsh = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  if (!vsh || !fsh) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vsh)
  gl.attachShader(prog, fsh)
  gl.linkProgram(prog)
  gl.deleteShader(vsh)
  gl.deleteShader(fsh)
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Tekstūra'))
    img.src = src
  })
}

export interface RenderCompositeOptions {
  house: HTMLImageElement
  brick: BrickProduct
  corners: WallCorners
  tileRepeatU: number
  tileRepeatV: number
}

/** Nupiešia plytų peržiūrą ant fasado (be UI) — naudojama kaip DI gidas. */
export async function renderBrickComposite(
  opts: RenderCompositeOptions,
): Promise<string> {
  const { house, brick, corners, tileRepeatU, tileRepeatV } = opts
  const brickImg = await loadImage(brick.textureUrl)

  const w = house.naturalWidth
  const h = house.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })
  if (!gl) throw new Error('WebGL2 nepalaikomas')

  const prog = createProgram(gl)
  if (!prog) throw new Error('WebGL shader klaida')

  const upload = (img: HTMLImageElement, unit: number) => {
    const tex = gl.createTexture()
    if (!tex) throw new Error('texture')
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    return tex
  }

  upload(house, 0)
  upload(brickImg, 1)

  const H = homographyUnitSquareToImage(corners)
  const Hinv = H ? invert3RowMajor(H) : null
  if (!Hinv) throw new Error('Nepavyko homografija')

  gl.viewport(0, 0, w, h)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  )
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  gl.uniform1i(gl.getUniformLocation(prog, 'u_house'), 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'u_brick'), 1)
  gl.uniformMatrix3fv(
    gl.getUniformLocation(prog, 'u_Hinv'),
    false,
    rowMajorToGlColumnMajor3(Hinv),
  )
  gl.uniform2f(
    gl.getUniformLocation(prog, 'u_tileRepeat'),
    tileRepeatU,
    tileRepeatV,
  )
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  return canvas.toDataURL('image/jpeg', 0.9)
}
