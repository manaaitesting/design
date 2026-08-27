import { nodeStyle, styleToCss } from '../document/css';
import { effectLayers, effectsOf } from '../document/effects';
import type { Doc, SceneNode } from '../document/types';
import { compose, SHADER_BY_ID } from '../webgl/shaders';
import type { Token } from '../document/store';

function slug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'node'}-${id.slice(0, 4)}`;
}

function escapeText(text: string): string {
  return text.replace(/[{}]/g, (c) => `{'${c}'}`);
}

function pascal(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  const joined = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `Component${joined}` : joined || 'Component';
}

interface Emitted {
  markup: string;
  css: string;
}

/**
 * Emits the subtree as JSX plus a stylesheet.
 *
 * The style objects come from `nodeStyle` — the very same function the canvas
 * renders with — so the exported component is not an approximation of the
 * design, it is the design.
 */
/**
 * The markup a text node's content becomes.
 *
 * Plain text is the string. Paragraph spacing and lists need the lines to be
 * real blocks first — the same split the canvas makes, so the export and the
 * artboard say the same thing. JSX and HTML disagree about how an inline style
 * is written, so the caller supplies that rather than the two growing apart.
 */
function textMarkup(
  node: SceneNode,
  escape: (value: string) => string,
  inlineStyle: (declarations: Record<string, string | number>) => string,
): string {
  const font = node.font;
  const spacing = font?.paragraphSpacing ?? 0;
  const list = font?.list && font.list !== 'none' ? font.list : null;
  const text = node.text ?? '';
  if (!spacing && !list) return escape(text);

  const lines = text.split('\n');
  const gap = (index: number) => (index && spacing ? ` ${inlineStyle({ marginTop: spacing })}` : '');
  if (!list) {
    return lines.map((line, i) => `<div${gap(i)}>${escape(line)}</div>`).join('');
  }
  const tag = list === 'number' ? 'ol' : 'ul';
  const items = lines.map((line, i) => `<li${gap(i)}>${escape(line)}</li>`).join('');
  return `<${tag} ${inlineStyle({ margin: 0, paddingLeft: '1.4em' })}>${items}</${tag}>`;
}

/** A number variable is published unitless; everything else passes through. */
function tokenCssValue(token: Token): string {
  if (token.type !== 'number') return token.value;
  const match = /-?\d*\.?\d+/.exec(String(token.value));
  return match ? match[0] : token.value;
}

/** Token ids to names, so a bound field exports as the variable it follows. */
function namesOf(tokens: Token[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const token of tokens) names[token.id] = token.name;
  return names;
}

/** `style={{ marginTop: 8 }}` — JSX takes an object. */
function jsxStyle(declarations: Record<string, string | number>): string {
  const body = Object.entries(declarations)
    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : JSON.stringify(value)}`)
    .join(', ');
  return `style={{ ${body} }}`;
}

