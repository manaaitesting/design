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
│  Layers  │T │      infinite canvas         │ Inspector │
│  Assets  │o │   real DOM, transformed      │  Design   │
│  Theme   │o │   translate(x,y) scale(z)    │  Prototype│
│          │l │                              │  Inspect  │
│  Pages   │  │   ┌──────────────┐           │           │
│  Tree    │42│   │  Artboard    │           │  Shape    │
│          │px│   │  display:flex│           │  Fill     │
│          │  │   └──────────────┘           │  Export   │
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

**Shaders are real GPU programs, and a shader is a paint.** `src/webgl/` holds a
WebGL2 renderer — one fullscreen triangle, one fragment shader, and a single
shared `requestAnimationFrame` loop across every instance. Off-screen surfaces
stop drawing via `IntersectionObserver`.

A shader is not a node type you place; it is a fill any layer can take, next to
solid, gradient and image in the paint picker. On a box it is a surface at the
bottom of the fill stack, under the image paints and under the children. On a
star, a pen path or a boolean group it goes *inside* the clipped layer that
shape already paints through — so the shader fills the shape rather than the box
the shape sits in, and it needs no new renderer to do it. A `shader` node is
just a layer whose only job is to carry one.

Exporting emits the GLSL either way: React gets a dependency-free `Shader.jsx`
runtime beside the component, HTML gets the same programs as a script that finds
each surface by `data-shader` and drives them all from one frame loop.

**The inspector is Figma's.** Measured from Figma's own right panel and rebuilt
to match: 348px wide, `#F5F5F5` fields at 24px with a 24px glyph gutter, 9px
sub-labels above each field group, 11px/550 section headers that dim to 50% when
empty. Sections and controls follow Figma's inventory — Position (alignment,
distribute, rotation, rotate 90°, flips), Layout (flow, dimensions, resizing,
resize-to-fit, clip), Auto layout, Shape (sides, star ratio, arc and donut, the
boolean operation, mask type), Appearance (opacity, corner radius, independent
corners, blend), Variable modes, Fill, Stroke, Effects, Layout guide, Selection
colors, Export — plus Figma's "apply styles and variables" pickers, wired to
this document's variables. Three tabs, as Figma has them: Design, Prototype and
Inspect, the last being the handoff panel — measurements, the variables in play,
and the code, which here is not a translation of the design but the very styles
the canvas rendered with.

**Every section paints for real.** Every section paints through `nodeStyle()`:
outline, border (with dash styles), drop and inner shadow, the six CSS filters,
per-corner radius, per-side padding, blend modes, underline and text stroke,
video fills, and layout guides. Nothing in the panel is decorative.

**There is a real geometry kernel.** `src/document/clipper.ts` answers the one
question four features need — given two regions, what is their union,
intersection, difference or symmetric difference. It cuts every segment at every
crossing, asks of each surviving piece whether a step to either side lands
inside the result, and stitches what is left back into rings. That is what makes
Flatten produce an editable path, what turns a stroke into a shape, what lets a
boolean group be stroked on any side, and what lets a rotated layer take part in
a mask or a boolean at all.

**Shapes are CSS too, not a second renderer.** A polygon, a star, an arc or a
pen path is a `background` clipped to a `path()`, plus one SVG element for the
stroke — so gradients, image paints, blend modes and effects work on a star
exactly as they do on a rectangle, and `src/document/geometry.ts` is the only
place a curve is ever computed.

**Boolean groups are live, and they are set algebra in CSS.** Union is one path
under the non-zero rule; exclude is the same path under even-odd; intersect is a
clip inside a clip; subtract is a clip inside the *complement* of another. The
children keep their own geometry and stay editable, the operation can be changed
after the fact, and the result exports as ordinary markup rather than a baked
outline. Strokes follow the combination: each part's edge is masked by a rule
that keeps only what survived, so no seam shows where two shapes overlap.

**Masks are `clip-path`.** A mask layer shapes the siblings painted above it —
Figma's rule, read off the layer order — and an image used as a luminance mask
becomes `mask-image`. Both survive export, which is the point of doing it this
way rather than compositing onto a hidden canvas.

