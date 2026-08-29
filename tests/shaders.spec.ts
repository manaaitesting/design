import { expect, test } from '@playwright/test';
import { SHADERS, compose, defaultParams } from '../src/webgl/shaders';

/**
 * Every shader, compiled on a real GPU.
 *
 * A shader is the one thing in this codebase that cannot fail loudly: a program
 * that does not compile paints nothing, and a layer that paints nothing looks
 * exactly like a layer nobody has styled yet. TypeScript sees a template
 * string, so the only thing that can tell us a `vec2` was handed to a `float`
 * is the driver. So the whole catalogue goes through `compileShader` in a real
 * WebGL2 context, and the assertion is the driver's own info log.
 */

test('every shader in the catalogue compiles and links', async ({ page }) => {
  await page.goto('/signin');

  const programs = SHADERS.map((def) => ({ id: def.id, source: compose(def) }));
  const failures = await page.evaluate((entries) => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return [{ id: '(no context)', log: 'WebGL2 is unavailable in this browser' }];

    const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertex, VERTEX);
    gl.compileShader(vertex);

    const bad: { id: string; log: string }[] = [];
    for (const entry of entries) {
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fragment, entry.source);
      gl.compileShader(fragment);
      if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
        bad.push({ id: entry.id, log: gl.getShaderInfoLog(fragment) ?? 'no log' });
        gl.deleteShader(fragment);
        continue;
      }
      // linking is a second thing that can fail, and it is what actually runs
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        bad.push({ id: entry.id, log: gl.getProgramInfoLog(program) ?? 'no log' });
      }
      gl.deleteShader(fragment);
      gl.deleteProgram(program);
    }
    return bad;
  }, programs);

  expect(failures, failures.map((f) => `${f.id}: ${f.log}`).join('\n')).toEqual([]);
});

test('every shader declares a uniform for every parameter it reads', () => {
  // A body that reads `u_foo` with no `foo` param compiles — the uniform is
  // simply never declared, so the program fails to link, or worse links with
  // the value silently zero. Catching it here says which shader and which name.
  for (const def of SHADERS) {
    const declared = new Set(def.params.map((param) => `u_${param.key}`));
    const read = def.body.match(/\bu_[A-Za-z0-9_]+/g) ?? [];
    for (const name of new Set(read)) {
      // the prelude supplies these two to everything
      if (name === 'u_resolution' || name === 'u_time') continue;
      expect(declared, `${def.id} reads ${name} but has no such parameter`).toContain(name);
    }
  }
});

test('every shader has a unique id and a full set of defaults', () => {
  const ids = SHADERS.map((def) => def.id);
  expect(new Set(ids).size, 'two shaders share an id').toBe(ids.length);

  for (const def of SHADERS) {
    const defaults = defaultParams(def);
    expect(Object.keys(defaults).length).toBe(def.params.length);
    for (const param of def.params) {
      if (param.type === 'color') {
        expect(String(defaults[param.key]), `${def.id}.${param.key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      } else {
        const value = Number(defaults[param.key]);
        expect(Number.isFinite(value), `${def.id}.${param.key}`).toBe(true);
        // a default outside its own slider is a control that jumps on first drag
        expect(value).toBeGreaterThanOrEqual(param.min ?? -Infinity);
        expect(value).toBeLessThanOrEqual(param.max ?? Infinity);
      }
    }
  }
});
