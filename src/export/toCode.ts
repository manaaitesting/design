import { nodeStyle, styleToCss } from '../document/css';
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
export function toReact(rootId: string, doc: Doc, tokens: Token[] = []): Emitted {
  const rules: string[] = [];
  const usedShaders = new Set<string>();

  const walk = (id: string, depth: number): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const className = slug(node.name, node.id);

    const style = nodeStyle(node, doc);
    // the root of an export shouldn't be absolutely positioned inside nothing
    if (depth === 0) {
      delete style.position;
      delete style.left;
      delete style.top;
    }
    rules.push(`.${className} {\n${styleToCss(style)}\n}`);

    if (node.type === 'text') {
      return `${pad}<div className="${className}">${escapeText(node.text ?? '')}</div>`;
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
      return `${pad}<div className="${className}" />`;
    }
    const children = node.children.map((childId) => walk(childId, depth + 1)).filter(Boolean).join('\n');
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
  const declarations = used.map((token) => `  --${token.name}: ${token.value};`).join('\n');
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
  const walk = (id: string, depth: number): string => {
    const node = doc[id];
    if (!node || !node.visible) return '';
    const pad = '  '.repeat(depth + 2);
    const style = nodeStyle(node, doc);
    if (depth === 0) {
      delete style.position;
      delete style.left;
      delete style.top;
    }
    const inline = styleToCss(style, '').replace(/\n/g, ' ').trim();

    if (node.type === 'text') {
      return `${pad}<div style="${inline}">${node.text ?? ''}</div>`;
    }
    if (node.type === 'shader') {
      // a GPU surface has no static equivalent — React export carries the GLSL
      return `${pad}<div style="${inline}"><!-- shader: ${node.shader?.id} — export as React for the GLSL --></div>`;
    }
    if (node.children.length === 0) return `${pad}<div style="${inline}"></div>`;
    const children = node.children.map((childId) => walk(childId, depth + 1)).filter(Boolean).join('\n');
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