**Text is styled per range.** A text layer holds a list of runs — a string plus
the handful of properties that may differ within a paragraph — so a bold word
inside a sentence is a run, not a second layer. `text` stays the plain reading of
the layer, which is what search, export and an agent see. The editor keeps the
model in step with `contentEditable` by reading the element's text after every
change and applying the one insertion that explains the difference, which makes
typing, pasting, dictation and drag-and-drop all the same case.

**Variables are CSS custom properties, modes included.** They live in the CRDT
and publish onto the canvas root; a collection gives them modes, and a frame set
to one re-declares those properties on itself so everything inside inherits
them. That is the cascade doing the work, which is why a dark-mode frame keeps
working in the export with no runtime behind it. Export emits a `:root { … }`
block containing exactly the variables that subtree references — the variable
survives instead of being flattened to a hex.

**Components can leave the file.** A component published to the library is
stored as the same payload the clipboard carries, so importing it is a paste.
What lands is a local main that remembers where it came from — instances point
at *that*, which is why a later revision can be taken in one place and reach
every instance at once. See `library_components` in `src/server/db.ts`.

**Accounts are first-class.** `src/server/db.ts` uses Node's built-in SQLite, so
the platform runs with `pnpm install` and nothing else — no native build, no
database server. Passwords are scrypt-hashed; sessions are HMAC-signed cookies.
A file can be shared to edit or to view, and view-only is enforced in two
places: the editor hides its tools, and the sync server — which signs the role
into the handshake token — drops any write that arrives on a viewer's socket. A
modified client gets nowhere.

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

That shelf is in the editor as well as on the command line: **⌥⌘H** opens
Version history, lists every snapshot with what was in it, and restores one into
the live document.

```bash
pnpm snapshots demofile0            # list what is recoverable
pnpm snapshots demofile0 <stamp>    # restore it — no restart, no reload
```

**Sync is self-hosted and authenticated.** `server/ws.mjs` speaks the standard
y-websocket protocol in ~200 lines. It has no cookies and no database, so the
app mints a short-lived HMAC over `userId.fileId.role.expires` and the server
verifies it — without that, knowing a room id would be enough to join any
document, and without the role inside the signature a viewer could simply ask
the socket to accept their edits.
Documents persist to `.data/<fileId>.bin`.

## Export

Export settings live on the layer, as Figma's do, so they sync and survive a
reload; the Export button saves what the rows say rather than opening anything.
A **slice** exports the region it covers rather than itself — the page is what
gets rendered, cropped to the slice.

| format | what you get |
|---|---|
| React | a component plus a stylesheet, both from `nodeStyle()` |
| HTML | one self-contained file with styles inlined, shaders included |
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

Four suites behind one command. `geometry` checks the path builders, the boolean
kernel, masks and variable modes directly — no browser, because a boolean that
clips the wrong region is invisible until someone draws exactly the shape that
exposes it. `library` runs the shared library against a scratch database.
`sync` drives the sync server, including the guard that drops a viewer's writes.
`mcp` spawns the MCP server over stdio against a scratch database and asks it to
do everything it advertises — the one surface with no screen to catch a
regression on.
`editor` drives the real canvas — pointer sequences and key presses, not unit tests of
internals — because the bugs that actually bit here only appear end to
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

The surface is Figma's design server, tool for tool — read a node's context, look
at it, ask what variables and components it is made of, ask how it behaves, map
it to the code that already implements it — plus the direction Figma's cannot go:
this canvas is HTML/CSS all the way down, so an agent can *build*.

Register it with any MCP client — `.mcp.json` is checked in for Claude Code:

```bash
pnpm mcp        # or: npx tsx server/mcp.ts
```

