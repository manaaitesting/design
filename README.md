# Paperlike

A code-native design platform with realtime multiplayer, built with Next.js.

The premise, borrowed from [paper.design](https://paper.design): **the canvas
speaks HTML and CSS natively**. There is no proprietary layout model to translate
at export time — the browser's layout engine is the renderer, so what you see on
the artboard and what the exporter emits cannot drift apart.

```bash
pnpm install
cp .env.example .env.local        # then fill in AUTH_SECRET
pnpm seed                         # optional: two demo accounts + a shared file
pnpm dev                          # Next.js on :3000 + sync server on :1234
```

Open <http://localhost:3000>. Sign up, or use the seeded accounts
(`ada@example.com` / `grace@example.com`). Sign in as each in two browser
profiles to see multiplayer.

## How it works

```
┌──────────┬──┬──────────────────────────────┬───────────┐
│  Layers  │T │                              │ Inspector │
│  240px   │o │      infinite canvas         │   281px   │
│          │o │   real DOM, transformed      │           │
│  Pages   │l │   translate(x,y) scale(z)    │  Layout   │
│  Tree    │  │                              │  Flex     │
│          │42│   ┌──────────────┐           │  Shader   │
│          │px│   │  Artboard    │           │  Fill     │
│          │  │   │  display:flex│           │  Export   │
└──────────┴──┴──────────────────────────────┴───────────┘
```

**The document is a CRDT.** `src/document/store.ts` wraps a `Y.Doc`: every node
is a `Y.Map`, children are a `Y.Array<string>`. Concurrent edits merge without a
server arbiter, and `Y.UndoManager` gives per-client undo that never rewinds a
collaborator's work.

**Rendering is real DOM.** `NodeView` emits a `<div>` per node styled by
`nodeStyle()`. Because the nodes are actual elements, selection chrome measures
them with `getBoundingClientRect()` instead of reimplementing flexbox — flowed
children get correct handles for free, and hit-testing is `elementsFromPoint`.

**Export is the same function.** `export/toCode.ts` serialises the *same*
`nodeStyle()` output the canvas rendered. The React component you copy out is
not an approximation of the design; it is the design.

**Shaders are real GPU programs.** `src/webgl/` holds a WebGL2 renderer — one
fullscreen triangle, one fragment shader, and a single shared `requestAnimationFrame`
loop across every instance. Off-screen surfaces stop drawing via
`IntersectionObserver`. Exporting a shader node emits its GLSL alongside a
dependency-free `Shader.jsx` runtime.

**The inspector is Figma's.** Measured from Figma's own right panel and rebuilt
to match: 348px wide, `#F5F5F5` fields at 24px with a 24px glyph gutter, 9px
sub-labels above each field group, 11px/550 section headers that dim to 50% when
empty. Sections and controls follow Figma's inventory — Position (alignment,
distribute, rotation, rotate 90°, flips), Layout (flow, dimensions, resizing,
resize-to-fit, clip), Auto layout, Appearance (opacity, corner radius,
independent corners, blend), Fill, Stroke, Effects, Layout guide, Selection
colors, Export — plus Figma's "apply styles and variables" pickers, wired to
this document's theme tokens.

**Every section paints for real.** Every section paints through `nodeStyle()`:
outline, border (with dash styles), drop and inner shadow, the six CSS filters,
per-corner radius, per-side padding, blend modes, underline and text stroke,
video fills, and layout guides. Nothing in the panel is decorative.

**Theme tokens are CSS custom properties.** They live in the CRDT, publish onto
the canvas root, and any colour field accepts `var(--brand)`. Export emits a
`:root { … }` block containing exactly the tokens that subtree references — the
variable survives instead of being flattened to a hex.

**Accounts are first-class.** `src/server/db.ts` uses Node's built-in SQLite, so
the platform runs with `pnpm install` and nothing else — no native build, no
database server. Passwords are scrypt-hashed; sessions are HMAC-signed cookies.

**History is on disk.** A CRDT merges concurrent edits but does not protect you
from an intentional one — a stray `⌘A` + `⌫` is a perfectly valid update, and
once it syncs the previous state is gone from every peer. Undo is per-client and
dies with the tab. So the sync server keeps a rolling snapshot (every 60s, last
20 per room) under `.data/snapshots/`.

