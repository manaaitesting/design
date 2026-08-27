import { VERTEX } from './glsl';
import { compose, type ShaderDef } from './shaders';

/**
 * A minimal WebGL2 renderer: one fullscreen triangle, one fragment shader.
 *
 * Every instance shares a single requestAnimationFrame loop. A canvas per node
 * with a rAF each would cost a frame's worth of scheduling per shader; one
 * ticker keeps a canvas full of them at 60fps.
 */

interface Uniforms {
  [key: string]: number | string;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return [1, 0, 1];
  // sRGB → linear-ish; keeps mixes from muddying in the middle
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

export class ShaderInstance {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private start = performance.now();
  private width = 0;
  private height = 0;

  params: Uniforms;
  visible = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly def: ShaderDef,
    params: Uniforms,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
      // deliberately NOT preserveDrawingBuffer: it makes the browser copy the
      // backbuffer every frame for every shader on the canvas ("GPU stall due
      // to ReadPixels"). Export calls redrawAll() and reads the surface in the
      // same task instead, which is when the buffer is still valid.
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;
    this.params = params;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, compose(def));
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;

    // one oversized triangle covers the viewport with no index buffer
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

    register(this);
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.locations.get(name)!;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  draw(now: number, force = false): void {
    if ((!this.visible && !force) || this.width === 0) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.location('u_resolution'), this.width, this.height);
    gl.uniform1f(this.location('u_time'), (now - this.start) / 1000);

    for (const param of this.def.params) {
      const value = this.params[param.key] ?? param.value;
      const location = this.location(`u_${param.key}`);
      if (!location) continue;
      if (param.type === 'color') {
        const [r, g, b] = hexToRgb(String(value));
        gl.uniform3f(location, r, g, b);
      } else {
        gl.uniform1f(location, Number(value));
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    unregister(this);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ── Shared ticker ────────────────────────────────────────────────────────

const live = new Set<ShaderInstance>();
let frame = 0;

function tick(now: number): void {
  for (const instance of live) {
    try {
      instance.draw(now);
    } catch {
      // a lost context shouldn't take the whole canvas down
    }
  }
  frame = requestAnimationFrame(tick);
}

function register(instance: ShaderInstance): void {
  live.add(instance);
  if (!frame) frame = requestAnimationFrame(tick);
}

/**
 * Draws every live surface synchronously. Export calls this immediately before
 * reading the canvases, so `toDataURL` sees a fresh frame without the per-frame
 * cost of `preserveDrawingBuffer`. `force` covers surfaces the
 * IntersectionObserver has paused: off-screen is not a reason to export blank.
 */
export function redrawAll(): void {
  const now = performance.now();
  for (const instance of live) {
    try {
      instance.draw(now, true);
    } catch {
      // a lost context shouldn't block the export
    }
  }
}

function unregister(instance: ShaderInstance): void {
  live.delete(instance);
  if (live.size === 0 && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