| tool | what it does |
|---|---|
| `whoami` | the identity it edits as, where sync and the index live, who else is here |
| `list_files` | every file, with ids |
| `get_metadata` | the node tree — ids, types, boxes, layout mode |
| `get_design_context` | the node as React + CSS, HTML, or JSON |
| `get_node` | every property of one node |
| `get_screenshot` | a PNG of the node, rendered headlessly from that same export |
| `download_assets` | the render, the source images inside it, and an SVG per vector layer |
| `get_variables` · `get_variable_defs` | the file's variables, or just the ones a subtree uses |
| `get_libraries` · `search_design_system` | what components, styles and variables exist, and where |
| `get_motion_context` | a node's interactions, and the CSS that plays each transition |
| `list_shader_fills` · `get_shader_fill` | the shader generators, and the GLSL behind one |
| `list_shader_effects` · `get_shader_effect` | the Effects list's types and presets, as JSON to paste |
| `get_code_connect_map` · `add_code_connect_map` | which node is already built, and where |
| `create_new_file` | a new file, owned by a real account |
| `create_node` · `update_node` · `delete_node` | write to the live document |
| `edit_design` | every other canvas verb, as a list of ops run in order |
| `upload_asset` | an image off disk, placed as a layer |
| `publish_component` · `import_component` | the shared library, from the agent's side |
| `set_variable` | create or update a token |

`edit_design` is the batch tool: group and ungroup, sections, masks, booleans,
flatten, outline stroke, align, distribute, tidy, resize-to-fit, auto layout,
scale, components and instances, component properties, variants, styles,
prototype interactions and flow starts, pages. Each op names the nodes it acts
on and carries only the fields it needs, and the reply says what each one did —
including the ones it skipped, and why.

`get_design_context` runs the same `nodeStyle()` the canvas renders with, and
`get_screenshot` opens that export in headless Chromium, so what an agent reads
*and what it sees* are what ships — the reason this is more useful than a design
file an agent has to guess at. Code Connect closes the loop: a node mapped to
`src/ui/Card.tsx` is a node the next agent reuses instead of rebuilding.

## Layout model

Each node carries `wMode` / `hMode` — `fixed` (px), `fit` (`fit-content`), or
`fill` (stretch / `flex: 1 1 0`). A node with a non-null `flex` becomes a flex
container and its children flow; otherwise children are absolutely positioned at
their `x`/`y`. That is the whole model, and it maps one-to-one onto CSS.

## Tools

**Shapes** live in a flyout under the rectangle, as Figma's do: rectangle,
ellipse, polygon, star, line and arrow. A polygon is a side count and a star is
a count plus a ratio, so changing one re-draws the shape rather than asking you
to move every vertex; an ellipse takes a start angle, a sweep and a hole, which
is how it becomes an arc or a donut.

**Pen** places points, and dragging as you place one pulls its handles out — a
click is a corner, a drag is a curve. `Enter` finishes an open path, clicking
the first point closes it, `Backspace` removes the last point, `Escape` cancels.

**Point editing** is a mode, entered with `⏎` or a double-click and left with
`Esc`. Drag an anchor to move it, drag a handle to bend the segments either side
of it, `⌥`-drag a handle to break the mirror, `⌥`-click an anchor to switch it
between a corner and a smooth point, click the path to insert one, `⌫` to remove
the selected ones. The layer's box re-fits around the points as they move, so
the outline never drifts out of the thing you can select.

**Boolean groups** — `⌥⌘U` union, `⌥⌘S` subtract, `⌥⌘I` intersect, `⌥⌘E`
exclude — combine the selection without baking it: the parts stay in the group,
stay editable, and the operation can be changed from the panel afterwards.
`⌘E` **flattens** one into a single editable path when you want the other kind,
and `⇧⌘O` **outlines a stroke** into a filled shape. Both go through the
geometry kernel, so a flattened subtract really does have the bite taken out of
it and an outlined ring really is a ring with a hole.

**Masks** (`⌃⌘M`) turn the selection into a mask for the layers above it, and
drop it to the bottom of its parent where a mask belongs.

**Scale** (`K`) resizes a layer *and* everything inside it — type sizes, corner
radii, stroke weights, padding and gaps all move together, which is the
difference between scaling a card and stretching it.

