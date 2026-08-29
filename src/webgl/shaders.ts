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

  // ── Gradients ──────────────────────────────────────────────────────────
  {
    id: 'radial',
    name: 'Radial Gradient',
    category: 'Gradients',
    params: [
      c('inner', 'Inner', '#FFD79A'),
      c('outer', 'Outer', '#1B1035'),
      f('radius', 'Radius', 0.62, 0.05, 1.6),
      f('softness', 'Softness', 0.75, 0.02, 2),
      f('cx', 'Centre X', 0.5, 0, 1),
      f('cy', 'Centre Y', 0.5, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      float d = length(uv - vec2(u_cx, u_cy));
      float t = smoothstep(u_radius, u_radius + u_softness, d);
      outColor = vec4(mix(u_inner, u_outer, t), 1.0);
    `,
  },
  {
    id: 'grain-gradient',
    name: 'Grain Gradient',
    category: 'Gradients',
    params: [
      c('from', 'From', '#F26B5B'),
      c('to', 'To', '#2A1B4E'),
      f('angle', 'Angle', 0.6, 0, 6.28, 0.01),
      f('grain', 'Grain', 0.14, 0, 0.6),
      f('speed', 'Speed', 4.0, 0, 30, 0.5),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      // the dither is what stops a wide, shallow ramp from banding
      float t = dot(uv - 0.5, vec2(cos(u_angle), sin(u_angle))) + 0.5;
      float g = hash(gl_FragCoord.xy + floor(u_time * u_speed) * 13.0) - 0.5;
      outColor = vec4(clamp(mix(u_from, u_to, clamp(t, 0.0, 1.0)) + g * u_grain, 0.0, 1.0), 1.0);
    `,
  },
  {
    id: 'color-panels',
    name: 'Colour Panels',
    category: 'Gradients',
    params: [
      c('a', 'Panel 1', '#0F172A'),
      c('b', 'Panel 2', '#2563EB'),
      c('c', 'Panel 3', '#F59E0B'),
      f('panels', 'Panels', 5.0, 2, 20, 1),
      f('angle', 'Angle', 0.35, 0, 3.14, 0.01),
      f('speed', 'Speed', 0.15, 0, 1.5),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      uv = rot(u_angle) * uv;
      float band = uv.x * u_panels + u_time * u_speed;
      float index = floor(band);
      float pick = fract(index * 0.381966);
      vec3 col = pick < 0.34 ? u_a : (pick < 0.67 ? u_b : u_c);
      // a hairline of the next panel's colour, so the edges read as folds
      float edge = smoothstep(0.0, 0.04, fract(band)) * smoothstep(1.0, 0.96, fract(band));
      outColor = vec4(col * (0.82 + 0.18 * edge), 1.0);
    `,
  },
  {
    id: 'heatmap',
    name: 'Heatmap',
    category: 'Gradients',
    params: [
      f('scale', 'Scale', 3.2, 0.5, 12),
      f('speed', 'Speed', 0.2, 0, 2),
      f('contrast', 'Contrast', 1.3, 0.2, 3),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      float v = fbm(uv * u_scale + vec2(0.0, u_time * u_speed));
      v = clamp((v - 0.5) * u_contrast + 0.5, 0.0, 1.0);
      // the thermal ramp: black → red → orange → yellow → white
      vec3 col = clamp(vec3(v * 3.0, v * 3.0 - 1.0, v * 3.0 - 2.0), 0.0, 1.0);
      outColor = vec4(col, 1.0);
    `,
  },

  // ── Noise ──────────────────────────────────────────────────────────────
  {
    id: 'simplex',
    name: 'Simplex Noise',
    category: 'Noise',
    params: [
      c('lo', 'Low', '#101828'),
      c('hi', 'High', '#E6F0FF'),
      f('scale', 'Scale', 3.0, 0.3, 16),
      f('speed', 'Speed', 0.25, 0, 2),
      f('octaves', 'Octaves', 4.0, 1, 6, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) * u_scale;
      float t = u_time * u_speed;
      float value = 0.0;
      float amplitude = 0.5;
      vec2 p = uv;
      for (int i = 0; i < 6; i++) {
        if (float(i) >= u_octaves) break;
        value += amplitude * snoise(p + t * (0.4 + float(i) * 0.1));
        p *= 2.03;
        amplitude *= 0.5;
      }
      outColor = vec4(mix(u_lo, u_hi, clamp(value * 0.5 + 0.5, 0.0, 1.0)), 1.0);
    `,
  },
  {
    id: 'perlin',
    name: 'Perlin Noise',
    category: 'Noise',
    params: [
      c('lo', 'Low', '#1A1A2E'),
      c('hi', 'High', '#B7E4FF'),
      f('scale', 'Scale', 4.5, 0.3, 20),
      f('speed', 'Speed', 0.18, 0, 2),
      f('ridged', 'Ridged', 0.0, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) * u_scale;
      float n = gnoise(uv + vec2(u_time * u_speed, 0.0));
      // ridged turns the gradient noise inside out at zero, which is where
      // mountain ranges and marbling come from
      float ridged = 1.0 - abs(n);
      float value = mix(n * 0.5 + 0.5, ridged, u_ridged);
      outColor = vec4(mix(u_lo, u_hi, clamp(value, 0.0, 1.0)), 1.0);
    `,
  },
  {
    id: 'neuro',
    name: 'Neuro Noise',
    category: 'Noise',
    params: [
      c('bg', 'Background', '#05060E'),
      c('line', 'Line', '#7DF9FF'),
      f('scale', 'Scale', 2.2, 0.3, 8),
      f('speed', 'Speed', 0.3, 0, 2),
      f('thickness', 'Thickness', 0.5, 0.05, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      uv *= u_scale;
      float t = u_time * u_speed;
      // the sine-fold cascade: each pass folds the plane back on itself, which
      // is what turns smooth noise into filaments
      float acc = 0.0;
      float amplitude = 1.0;
      for (int i = 0; i < 6; i++) {
        uv = rot(0.7) * uv;
        uv += sin(uv.yx * 1.7 + t) * 0.45;
        acc += abs(sin(uv.x * 2.3) * sin(uv.y * 2.3)) * amplitude;
        amplitude *= 0.68;
      }
      float line = smoothstep(u_thickness, u_thickness * 0.25, acc * 0.35);
      outColor = vec4(mix(u_bg, u_line, line), 1.0);
    `,
  },
  {
    id: 'warp',
    name: 'Warp',
    category: 'Noise',
    params: [
      c('a', 'Colour 1', '#0B1026'),
      c('b', 'Colour 2', '#3B82F6'),
      c('c', 'Colour 3', '#F0ABFC'),
      f('scale', 'Scale', 2.4, 0.3, 8),
      f('strength', 'Strength', 1.1, 0, 3),
      f('speed', 'Speed', 0.15, 0, 1.5),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) * u_scale;
      float t = u_time * u_speed;
      // domain warping: fbm of an fbm of an fbm, which is what makes the
      // structure look drawn rather than generated
      vec2 q = vec2(fbm(uv + t * 0.3), fbm(uv + vec2(5.2, 1.3)));
      vec2 r = vec2(fbm(uv + u_strength * q + vec2(1.7, 9.2) + t * 0.15),
                    fbm(uv + u_strength * q + vec2(8.3, 2.8)));
      float v = fbm(uv + u_strength * r);
      vec3 col = mix(u_a, u_b, clamp(v * 1.6, 0.0, 1.0));
      col = mix(col, u_c, clamp(length(r) * 0.8, 0.0, 1.0));
      outColor = vec4(col, 1.0);
    `,
  },
  {
    id: 'paper',
    name: 'Paper Texture',
    category: 'Noise',
    params: [
      c('stock', 'Stock', '#F4F1EA'),
      c('fibre', 'Fibre', '#CFC7B6'),
      f('grain', 'Grain', 0.5, 0, 1),
      f('fibres', 'Fibres', 60.0, 5, 300, 1),
      f('tooth', 'Tooth', 0.35, 0, 1),
    ],
    body: /* glsl */ `
      vec2 px = gl_FragCoord.xy;
      // long thin fibres in one direction, then a shorter cross-grain
      float along = fbm(vec2(px.x / u_fibres, px.y / (u_fibres * 0.06)));
      float across = fbm(vec2(px.x / (u_fibres * 0.08), px.y / u_fibres));
      float tooth = hash(floor(px * 0.75)) - 0.5;
      float v = (along * 0.6 + across * 0.4 - 0.5) * u_grain + tooth * u_tooth * 0.25;
      outColor = vec4(clamp(mix(u_stock, u_fibre, clamp(v + 0.5, 0.0, 1.0)), 0.0, 1.0), 1.0);
    `,
  },

  // ── Patterns ───────────────────────────────────────────────────────────
  {
    id: 'voronoi',
    name: 'Voronoi',
    category: 'Patterns',
    params: [
      c('cell', 'Cell', '#101828'),
      c('edge', 'Edge', '#7DD3FC'),
      f('scale', 'Scale', 6.0, 1, 30, 0.5),
      f('jitter', 'Jitter', 0.9, 0, 1),
      f('width', 'Edge width', 0.06, 0.005, 0.4),
      f('speed', 'Speed', 0.2, 0, 2),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) * u_scale;
      uv += vec2(u_time * u_speed, 0.0);
      vec2 d = voronoi(uv, u_jitter);
      // the wall is where the nearest two feature points are equally close
      float wall = smoothstep(u_width, 0.0, d.y - d.x);
      outColor = vec4(mix(u_cell, u_edge, wall), 1.0);
    `,
  },
  {
    id: 'metaballs',
    name: 'Metaballs',
    category: 'Patterns',
    params: [
      c('bg', 'Background', '#08030F'),
      c('blob', 'Blob', '#FF4D8D'),
      f('count', 'Count', 5.0, 1, 8, 1),
      f('radius', 'Radius', 0.16, 0.02, 0.5),
      f('speed', 'Speed', 0.35, 0, 2),
      f('threshold', 'Threshold', 1.0, 0.2, 3),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      float t = u_time * u_speed;
      // an inverse-square field summed over the balls: where it crosses the
      // threshold the surfaces merge, which is the whole point of metaballs
      float field = 0.0;
      for (int i = 0; i < 8; i++) {
        if (float(i) >= u_count) break;
        float fi = float(i);
        vec2 centre = vec2(
          0.5 + 0.34 * sin(t * (0.7 + fi * 0.13) + fi * 2.1),
          0.5 + 0.30 * cos(t * (0.9 - fi * 0.07) + fi * 1.3)
        );
        float d = max(length(uv - centre), 1e-4);
        field += (u_radius * u_radius) / (d * d);
      }
      float mask = smoothstep(u_threshold * 0.85, u_threshold * 1.15, field);
      outColor = vec4(mix(u_bg, u_blob, mask), 1.0);
    `,
  },
  {
    id: 'dot-grid',
    name: 'Dot Grid',
    category: 'Patterns',
    params: [
      c('bg', 'Background', '#FFFFFF'),
      c('dot', 'Dot', '#111827'),
      f('spacing', 'Spacing', 18.0, 4, 80, 1),
      f('size', 'Dot size', 0.18, 0.02, 0.5),
      f('wave', 'Wave', 0.0, 0, 1),
      f('speed', 'Speed', 0.6, 0, 3),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 cell = fract(gl_FragCoord.xy / u_spacing) - 0.5;
      // the wave breathes the dot size across the surface rather than moving
      // the grid, so the lattice stays put
      float pulse = 1.0 + u_wave * sin(u_time * u_speed * 3.0 - length(uv - 0.5) * 18.0);
      float dot = smoothstep(u_size * pulse, u_size * pulse - 0.06, length(cell));
      outColor = vec4(mix(u_bg, u_dot, dot), 1.0);
    `,
  },
  {
    id: 'spiral',
    name: 'Spiral',
    category: 'Patterns',
    params: [
      c('a', 'Colour 1', '#0B1026'),
      c('b', 'Colour 2', '#FDE68A'),
      f('arms', 'Arms', 6.0, 1, 24, 1),
      f('twist', 'Twist', 3.0, 0, 12),
      f('speed', 'Speed', 0.3, 0, 2),
      f('softness', 'Softness', 0.3, 0.01, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      float r = length(uv);
      float a = atan(uv.y, uv.x);
      // an Archimedean spiral: the band index is the angle plus a term that
      // grows with the radius
      float band = fract((a / 6.2831853 * u_arms) + r * u_twist - u_time * u_speed);
      float edge = smoothstep(0.5 - u_softness, 0.5, band) * smoothstep(0.5 + u_softness, 0.5, band);
      outColor = vec4(mix(u_a, u_b, edge), 1.0);
    `,
  },
  {
    id: 'waves',
    name: 'Waves',
    category: 'Patterns',
    params: [
      c('deep', 'Deep', '#082F49'),
      c('crest', 'Crest', '#7DD3FC'),
      f('waves', 'Waves', 5.0, 1, 20, 1),
      f('amplitude', 'Amplitude', 0.08, 0, 0.4),
      f('speed', 'Speed', 0.6, 0, 3),
      f('thickness', 'Thickness', 0.06, 0.005, 0.3),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      float t = u_time * u_speed;
      float acc = 0.0;
      for (int i = 0; i < 20; i++) {
        if (float(i) >= u_waves) break;
        float fi = float(i);
        float phase = fi * 0.7;
        float y = 0.5 + (fi - u_waves * 0.5) * 0.08
                + sin(uv.x * (4.0 + fi * 0.6) + t + phase) * u_amplitude;
        acc += smoothstep(u_thickness, 0.0, abs(uv.y - y));
      }
      outColor = vec4(mix(u_deep, u_crest, clamp(acc, 0.0, 1.0)), 1.0);
    `,
  },

  // ── Effects ────────────────────────────────────────────────────────────
  {
    id: 'god-rays',
    name: 'God Rays',
    category: 'Effects',
    params: [
      c('sky', 'Sky', '#0A0A12'),
      c('ray', 'Ray', '#FFE9A8'),
      f('cx', 'Source X', 0.5, 0, 1),
      f('cy', 'Source Y', 0.85, 0, 1),
      f('rays', 'Rays', 22.0, 3, 90, 1),
      f('length', 'Length', 0.9, 0.1, 2),
      f('speed', 'Speed', 0.12, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution);
      vec2 d = uv - vec2(u_cx, u_cy);
      float a = atan(d.y, d.x);
      float r = length(d);
      // shafts are noise in the angle, faded by distance from the source
      float shafts = fbm(vec2(a * u_rays, u_time * u_speed));
      float fall = exp(-r / max(u_length, 0.01));
      outColor = vec4(mix(u_sky, u_ray, clamp(shafts * fall * 1.6, 0.0, 1.0)), 1.0);
    `,
  },
  {
    id: 'swirl',
    name: 'Swirl',
    category: 'Effects',
    params: [
      c('a', 'Colour 1', '#1E1B4B'),
      c('b', 'Colour 2', '#F472B6'),
      c('c', 'Colour 3', '#22D3EE'),
      f('strength', 'Strength', 4.0, -12, 12, 0.1),
      f('scale', 'Scale', 3.0, 0.3, 10),
      f('speed', 'Speed', 0.25, 0, 2),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      float r = length(uv);
      // rotate by an amount that falls off with radius: the centre spins, the
      // edge stays, and everything between shears
      uv = rot(u_strength * (0.5 - r) + u_time * u_speed) * uv;
      float v = fbm(uv * u_scale + 0.5);
      vec3 col = mix(u_a, u_b, clamp(v * 1.5, 0.0, 1.0));
      col = mix(col, u_c, clamp(r * 1.4, 0.0, 1.0));
      outColor = vec4(col, 1.0);
    `,
  },
  {
    id: 'smoke-ring',
    name: 'Smoke Ring',
    category: 'Effects',
    params: [
      c('bg', 'Background', '#05050A'),
      c('smoke', 'Smoke', '#C9D6FF'),
      f('radius', 'Radius', 0.3, 0.05, 0.8),
      f('thickness', 'Thickness', 0.12, 0.01, 0.5),
      f('turbulence', 'Turbulence', 0.6, 0, 2),
      f('speed', 'Speed', 0.3, 0, 2),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) - 0.5;
      float t = u_time * u_speed;
      // the ring is a distance band, and the turbulence is fbm read in polar
      // coordinates so the smoke curls around it rather than across it
      float a = atan(uv.y, uv.x);
      float r = length(uv);
      float curl = fbm(vec2(a * 1.6, r * 5.0 - t)) - 0.5;
      float band = abs(r - u_radius + curl * u_turbulence * 0.12);
      float smoke = smoothstep(u_thickness, 0.0, band);
      outColor = vec4(mix(u_bg, u_smoke, smoke), 1.0);
    `,
  },
  {
    id: 'water',
    name: 'Water',
    category: 'Effects',
    params: [
      c('deep', 'Deep', '#05314D'),
      c('caustic', 'Caustic', '#B7F5FF'),
      f('scale', 'Scale', 5.0, 0.5, 20),
      f('speed', 'Speed', 0.4, 0, 2),
      f('sharpness', 'Sharpness', 4.0, 1, 12, 0.1),
    ],
    body: /* glsl */ `
      vec2 uv = uvAspect(gl_FragCoord.xy / u_resolution) * u_scale;
      float t = u_time * u_speed;
      // two counter-moving wave fields; where their crests meet you get the
      // bright web a pool floor shows
      float a = snoise(uv + vec2(t, t * 0.4));
      float b = snoise(uv * 1.31 - vec2(t * 0.7, t));
      float caustic = pow(clamp(1.0 - abs(a - b), 0.0, 1.0), u_sharpness);
      outColor = vec4(mix(u_deep, u_caustic, caustic), 1.0);
    `,
  },
  {
    id: 'pulsing-border',
    name: 'Pulsing Border',
    category: 'Effects',
    params: [
      c('fill', 'Fill', '#0B1026'),
      c('glow', 'Glow', '#22D3EE'),
      f('width', 'Width', 0.06, 0.005, 0.4),
      f('radius', 'Corner radius', 0.08, 0, 0.5),
      f('speed', 'Speed', 1.0, 0, 4),
      f('travel', 'Travel', 1.0, 0, 1),
    ],
    body: /* glsl */ `
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 p = abs(uv - 0.5) - (0.5 - u_radius);
      // a rounded-rectangle distance field, so the glow follows the corners
      float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - u_radius;
      float border = smoothstep(u_width, 0.0, abs(d));
      // the highlight runs around the perimeter rather than blinking on it
      float around = atan(uv.y - 0.5, uv.x - 0.5) / 6.2831853 + 0.5;
      float chase = mix(1.0, 0.35 + 0.65 * pow(fract(around - u_time * u_speed * 0.25), 3.0), u_travel);
      outColor = vec4(mix(u_fill, u_glow, border * chase), 1.0);
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