A rolling window alone is not enough: after a wipe the good states rotate out
while the empty ones accumulate, so twenty minutes later there is nothing to go
back to. When a save removes half the document, the server writes the state
*before* it as a `__keep` snapshot that rotation never touches.

Restoring does not copy the file back. A CRDT remembers deletions, so an open
tab still holds the `⌘A` + `⌫` and would re-apply it the moment it reconnects to
a file-swapped server. Instead the snapshot's layers are re-inserted into the
live document along the same path `⌘V` takes — new layers nothing has ever
deleted — which merges cleanly with whoever is connected:

```bash
pnpm snapshots demofile0            # list what is recoverable
pnpm snapshots demofile0 <stamp>    # restore it — no restart, no reload
```

**Sync is self-hosted and authenticated.** `server/ws.mjs` speaks the standard
y-websocket protocol in ~200 lines. It has no cookies and no database, so the
app mints a short-lived HMAC over `userId.fileId.expires` and the server verifies
it — without that, knowing a room id would be enough to join any document.
Documents persist to `.data/<fileId>.bin`.

## Export

| format | what you get |
|---|---|
| React | a component plus a stylesheet, both from `nodeStyle()` |
| HTML | one self-contained file with styles inlined |
| JSON | the raw scene graph |
| PNG | rasterised at 1–4x through an SVG `foreignObject` |
| SVG | the same serialisation, saved as vector |

PNG and SVG work because the canvas is real DOM: the node is cloned, its WebGL
surfaces are frozen to snapshots, its theme variables are re-declared on the
wrapper, and the browser renders it. There is no second renderer to drift.

## Tests

```bash
pnpm test          # Playwright, headless
pnpm test:ui       # the same suite, watchable
```

The suite drives the real canvas — pointer sequences and key presses, not unit
tests of internals — because the bugs that actually bit here only appear end to
end: a hug-sized leaf collapsing to 0×0, a held ⌘D burying a layer five frames
deep, snapping fighting the duplicate modifier. It signs in once, then runs
against `/f/testfile00`, a scratch file `pnpm seed` creates for it, and rebuilds
that document from scratch before every test. It never touches the demo file.

## MCP — the canvas as an agent tool

`server/mcp.ts` exposes the document over the Model Context Protocol. It joins
each file over the *same authenticated socket the editor uses*, so an agent reads
and writes the running document: edits appear on every open canvas immediately
and the CRDT merges them with whatever a human is doing at that moment. No
import/export round trip, no screenshot to interpret.

Register it with any MCP client — `.mcp.json` is checked in for Claude Code:

```bash
pnpm mcp        # or: npx tsx server/mcp.ts
```

| tool | what it does |
|---|---|
| `list_files` | every file, with ids |
| `get_metadata` | the node tree — ids, types, boxes, layout mode |
| `get_design_context` | the node as React + CSS, HTML, or JSON |
| `get_node` | every property of one node |
| `get_variables` | theme tokens |
| `create_node` · `update_node` · `delete_node` | write to the live document |
| `set_variable` | create or update a token |

`get_design_context` runs the same `nodeStyle()` the canvas renders with, so what
an agent reads is what ships — the reason this is more useful than a design file
an agent has to guess at.

## Layout model

Each node carries `wMode` / `hMode` — `fixed` (px), `fit` (`fit-content`), or
`fill` (stretch / `flex: 1 1 0`). A node with a non-null `flex` becomes a flex
container and its children flow; otherwise children are absolutely positioned at
their `x`/`y`. That is the whole model, and it maps one-to-one onto CSS.

## Tools

**Pen** places points; `Enter` finishes an open path, clicking the first point
closes it, `Backspace` removes the last point, `Escape` cancels. Paths render as
real SVG with the Border section acting as the stroke.

**Comment** drops a pin anchored in world space. Threads carry replies, resolve,
and delete, and sync live. They sit in the CRDT but *outside* the undo scope —
`⌘Z` should rewind your design, never someone else's remark.

**Shaders** opens the WebGL catalogue; every tile is the live shader.

## Selecting things

The selection model follows Figma's, because anything else is muscle-memory
friction. `src/document/selection.ts` holds the rules in one place:

| gesture | result |
|---|---|
| click | the ancestor at the level you are currently in |
| double-click | exactly **one** level deeper — never straight to the leaf |
| `⌘`-click | the deepest layer under the pointer |
| `⇧`-click | add to / remove from the selection |
| `Enter` | into the first child · `Escape` out to the parent |
| `Tab` / `⇧Tab` | the next / previous sibling |
| drag on empty canvas | marquee, at the level you are in, by intersection |
| right-click | **Select layer** lists every layer under the pointer |

The container you have drilled into is outlined with a dashed border. Locked
layers — and everything inside them — are skipped by hit-testing entirely.

Multi-selection draws a single bounding box; dragging its handles scales every
member about the opposite corner. `⌥`-drag leaves a copy behind. `⌘G` groups
into a transparent frame that takes the frontmost member's z-position, and
`⇧⌘G` lifts the children back out.

Dragging a flowed child moves the container that positions it, while the
selection stays on the child.

Dragging snaps to the edges and centres of sibling layers and the containing
frame, drawing a red guide across both. Hold `⌘` to ignore snapping — `⌥` is
already taken by drag-to-duplicate, the same split Figma uses. Layers can be dragged in the panel to reorder or
reparent — above, below, or inside another layer.

## Keyboard

| | | | |
|---|---|---|---|
| `V` Move | `H` Pan | `F` Frame | `R` Rectangle |
| `O` Ellipse | `P` Pen | `T` Text | `C` Comment |
| `⇧A` Wrap in flex | `⇧F` Frame selection | `]` Bring to front | `[` Send to back |
| `⌘G` Group | `⇧⌘G` Ungroup | `Tab` Next sibling | `Enter` Enter / `Esc` Exit |
| `⌘Z` / `⇧⌘Z` Undo/redo | `⌘D` Duplicate | `⌘A` Select all | `⌫` Delete |
| `⌘C` Copy | `⌘X` Cut | `⌘V` Paste | `⇧⌘V` Paste in place |
| `⇧⌘E` Export | `⌘L` Copy link | `⇧⌘H` Show/hide | `⇧⌘L` Lock |
| `⌘0` 100% | `⌘1` Zoom to fit | `⌘±` Zoom | `Space`+drag Pan |

Arrows nudge 1px, `⇧`+arrows nudge 10px. `⌘`-scroll zooms at the cursor;
plain scroll pans.

## Layout of the source

| path | what |
|---|---|
| `src/document/types.ts` | the scene graph |
| `src/document/store.ts` | Yjs-backed mutations + undo |
| `src/document/css.ts` | node → CSS (canvas *and* export) |
| `src/document/selection.ts` | Figma's selection rules, in one place |
| `src/webgl/shaders.ts` | GLSL catalogue + typed params |
| `src/export/raster.ts` | PNG / SVG rendering via foreignObject |
| `src/components/Comments.tsx` | comment pins and threads |
| `src/components/VectorShape.tsx` | pen paths → SVG |
| `src/webgl/renderer.ts` | WebGL2 renderer, shared ticker |
| `src/server/db.ts` | accounts and the file index (SQLite) |
| `src/server/auth.ts` | scrypt, session cookies, sync tokens |
| `src/server/actions.ts` | sign-up/in, file CRUD, sharing |
| `src/collab/session.ts` | one authenticated socket per room |
| `src/components/Canvas.tsx` | pan, zoom, draw, select, marquee |
| `src/components/Overlay.tsx` | selection chrome, handles, remote halos |
| `src/components/Inspector.tsx` | per-type property panels |
| `src/export/toCode.ts` | React / HTML / JSON emitters |
| `server/ws.mjs` | authenticated sync server |

## What is real, and what is not

Working end to end: accounts and sessions; the file browser with sharing by
email; multiple pages; theme tokens; the canvas and its layout model; the CRDT
document; authenticated multiplayer (cursors, avatars, remote selection);
undo/redo; the layers tree; every inspector section; in-place text editing; the
pen tool; comment threads; eight WebGL shaders with live parameters; and
React / HTML / JSON / PNG / SVG export.

Two honest limits:

- **Create image / Create SVG** call no model. `lib/generate.ts` produces
  deterministic local gradients and polygons — replace those two functions with
  an endpoint and the tool is done.
- **HTML export skips shaders.** A GPU surface has no static equivalent, so it
  emits a comment pointing at the React export, which carries the GLSL.