/** `style="margin-top: 8px"` — HTML takes a declaration block. */
function htmlStyle(declarations: Record<string, string | number>): string {
  const body = Object.entries(declarations)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${name}: ${typeof value === 'number' && value !== 0 ? `${value}px` : value}`;
    })
    .join('; ');
  return `style="${body}"`;
}

export function toReact(rootId: string, doc: Doc, tokens: Token[] = []): Emitted {
  const varNames = namesOf(tokens);
  const rules: string[] = [];
  const usedShaders = new Set<string>();

  const walk = (id: string, depth: number): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const className = slug(node.name, node.id);

    const style = nodeStyle(node, doc, varNames);
    // the root of an export shouldn't be absolutely positioned inside nothing
    if (depth === 0) {
      delete style.position;
      delete style.left;
      delete style.top;
    }
    rules.push(`.${className} {\n${styleToCss(style)}\n}`);

    // Noise, texture, progressive blur and glass paint on their own surface —
    // the canvas draws them as overlay divs, so the export has to as well.
    const layers = effectLayers(effectsOf(node), node.clip);
    layers.forEach((layer, index) => {
      rules.push(`.${className}-fx${index} {\n${styleToCss(layer.style)}\n}`);
    });
    const overlays = layers
      .map((_, index) => `${pad}  <div className="${className}-fx${index}" />`)
      .join('\n');

    if (node.type === 'text') {
      const text = textMarkup(node, escapeText, jsxStyle);
      if (!overlays) return `${pad}<div className="${className}">${text}</div>`;
      return `${pad}<div className="${className}">\n${pad}  ${text}\n${overlays}\n${pad}</div>`;
    }
    if (node.type === 'shader' && node.shader) {
      usedShaders.add(node.shader.id);
      const params = JSON.stringify(node.shader.params);
      return (
        `${pad}<div className="${className}">\n` +
        `${pad}  <Shader id="${node.shader.id}" params={${params}} />\n` +
        `${pad}</div>`
      );
    }
    if (node.children.length === 0) {
      if (!overlays) return `${pad}<div className="${className}" />`;
      return `${pad}<div className="${className}">\n${overlays}\n${pad}</div>`;
    }
    const children = [node.children.map((childId) => walk(childId, depth + 1)).filter(Boolean).join('\n'), overlays]
      .filter(Boolean)
      .join('\n');
    return `${pad}<div className="${className}">\n${children}\n${pad}</div>`;
  };

  const body = walk(rootId, 0);
  const name = pascal(doc[rootId]?.name ?? 'Component');

  const shaderRuntime = usedShaders.size ? emitShaderRuntime([...usedShaders]) : '';
  const stylesheet = rules.join('\n\n') + '\n';
  // only the tokens this subtree actually references — an export shouldn't drag
  // the whole theme along
  const root = emitTokenRoot(stylesheet, tokens);

  const markup = `import './${slug(doc[rootId]?.name ?? 'component', rootId)}.css';
${usedShaders.size ? "import { Shader } from './Shader';\n" : ''}
export function ${name}() {
  return (
${body}
  );
}
${shaderRuntime}`;

  return { markup, css: root + stylesheet };
}

/** Emits `:root { --name: value }` for every token the CSS refers to. */
function emitTokenRoot(css: string, tokens: Token[]): string {
  const used = tokens.filter((token) => css.includes(`var(--${token.name})`));
  if (!used.length) return '';
  // published the same way the canvas publishes them: a number is unitless,
  // and whoever uses it supplies the unit
  const declarations = used
    .map((token) => `  --${token.name}: ${tokenCssValue(token)};`)
    .join('\n');
  return `:root {\n${declarations}\n}\n\n`;
}

/**
 * A self-contained WebGL runtime for the shaders this subtree uses.
 *
 * Emitted alongside the component rather than referenced as a dependency, so
 * the exported code runs with nothing installed.
 */
function emitShaderRuntime(ids: string[]): string {
  const sources = ids
    .map((id) => {
      const def = SHADER_BY_ID.get(id);
      if (!def) return '';
      return `  ${JSON.stringify(id)}: \`${compose(def).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`,`;
    })
    .filter(Boolean)
    .join('\n');

  return `

/* ── Shader.jsx ────────────────────────────────────────────────────────────
   Drop this next to the component above. No dependencies.                  */

const VERTEX = \`#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
\`;

const FRAGMENTS = {
${sources}
};

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Shader({ id, params = {} }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) return;

    const build = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };

    const program = gl.createProgram();
    gl.attachShader(program, build(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, build(gl.FRAGMENT_SHADER, FRAGMENTS[id]));
    gl.linkProgram(program);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const start = performance.now();
    let frame;
    const draw = (now) => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), (now - start) / 1000);
      for (const [key, value] of Object.entries(params)) {
        const loc = gl.getUniformLocation(program, 'u_' + key);
        if (!loc) continue;
        if (typeof value === 'string') gl.uniform3f(loc, ...hexToRgb(value));
        else gl.uniform1f(loc, value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [id, params]);

  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
`;
}

/** Standalone HTML, styles inlined — paste into any page. */
export function toHtml(rootId: string, doc: Doc, tokens: Token[] = []): string {
  const varNames = namesOf(tokens);
  const walk = (id: string, depth: number): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const style = nodeStyle(node, doc, varNames);
    if (depth === 0) {
      delete style.position;
      delete style.left;
      delete style.top;
    }
    const inline = styleToCss(style, '').replace(/\n/g, ' ').trim();
    const overlays = effectLayers(effectsOf(node), node.clip)
      .map((layer) => `${pad}  <div style="${styleToCss(layer.style, '').replace(/\n/g, ' ').trim()}"></div>`)
      .join('\n');

    if (node.type === 'text') {
      const text = textMarkup(node, (value) => value, htmlStyle);
      if (!overlays) return `${pad}<div style="${inline}">${text}</div>`;
      return `${pad}<div style="${inline}">\n${pad}  ${text}\n${overlays}\n${pad}</div>`;
    }
    if (node.type === 'shader') {
      // a GPU surface has no static equivalent — React export carries the GLSL
      return `${pad}<div style="${inline}"><!-- shader: ${node.shader?.id} — export as React for the GLSL --></div>`;
    }
    if (node.children.length === 0) {
      return `${pad}<div style="${inline}">${overlays ? `\n${overlays}\n${pad}` : ''}</div>`;
    }
    const children = [node.children.map((childId) => walk(childId, depth + 1)).filter(Boolean).join('\n'), overlays]
      .filter(Boolean)
      .join('\n');
    return `${pad}<div style="${inline}">\n${children}\n${pad}</div>`;
  };

  const body = walk(rootId, 0);
  const used = tokens.filter((token) => body.includes(`var(--${token.name})`));
  const style = used.length
    ? `\n    <style>:root {\n${used.map((t) => `      --${t.name}: ${t.value};`).join('\n')}\n    }</style>`
    : '';

  return `<!doctype html>
<html>
  <head>${style}
  </head>
  <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#EEEEEE">
${body}
  </body>
</html>
`;
}

export function toJson(rootId: string, doc: Doc): string {
  const collect = (id: string): SceneNode[] => {
    const node = doc[id];
    if (!node) return [];
    return [node, ...node.children.flatMap(collect)];
  };
  return JSON.stringify(collect(rootId), null, 2);
}
