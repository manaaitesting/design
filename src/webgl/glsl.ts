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
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
