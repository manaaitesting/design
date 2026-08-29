/** Shared GLSL prelude: value noise, fbm, and colour-space helpers. */
export const PRELUDE = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  u_resolution;
uniform float u_time;

out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

/** Normalised pixel coordinates, aspect-corrected on the long edge. */
vec2 uvAspect(vec2 uv) {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  return vec2((uv.x - 0.5) * aspect + 0.5, uv.y);
}

// ── Real noise ───────────────────────────────────────────────────────────
//
// The 'noise' above is value noise — cheap, and visibly square once it is warped
// hard. A generator named after simplex or Perlin has to actually be one, so
// these are the standard constructions rather than a rename of the cheap one.

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

/** 2D simplex noise, in [-1, 1]. */
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/** 2D Perlin gradient noise, in [-1, 1]. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = normalize(vec2(hash(i + vec2(0.0, 0.0)), hash(i + vec2(11.3, 5.1))) * 2.0 - 1.0);
  vec2 gb = normalize(vec2(hash(i + vec2(1.0, 0.0)), hash(i + vec2(12.3, 5.1))) * 2.0 - 1.0);
  vec2 gc = normalize(vec2(hash(i + vec2(0.0, 1.0)), hash(i + vec2(11.3, 6.1))) * 2.0 - 1.0);
  vec2 gd = normalize(vec2(hash(i + vec2(1.0, 1.0)), hash(i + vec2(12.3, 6.1))) * 2.0 - 1.0);
  float va = dot(ga, f - vec2(0.0, 0.0));
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.4;
}

/**
 * Cellular noise: the distance to the nearest feature point and to the second
 * nearest. The gap between them is what draws a cell wall.
 */
vec2 voronoi(vec2 p, float jitter) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbour = vec2(float(x), float(y));
      vec2 point = vec2(hash(cell + neighbour), hash(cell + neighbour + 17.3)) * jitter;
      float d = length(neighbour + point - local);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