**Slice** (`S`) marks a region to export. It paints nothing — the dashed outline
is editor chrome — and exporting it saves whatever is underneath, cropped to the
box, which is the whole point of it.

**Rulers** (`⇧R`) run down the top and left edges; drag off one for a guide,
drag a guide back onto a ruler to remove it. Guides live on the page in the CRDT
and snap like any other edge. Hold `⌥` over a layer and the distance from the
selection to it is drawn, the way Figma measures.

**Comment** drops a pin anchored in world space. Threads carry replies, resolve,
and delete, and sync live. They sit in the CRDT but *outside* the undo scope —
`⌘Z` should rewind your design, never someone else's remark.

**Shaders** opens the WebGL catalogue; every tile is the live shader.

**Quick actions** (`⌘/` or `⌘K`) is every command by name and every layer by
name in one list — run the command, or jump the viewport to the layer.

## Working together

Cursors, avatars and remote selection have always been here. On top of them:

**Follow** someone by clicking their avatar — your viewport tracks theirs, and
because their window is not yours it is the *centre* that is matched, at a zoom
that fits what they can see. Click your own avatar to **spotlight** yourself and
everyone else is pulled along behind you. Two people following each other is
detected and refused rather than left to oscillate.

**Cursor chat** is `/`: type, and what you write rides beside your pointer for
everyone until you clear it. It deliberately leaves no trace — a remark that
should outlive the moment is a comment.

**Comments** understand `@name`: mentions are picked out in the thread, and a
pin that names you is ringed.

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
| `⌥⌘A` | **Select matching layers** — every layer on the page painted like this one |

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

## Prototyping

An interaction is a trigger, an action and a transition, carried by the layer
that is touched — so a button keeps its behaviour wherever it is copied to. The
triggers are click, drag, hover, press, key, mouse enter, mouse leave, mouse
down, mouse up and after-delay — the last three renamed to tap and touch on a
touch device, as Figma does; the actions are navigate, change to another
variant, back, open / close / swap overlay, scroll to, set a variable, set a
variable *mode*, open a link, and none; the transitions are instant,
dissolve, smart animate, move in, push and slide, each with a direction, a
duration and an easing.

Overlays are drawn over the frame you were on, positioned where the interaction
says, optionally dimming what is behind and dismissing on a click outside.
"Conditional" is an if / else-if / else list: each branch carries an expression
over the variables and its own actions, and the first branch that holds is the
one that runs. The expression language is small on purpose — comparisons joined
by `and`/`or`/`not`, with `$Name` for a variable — and total, so a condition
that will not parse is false rather than an error mid-run.

A video layer can be driven from a prototype too: "Play/Pause animation" takes
a behaviour of toggle, play or pause, and "Set playhead" moves it to a second.

A run remembers what a run should remember: where you had scrolled each frame
to, which variants its instances were swapped to, and how far through its videos
had got. Figma's "State" section is how you say to forget — reset the scroll,
the component state or the video — and it applies going back as well as going
forward.

The easing menu is Figma's thirteen: a straight line, seven curves and five
springs. A spring is a simulation rather than a curve, so it is sampled into a
CSS `linear()` — which is also what lets it overshoot and settle instead of
merely arriving.

"Change to" swaps an instance for a sibling variant and "Set variable mode"
puts a collection into one of its modes — both held for the run rather than
written, like the variables, because a run is a rehearsal.

Smart animate is a FLIP: the outgoing frame is measured, the incoming one lays
out, and every layer whose name appears in both is animated from where it used
to be — which is exactly the contract Figma's smart animate has. A variable set
while playing is re-declared on the stage rather than written to the document: a
prototype run is a rehearsal, and it must not leave the design changed.

A frame can scroll while it plays, and a layer inside one can be told to scroll
with the content, stay put, or stick — none of which the canvas honours, because
a board on the canvas is flat however tall its content is.

