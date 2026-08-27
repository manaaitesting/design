import { PRELUDE } from './glsl';

export type ParamType = 'float' | 'color';

export interface ShaderParam {
  key: string;
  label: string;
  type: ParamType;
  min?: number;
  max?: number;
  step?: number;
  value: number | string;
}

export interface ShaderDef {
  id: string;
  name: string;
  category: string;
  /** fragment body — the prelude and uniform declarations are prepended */
  body: string;
  params: ShaderParam[];
}

const f = (key: string, label: string, value: number, min: number, max: number, step = 0.01): ShaderParam =>
  ({ key, label, type: 'float', value, min, max, step });
const c = (key: string, label: string, value: string): ShaderParam =>
  ({ key, label, type: 'color', value });

export const SHADERS: ShaderDef[] = [
  // ── Gradients ──────────────────────────────────────────────────────────
  {
    id: 'mesh',
    name: 'Mesh Gradient',
    category: 'Gradients',
    params: [
      c('c1', 'Colour 1', '#BDEE63'),
      c('c2', 'Colour 2', '#4CC3F0'),
      c('c3', 'Colour 3', '#9B7BF0'),
      c('c4', 'Colour 4', '#F2637F'),
      f('speed', 'Speed', 0.18, 0, 1.5),
      f('scale', 'Scale', 1.6, 0.2, 6),
      f('warp', 'Warp', 0.45, 0, 1.5),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      float t = u_time * u_speed;
      vec2 q = uv * u_scale;
      vec2 warped = q + u_warp * vec2(fbm(q + t * 0.6), fbm(q + 4.7 - t * 0.5));

      float a = smoothstep(0.15, 0.95, fbm(warped + vec2(0.0, t * 0.2)));
      float b = smoothstep(0.10, 0.90, fbm(warped * 1.3 + vec2(3.1, -t * 0.25)));
      float d = smoothstep(0.20, 1.00, fbm(warped * 0.8 + vec2(-2.4, t * 0.18)));

      vec3 col = mix(u_c1, u_c2, a);
      col = mix(col, u_c3, b * 0.85);
      col = mix(col, u_c4, d * 0.55);
      outColor = vec4(col, 1.0);
    `,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    category: 'Gradients',
    params: [
      c('sky', 'Sky', '#050B1F'),
      c('band', 'Band', '#27C4A6'),
      c('tip', 'Tip', '#9B7BF0'),
      f('speed', 'Speed', 0.25, 0, 1.5),
      f('bands', 'Bands', 3.0, 1, 8, 0.1),
      f('softness', 'Softness', 0.35, 0.05, 1),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float t = u_time * u_speed;
      float curtain = 0.0;
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float offset = fbm(vec2(uv.x * u_bands + fi * 3.3, t + fi)) * 0.55;
        float y = uv.y + offset - 0.35 - fi * 0.06;
        curtain += smoothstep(u_softness, 0.0, abs(y)) * (1.0 - fi * 0.18);
      }
      vec3 col = mix(u_sky, u_band, clamp(curtain, 0.0, 1.0));
      col = mix(col, u_tip, clamp(curtain * curtain * 0.8, 0.0, 1.0));
      outColor = vec4(col, 1.0);
    `,
  },
  {
    id: 'liquid-metal',
    name: 'Liquid Metal',
    category: 'Gradients',
    params: [
      c('dark', 'Dark', '#1C1C1E'),
      c('light', 'Light', '#FFFFFF'),
      f('speed', 'Speed', 0.12, 0, 1),
      f('turns', 'Turns', 3.0, 1, 10, 0.5),
      f('warp', 'Warp', 0.6, 0, 2),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      float t = u_time * u_speed;
      uv += u_warp * 0.25 * vec2(fbm(uv * 3.0 + t), fbm(uv * 3.0 - t + 9.1));
      float angle = atan(uv.y, uv.x);
      float sheen = 0.5 + 0.5 * cos(angle * u_turns + t * 6.2831);
      sheen = pow(sheen, 2.2);
      float rim = smoothstep(0.75, 0.0, length(uv));
      outColor = vec4(mix(u_dark, u_light, sheen * rim + 0.06), 1.0);
    `,
  },

  // ── Filters ────────────────────────────────────────────────────────────
  {
    id: 'halftone',
    name: 'Halftone Dots',
    category: 'Filters',
    params: [
      c('ink', 'Ink', '#111111'),
      c('paper', 'Paper', '#FFFFFF'),
      f('size', 'Dot size', 7.0, 2, 40, 0.5),
      f('angle', 'Angle', 0.4, 0, 1.57),
      f('speed', 'Speed', 0.15, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float t = u_time * u_speed;
      float tone = fbm(uv * 2.2 + vec2(t, -t * 0.6));
      tone = clamp(tone * 1.35, 0.0, 1.0);

      vec2 grid = rot(u_angle) * gl_FragCoord.xy;
      vec2 cell = fract(grid / u_size) - 0.5;
      float radius = sqrt(1.0 - tone) * 0.62;
      float dot_ = smoothstep(radius, radius - 1.2 / u_size, length(cell));
      outColor = vec4(mix(u_paper, u_ink, dot_), 1.0);
    `,
  },
  {
    id: 'dither',
    name: 'Ordered Dither',
    category: 'Filters',
    params: [
      c('lo', 'Low', '#111111'),
      c('hi', 'High', '#BDEE63'),
      f('pixel', 'Pixel size', 4.0, 1, 16, 1),
      f('speed', 'Speed', 0.2, 0, 1),
      f('levels', 'Levels', 2.0, 2, 8, 1),
    ],
    body: /* glsl */ `
      vec2 px = floor(gl_FragCoord.xy / u_pixel) * u_pixel;
      vec2 uv = px / u_resolution;
      float t = u_time * u_speed;
      float tone = fbm(uv * 3.0 + vec2(t, t * 0.4));

      // 4x4 Bayer threshold matrix
      int x = int(mod(px.x / u_pixel, 4.0));
      int y = int(mod(px.y / u_pixel, 4.0));
      int index = x + y * 4;
      float bayer[16] = float[16](
         0.0,  8.0,  2.0, 10.0,
        12.0,  4.0, 14.0,  6.0,
         3.0, 11.0,  1.0,  9.0,
        15.0,  7.0, 13.0,  5.0
      );
      float threshold = (bayer[index] + 0.5) / 16.0;

      float steps = u_levels - 1.0;
      float quantised = floor(tone * steps + threshold) / steps;
      outColor = vec4(mix(u_lo, u_hi, clamp(quantised, 0.0, 1.0)), 1.0);
    `,
  },
  {
    id: 'fluted',
    name: 'Fluted Glass',
    category: 'Filters',
    params: [
      c('tint', 'Tint', '#9CC0D6'),
      c('sheen', 'Sheen', '#FFFFFF'),
      f('flutes', 'Flutes', 26.0, 4, 120, 1),
      f('depth', 'Depth', 0.5, 0, 1),
      f('speed', 'Speed', 0.1, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float t = u_time * u_speed;
      float flute = fract(uv.x * u_flutes);
      float lens = sin(flute * 3.14159);
      vec2 refracted = uv + vec2((lens - 0.5) * u_depth * 0.06, 0.0);
      float backdrop = fbm(refracted * 2.4 + vec2(t, 0.0));
      vec3 col = mix(u_tint * 0.75, u_tint, backdrop);
      col = mix(col, u_sheen, pow(lens, 6.0) * 0.9);
      outColor = vec4(col, 1.0);
    `,
  },
  {
    id: 'grain',
    name: 'Film Grain',
    category: 'Filters',
    params: [
      c('base', 'Base', '#2C2C2E'),
      f('amount', 'Amount', 0.22, 0, 1),
      f('size', 'Grain size', 1.4, 0.5, 6),
      f('speed', 'Speed', 8.0, 0, 30, 0.5),
      f('vignette', 'Vignette', 0.35, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float t = floor(u_time * u_speed);
      float g = hash(floor(gl_FragCoord.xy / u_size) + t * 37.0) - 0.5;
      float v = 1.0 - u_vignette * length(uv - 0.5) * 1.4;
      outColor = vec4(clamp(u_base * v + g * u_amount, 0.0, 1.0), 1.0);
    `,
  },
  {
    id: 'dot-orb',
    name: 'Dot Orb',
    category: 'Filters',
    params: [
      c('bg', 'Background', '#071033'),
      c('dot', 'Dot', '#78C8FF'),
      f('spacing', 'Spacing', 9.0, 3, 40, 0.5),
      f('radius', 'Orb radius', 0.42, 0.05, 1),
      f('speed', 'Speed', 0.5, 0, 3),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      float t = u_time * u_speed;
      float pulse = u_radius * (0.9 + 0.1 * sin(t * 2.0));
      float orb = smoothstep(pulse, pulse - 0.28, length(uv));

      vec2 cell = fract(gl_FragCoord.xy / u_spacing) - 0.5;
      float dots = smoothstep(0.34, 0.18, length(cell));
      outColor = vec4(mix(u_bg, u_dot, dots * orb), 1.0);
    `,
  },
];

export const SHADER_BY_ID = new Map(SHADERS.map((s) => [s.id, s]));
export const SHADER_CATEGORIES = [...new Set(SHADERS.map((s) => s.category))];

export function defaultParams(def: ShaderDef): Record<string, number | string> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.value]));
}

/** Declares one uniform per param, then splices in the shader body. */
export function compose(def: ShaderDef): string {
  const uniforms = def.params
    .map((p) => `uniform ${p.type === 'color' ? 'vec3' : 'float'} u_${p.key};`)
    .join('\n');
  return `${PRELUDE}\n${uniforms}\n\nvoid main() {${def.body}}\n`;
}
