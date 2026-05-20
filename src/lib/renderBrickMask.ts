import {
  homographyUnitSquareToImage,
  invert3RowMajor,
  rowMajorToGlColumnMajor3,
  type WallCorners,
} from './homography'
import { packExcludeBoxes, type NoEditZone } from './noEditZones'

const MAX_EXCLUDE = 8

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
uniform mat3 u_Hinv;
uniform int u_excludeCount;
uniform vec4 u_exclude[${MAX_EXCLUDE}];
out vec4 outColor;

bool inExcludeZone(vec2 uv) {
  for (int i = 0; i < ${MAX_EXCLUDE}; i++) {
    if (i >= u_excludeCount) break;
    vec4 b = u_exclude[i];
    if (uv.x >= b.x && uv.x <= b.z && uv.y >= b.y && uv.y <= b.w) {
      return true;
    }
  }
  return false;
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  if (inExcludeZone(uv)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 p = u_Hinv * vec3(uv, 1.0);
  vec2 wuv = p.xy / p.z;
  if (wuv.x < 0.0 || wuv.x > 1.0 || wuv.y < 0.0 || wuv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float edge = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  float mask = smoothstep(0.0, 0.01, edge);
  float v = mask > 0.02 ? 1.0 : 0.0;
  outColor = vec4(v, v, v, 1.0);
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

export interface RenderBrickMaskOptions {
  width: number
  height: number
  corners: WallCorners
  noEditZones: NoEditZone[]
}

/** Juoda/balta kaukė: balta = leisti plytas, juoda = kopijuoti IMAGE 1. */
export function renderBrickMask(opts: RenderBrickMaskOptions): string {
  const { width, height, corners, noEditZones } = opts
  const { count, boxes } = packExcludeBoxes(noEditZones)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })
  if (!gl) throw new Error('WebGL2 nepalaikomas')

  const prog = createProgram(gl)
  if (!prog) throw new Error('WebGL mask shader klaida')

  const H = homographyUnitSquareToImage(corners)
  const Hinv = H ? invert3RowMajor(H) : null
  if (!Hinv) throw new Error('Nepavyko homografija')

  gl.viewport(0, 0, width, height)
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

  gl.uniformMatrix3fv(
    gl.getUniformLocation(prog, 'u_Hinv'),
    false,
    rowMajorToGlColumnMajor3(Hinv),
  )
  gl.uniform1i(gl.getUniformLocation(prog, 'u_excludeCount'), count)
  for (let i = 0; i < MAX_EXCLUDE; i++) {
    const locEx = gl.getUniformLocation(prog, `u_exclude[${i}]`)
    if (locEx) {
      gl.uniform4f(
        locEx,
        boxes[i * 4],
        boxes[i * 4 + 1],
        boxes[i * 4 + 2],
        boxes[i * 4 + 3],
      )
    }
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  return canvas.toDataURL('image/jpeg', 0.92)
}