**Prototype settings** live on the page, as Figma's do: the device the
prototype is meant to be seen on — phone, tablet, laptop, desktop, watch, at
their real sizes — and the colour behind it. They are part of the document
rather than of whoever is playing it, so everyone opening the file plays back
the same thing; the picker in Present's own toolbar overrides it for one run.

A text layer can carry a hyperlink (`⌘K`). It is a property of the layer, so it
survives everything the layer does: the export writes it as an `<a href>`, and
a click while presenting follows it.

`⇧⌘⏎` plays it. Present renders the same `NodeView` tree the canvas draws, so
there is no second renderer to drift.

## Keyboard

| | | | |
|---|---|---|---|
| `V` Move | `K` Scale | `H` Pan | `F` Frame |
| `R` Rectangle | `O` Ellipse | `L` Line | `⇧L` Arrow |
| `P` Pen | `T` Text | `C` Comment | `⏎` Edit points |
| `⌥⌘U` Union | `⌥⌘S` Subtract | `⌥⌘I` Intersect | `⌥⌘E` Exclude |
| `⌃⌘M` Use as mask | `⌘E` Flatten | `⇧⌘O` Outline stroke | `S` Slice |
| `⇧R` Rulers | `⌥` hover Measure | `/` Cursor chat | `⇧D` Inspect |
| `⇧A` Wrap in flex | `⇧F` Frame selection | `]` Bring to front | `[` Send to back |
| `⌘G` Group | `⇧⌘G` Ungroup | `Tab` Next sibling | `Enter` Enter / `Esc` Exit |
| `⌘Z` / `⇧⌘Z` Undo/redo | `⌘D` Duplicate | `⌘A` Select all | `⌫` Delete |
| `⌘C` Copy | `⌘X` Cut | `⌘V` Paste | `⇧⌘V` Paste in place |
| `⌘/` Quick actions | `⇧D` Inspect | `⌥⌘H` Version history | `⇧⌘⏎` Present |
| `⇧⌘E` Export | `⌘L` Copy link | `⇧⌘H` Show/hide | `⇧⌘L` Lock |
| `⌘0` 100% | `⌘1` Zoom to fit | `⌘±` Zoom | `Space`+drag Pan |
| `⌥⌘A` Select matching | `⌘K` Create link | `⌃⌥T` Tidy up | `⌃⌥V`/`⌃⌥H` Distribute |
| `I` Copy colors | `⌥L` Collapse layers | `⇧G` Layout guides | `⌥⇧O` Outlines |
| `⇧'` Pixel grid | `⇧⌘'` Snap to pixel | `⇧C` Comments | `⇧Y` Annotations |
| `⌃⇧P` Pixel preview | `⌘\` Show/hide UI | `⇧E` Measure | `⌥⌘\` Cursors |

Arrows nudge 1px, `⇧`+arrows nudge 10px. `⌘`-scroll zooms at the cursor;
plain scroll pans.

## Layout of the source

| path | what |
|---|---|
| `src/document/types.ts` | the scene graph |
| `src/document/store.ts` | Yjs-backed mutations + undo |
| `src/document/css.ts` | node → CSS (canvas *and* export) |
| `src/document/geometry.ts` | paths, parametric shapes, boolean set algebra |
| `src/document/clipper.ts` | the geometry kernel: polygon booleans and offsets |
| `src/document/text.ts` | styled runs, and the range operations over them |
| `src/document/adjust.ts` | image adjustments, as CSS and as an SVG filter |
| `src/document/mask.ts` | which layers a mask shapes, and how |
| `src/document/variables.ts` | collections, modes, aliases → custom properties |
| `src/document/selection.ts` | Figma's selection rules, in one place |
| `src/webgl/shaders.ts` | GLSL catalogue + typed params |
| `src/export/raster.ts` | PNG / SVG rendering via foreignObject |
| `src/components/Comments.tsx` | comment pins and threads |
| `src/components/Shape.tsx` | shapes and boolean groups, as clipped layers |
| `src/components/VectorEdit.tsx` | anchors, handles, point editing |
| `src/components/Rulers.tsx` | rulers and the guides dragged off them |
| `src/components/Inspect.tsx` | the handoff panel |
| `src/components/Palette.tsx` | quick actions |
| `src/components/TextEditor.tsx` | in-place editing, styled per range |
| `src/components/Follow.tsx` | observation mode and spotlight |
| `src/components/FontPicker.tsx` | the searchable font menu, and its previews |
| `src/components/TypeSettings.tsx` | Basics / Details / Variable type settings |
| `src/lib/fonts.ts` | the font catalogue, and loading the web faces |
| `src/lib/google-fonts.ts` | every Google family, generated — see `scripts/gen-google-fonts.mjs` |
| `src/webgl/renderer.ts` | WebGL2 renderer, shared ticker |
| `src/server/db.ts` | accounts and the file index (SQLite) |
| `src/server/auth.ts` | scrypt, session cookies, sync tokens |
| `src/server/actions.ts` | sign-up/in, file CRUD, sharing |
| `src/server/history.ts` | reading, comparing and restoring snapshots |
| `src/collab/session.ts` | one authenticated socket per room |
| `src/components/Canvas.tsx` | pan, zoom, draw, select, marquee |
| `src/components/Overlay.tsx` | selection chrome, handles, remote halos |
| `src/components/Inspector.tsx` | per-type property panels |
| `src/export/toCode.ts` | React / HTML / JSON emitters |
| `server/ws.mjs` | authenticated sync server |

## What is real, and what is not

Working end to end: accounts, sessions and sharing (to edit or to view, enforced
on the socket); the file browser with duplication and live thumbnails; multiple
pages; the canvas and its layout model, min and max sizes included; the CRDT
document; authenticated multiplayer with follow, spotlight, cursor chat and
mentions; undo/redo; the layers tree; every inspector section; components,
variants, properties, descriptions — published to a shared library other files
subscribe to and take revisions of; styles; variables with collections, modes,
aliases and scoping; the shape tools and the slice; the pen, with handles and
point editing across several subpaths; live boolean groups, flatten and outline
stroke through a real geometry kernel; masks; the scale tool; rulers, guides and
⌥-measuring; text styled per range, with the whole Google Fonts directory
behind a searchable picker, uploaded fonts, variable axes and OpenType;
image fills with fit, crop, rotation and the seven adjustments; comment threads;
prototyping with overlays, smart animate, scroll behaviour, variables and device
frames; the Assets and Inspect panels, with annotations and dev status; version
history with comparison; quick actions; eight WebGL shaders with live
parameters, usable as a fill on any shape or frame; and React / HTML / JSON /
PNG / SVG export, with the GLSL travelling in the first two.

The honest limits, all of them:

- **No plugin API, no FigJam, no Slides.** Each is a separate product surface
  rather than a missing control: a plugin API needs a sandbox and a permission
  model before it needs an API.
- **No text on a path.** Text is laid out by the browser, and the browser does
  not set type along an arbitrary curve without SVG taking the text away from
  the layout engine everything else here depends on. Figma has no text on a path
  either, for what is probably the same reason.
- **A shader cannot fill text.** Every other layer paints its shader on a canvas
  clipped to its own outline; text has no outline to clip to. `background-clip:
  text` wants an image, and a live GL surface is not one — the honest options are
  a per-frame snapshot or an SVG mask of the glyphs, and neither is the same
  thing as the fill. Text takes a gradient, as it always has.
- **The boolean kernel flattens curves before combining them.** A flattened
  boolean is a polygon at the sampling density the shapes deserved, not a set of
  béziers refitted to the result — which is what every design tool does here,
  and is why *Flatten* on a single ellipse takes the exact path instead.
- **Temperature, tint, highlights and shadows are approximations.** Exposure,
  contrast and saturation are exact CSS filters; the other four are a colour
  matrix and two transfer functions, deliberately gentle. This is a design tool,
  not a darkroom.
- **Create image / Create SVG** call no model. `lib/generate.ts` produces
  deterministic local gradients and polygons — replace those two functions with
  an endpoint and the tool is done.
