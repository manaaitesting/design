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

The AI assistant (the ✦ button on the toolbar) designs screens from a
description or an attached screenshot when `ANTHROPIC_API_KEY` is set in
`.env.local`; without it, it falls back to a few built-in templates.

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

There are twenty-six of them, across Gradients, Noise, Patterns and Filters —
mesh and radial and grain gradients, colour panels, a heatmap; simplex, Perlin,
neuro and domain-warped noise, paper texture; voronoi, metaballs, dot grid,
spiral, waves; god rays, swirl, smoke ring, water, a pulsing border, liquid
metal, halftone, dithering, fluted glass, film grain, dot orb. A generator named
after simplex or Perlin is one: `src/webgl/glsl.ts` carries real `snoise`,
`gnoise` and cellular `voronoi` beside the cheap value noise, rather than a
rename of it.

A shader is the one thing here that cannot fail loudly — a program that does not
compile paints nothing, and a layer that paints nothing looks exactly like one
nobody has styled yet. TypeScript sees a template string, so `tests/shaders`
compiles and links the whole catalogue in a real WebGL2 context and asserts on
the driver's own info log.

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

**And sharing does not require an account.** Inviting by email is the strong
form — it names a person and survives the link being passed on — but it cannot
reach anyone who has not signed up, which is most of the people a design needs
to be seen by. So a file also carries a `link_role`: nothing, view, or edit for
anyone holding the URL. A visitor with no account is given a guest identity in
`proxy.ts` (a server component may read cookies but not set them), and from
there they are an ordinary member: the same signed handshake, the same role
inside the signature, the same write-drop on a viewer's socket. The cookie
carries no authority at all — forging it buys a different avatar. A membership
row always outranks the link, so a view-only link never demotes an invited
editor.

**Folders and search.** The dashboard filters in SQL rather than in the page,
because the list is the thing that grows. Folders are flat and belong to the
owner: a folder is a way of looking at your own files, not a permission
boundary, so a file shared with you stays visible whatever its owner filed it
under, and deleting a folder empties it rather than taking the files down. The
controls are a GET form, so the view you are looking at is a URL you can send
yourself.

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
| Tailwind | the same component with utility classes instead of a stylesheet |
| HTML | one self-contained file with styles inlined, shaders included |
| JSON | the raw scene graph |
| PNG | rasterised at 1–4x through an SVG `foreignObject` |
| SVG | the same serialisation, saved as vector |

PNG and SVG work because the canvas is real DOM: the node is cloned, its WebGL
surfaces are frozen to snapshots, its theme variables are re-declared on the
wrapper, and the browser renders it. There is no second renderer to drift.

**Tailwind is a rewriting of the React export, not a fourth walk of the
document.** `toReact` already emits one rule per layer from `nodeStyle()`, so
that CSS *is* the design; re-walking the tree would mean a second opinion about
what a layer looks like, and two opinions is how an exporter drifts. Each
generated rule becomes a class list and is spliced back into the same markup.

The mapping is total, which is the property that matters — an export that
silently loses a declaration produces code that looks fine and renders wrong.
Properties with an idiomatic utility get one (`flex-col`, `gap-3`, `p-5`,
`rounded-xl`); the type scale is kept separate from the spacing scale, because
`text-6` does not exist and 24px is `text-2xl`; an off-scale length becomes
`gap-[13px]` rather than being rounded to a lie; a variable stays a variable as
`bg-[var(--brand)]`; and anything with no utility at all becomes an arbitrary
property, `[mask-image:url(#a)]`, which Tailwind accepts. Only what cannot live
on an element — the font `@import`s and the `:root` block — is left as CSS.
`⌥T` copies the selection this way.

## Tests

```bash
pnpm test          # Playwright, headless
pnpm test:ui       # the same suite, watchable
```

Several suites behind one command, split by what they need rather than by what
they cover.

`geometry` checks the path builders, the boolean kernel, masks and variable
modes directly — no browser, because a boolean that clips the wrong region is
invisible until someone draws exactly the shape that exposes it. `export` does
the same for the exporters, which are functions from a document to a string.
`library` runs the shared library against a scratch database. `sync` drives the
sync server, including the guard that drops a viewer's writes. `mcp` spawns the
MCP server over stdio against a scratch database and asks it to do everything it
advertises — the one surface with no screen to catch a regression on.

`editor` drives the real canvas — pointer sequences and key presses, not unit
tests of internals — because the bugs that actually bit here only appear end to
end: a hug-sized leaf collapsing to 0×0, a held ⌘D burying a layer five frames
deep, snapping fighting the duplicate modifier. It signs in once, then runs
against `/f/testfile00`, a scratch file `pnpm seed` creates for it, and rebuilds
that document from scratch before every test. It never touches the demo file.
Alongside the canvas it covers the things only a browser can answer: the tab
strip, a stranger opening a shared link in a context that has never signed in,
the dashboard's search and folders, dragging a gutter to change a gap, and
compiling all twenty-six shaders on a real GPU.

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
| `write_html` | HTML and CSS in, real layers out — the fast way to build |
| `create_node` · `update_node` · `delete_node` | write to the live document |
| `edit_design` | every other canvas verb, as a list of ops run in order |
| `upload_asset` | an image off disk, placed as a layer |
| `publish_component` · `import_component` | the shared library, from the agent's side |
| `set_variable` | create or update a token |

`edit_design` is the batch tool: group and ungroup, sections, masks, booleans,
flatten, outline stroke, align, distribute, tidy, resize-to-fit, auto layout,
scale, components and instances, component properties, variants, styles,
prototype interactions and flow starts, pages, variables, renames, and
`write_html`. Each op names the nodes it acts on and carries only the fields it needs, and the reply says
what each one did — including the ones it skipped, and why.

### One call, not a hundred

The thing that decides whether an agent is usable on a canvas is not how many
verbs the server has; it is how many round trips one screen costs. A server
whose only way to make a child is "create a node, read back its id, create
another node under it" forces a call per layer, and a login page becomes eighty
calls and eighty model turns. Two things fix that.

**`write_html` — because the canvas already is HTML.** Everything else here
maps a node onto a CSS declaration block; `write_html` reads that mapping
backwards. The markup is laid out in headless Chromium and read back through
`getComputedStyle`, so the cascade, shorthands, inheritance, `em`, `%`, flexbox
and the browser's own default stylesheet are all resolved before a single node
is written — there is no second CSS engine here to disagree with the one the
canvas renders with. A `display: flex` element becomes a real auto layout, an
element of pure text becomes a text layer, an `<img>` becomes an image, and
background, border, radius, opacity, overflow and every `box-shadow` come
across. An agent already knows how to write a card in HTML; letting it send that
is the whole saving. `data-ref` on an element comes back as the id it became, so
the pieces stay addressable without reading the tree back — and those names join
the same ref table below, so a later op in the same call can style `@title`.

**Ops in a batch can see each other.** Any op that creates something takes a
`ref`, and every id field in every later op accepts `"@ref"`:

```jsonc
[{ "op": "add_page",    "ref": "screen", "name": "Signup" },
 { "op": "set_variable","ref": "accent", "name": "accent", "value": "#111827" },
 { "op": "create",      "ref": "form",   "type": "frame", "parentId": "@screen",
   "props": { "w": 360, "h": 280, "fill": "#fff", "radius": 12 } },
 { "op": "create",      "ref": "title",  "type": "text",  "parentId": "@form",
   "props": { "text": "Create account", "font": { "size": 24, "color": "var(--accent)" } } },
 { "op": "auto_layout", "nodeId": "@form", "on": true,
   "flex": { "direction": "column", "gap": 16, "padding": [24, 24, 24, 24] } },
 { "op": "create_component", "ref": "main", "nodeId": "@form" },
 { "op": "create_instance",  "mainId": "@main", "x": 420 },
 { "op": "write_html", "parentId": "@form",
   "css": ".row{display:flex;gap:8px;align-items:center}",
   "html": "<div class=\"row\" data-ref=\"row\"><span>Already have an account?</span></div>" }]
```

That is a page, a variable, a laid-out frame, its contents, a component and an
instance — in one tool call. A ref binds whatever the op produced: a node for
`create`, `group`, `boolean`, `flatten`, `duplicate`; a page for `add_page`; a
style for `create_style`; a prop for `add_component_prop`. The reply ends with
the table of what every ref bound to, so the ids are there for the next call
without a read. A `"@name"` nothing has bound is an error that skips its own op
and says so — it is never passed through as a literal id, which would write
nonsense into the document quietly.

Reading is batched the same way: `get_design_context` takes `nodeIds` and
returns every one of them in a single reply, and `get_metadata` takes a `depth`
so a large file is one cheap call whose cut-off rows say how many children are
still underneath.

`get_design_context` runs the same `nodeStyle()` the canvas renders with, and
`get_screenshot` opens that export in headless Chromium, so what an agent reads
*and what it sees* are what ships — the reason this is more useful than a design
file an agent has to guess at. Code Connect closes the loop: a node mapped to
`src/ui/Card.tsx` is a node the next agent reuses instead of rebuilding.

## Tabs

Across the top of the editor, one tab per open file — paper.design's strip,
which exists because a design session is rarely one file: you are looking at the
marketing page while you build the dashboard, and prompting an agent against
both.

The strip lives in `localStorage`, not in the CRDT: which files *you* have open
is a property of your session, like your panel widths, so two people in the same
room see their own strips. A file joins the strip whenever you land on it —
from a tab, from the file browser, from a pasted link, from the back button — so
it is a true record of where you have been working, and a file that leaves your
account leaves the strip with it rather than lingering as a link to a 404.

Only the file you are looking at has a live document behind it. Switching tabs
is a route change, not nine WebSockets held open — and it still returns you to
the file *as you left it*, because `saveFileView` remembers each file's viewport
and page. A file you have opened before reopens framed where you left it instead
of snapping back to fit-all, which is the whole felt difference between tabs and
a bookmark bar.

| | |
|---|---|
| click a tab | switch to that file |
| the cross, or middle-click | close it — the neighbour takes over, and the last one closed goes back to Files |
| right-click | close, close others, close to the right |
| drag | reorder |
| `+` | a new file, in a new tab |
| `⌥⌘→` `⌥⌘←` | next / previous tab, wrapping |
| `⌥⌘1…8` · `⌥⌘9` | the nth tab · the last one |
| `⌥⌘W` | close the current tab |
| `⌘\` | the strip goes with the rest of the chrome |

Those shortcuts listen in the capture phase and stop the event: the canvas binds
bare arrows to nudge and `⌥⌘`-letters to structural commands on the same window,
and `⌥⌘→` must switch files rather than move a layer ten pixels on its way.

## Auto layout, dragged

Gap and padding are numbers in the Inspector too, and typing 24 into a field is
exact. But spacing is not a number you know in advance — it is one you arrive at
by looking, and a round trip from the artboard to a panel and back breaks the
loop that gets you there. So selecting a flex frame draws a handle in each
gutter between its children and a band inside each padding edge, and dragging
one changes the number.

`src/components/FlexHandles.tsx` computes no layout. The children are real DOM,
so the browser has already decided where the gutters are; this measures them and
turns a pointer delta into `flex.gap` or `flex.padding` through the same
`store.update` the panel calls — so undo, multiplayer and the CRDT come along
unchanged. A zero-width gutter still gets a 7px grab area, because a handle you
cannot hit is not a handle. Negative gap is allowed, since overlapping avatars
and stacked cards are real designs. `⌥` takes the opposite edge with it, as
Figma's does.

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

## Motion

A transition animates the step *between* two frames. A **timeline** animates
what happens *inside* one — Figma Motion's model, and a separate thing from
prototyping, which is why it lives on the frame rather than on an interaction.
`⇧M` opens it on the board the selection is on; the Prototype tab's Motion
section is where you find out a frame has one.

A track drives one property of one layer — X, Y, width, height, rotation,
opacity, corner radius, fill, stroke weight, stroke colour or blur — and a
keyframe pins that property to a value at a moment, carrying its own easing.
The menu is the prototype panel's thirteen: eleven named curves and springs,
each drawn by the same sampler that interpolates it, and two custom ones whose
numbers the panel opens an editor for — a bezier with handles you drag, or a
spring's stiffness, damping and mass.

The list ends where CSS does. Every one of those is something `nodeStyle`
already writes and the browser already interpolates, and the panel greys out
the ones a particular layer cannot honour rather than animating nothing: a
gradient fill (CSS has no interpolation between two gradients), a stroke on a
shape (an SVG attribute rather than CSS), a blur on a layer whose effects list
has no blur in it to drive.

**The timeline compiles to CSS.** Nothing in `src/document/motion.ts`
interpolates anything on the canvas: it emits one `@keyframes` per track and one
rule per layer, and the browser does the rest. That single decision is what
makes the rest fall out —

- **Scrubbing is a negative `animation-delay` on a paused animation.** The
  playhead is one number in one declaration, so dragging it re-renders the
  `<style>` element that carries it and the panel that drew it — and nothing on
  the board. The layers move because the browser moved them.
- **Playing is the same stylesheet, unpaused.** The panel's own playhead is
  walked along by a frame loop that writes to two elements; the design is not
  re-rendered while it runs, because rewriting the stylesheet is exactly what
  would restart what it is following.
- **The export animates.** `toReact` emits the same keyframes against the
  classes it already gives each layer, and `toHtml` marks the animated ones with
  `data-motion` and names them in the head. An exported component animates with
  no runtime behind it, in the same way its layout is the layout and not a
  picture of one.
- **A frame with a timeline plays it in Present**, from the top, every time you
  arrive at it.

One animation per *track* rather than per layer, because a keyframe's easing
belongs to that keyframe: CSS puts `animation-timing-function` inside a keyframe
block, where it governs the segment starting there, and two properties keyed at
the same moment with different curves cannot share a block.

The exception is tracks that land on the same CSS. A stroke's weight and its
colour are two tracks and one `box-shadow`, and two animations naming one
property do not combine — the last one named simply wins, and the other track
would silently do nothing. Those compile into a single animation whose every
stop carries both, built by asking `nodeStyle` what the layer looks like with
both values written onto it. A shape's colour has the opposite problem: a star
paints through a clipped layer *inside* its box, so a fill track there animates
that layer, which both the canvas and the export mark with `data-paint`.

The one place the compiler has to argue with CSS is the ends. A property named
only in the middle of an animation is not held outside those keyframes — the
browser synthesises the missing 0% and 100% from the element's own style and
would tween the layer's design value into the first key. A timeline holds the
first and last key instead, so those two stops are written out. `sampleAt` says
the same thing without a browser in the room, and the suite asserts the two
against each other rather than trusting either.

**Editing is recording.** While the timeline is open, an ordinary property edit
— a drag on the canvas, a field in the inspector, an arrow-key nudge — writes a
keyframe at the playhead as well as to the layer, so the two agree at the moment
you are looking at. That works without a single motion-aware line in the canvas
or the panels: `DocStore` takes a `recorder` the editor installs, and every edit
already funnels through `update`. The red Record button disarms it.

A keyframe drags along its lane and snaps to the ends, to the playhead and to
every other key on the timeline — ⌥ to drop it anywhere, and a key dropped onto
another replaces it. Double-clicking a lane adds a key holding what the track
already read there, so adding one changes nothing until you move it.

⇧ or ⌘ adds a key to the selection and a drag across empty lane space bands
them; dragging any one of a selection moves all of them together. ⌫ removes
them, and the last key of a track takes the track with it. ⌘C and ⌘V copy the
selection and put it down at the playhead, keeping the spacing between the keys
— onto the tracks they came from, so a bounce copied from one layer is a bounce
when it lands. While the panel holds a selection the editor's own ⌫ and
clipboard stand back, because copying a keyframe and copying the layer it sits
on are different things and only one of them was asked for.

The lanes fit the whole duration by default and zoom to sixteen times that —
the buttons in the transport, or ⌘ with the wheel, which holds the moment under
the pointer still while the timeline stretches under it. Zoomed in the lanes
scroll, and the playhead pulls them along as it plays.

Agents get all of it: `edit_design` carries `set_motion`, `set_keyframe` and
`clear_motion`, and `get_motion_context` reports a frame's tracks and keyframes
beside the CSS they compile to.


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
| `⇧⌘E` Export | `⌘L` Copy link to layer | `⇧⌘H` Show/hide | `⇧⌘L` Lock |
| `⌥T` Copy as Tailwind | `⌥⌘→`/`←` Next/prev tab | `⌥⌘W` Close tab | `⇧⌘T` Reopen tab |
| `⌘0` 100% | `⌘1` Zoom to fit | `⌘±` Zoom | `Space`+drag Pan |
| `⌥⌘A` Select matching | `⌘K` Create link | `⌃⌥T` Tidy up | `⌃⌥V`/`⌃⌥H` Distribute |
| `I` Copy colors | `⌥L` Collapse layers | `⇧G` Layout guides | `⌥⇧O` Outlines |
| `⇧'` Pixel grid | `⇧⌘'` Snap to pixel | `⇧C` Comments | `⇧Y` Annotations |
| `⌃⇧P` Pixel preview | `⌘\` Show/hide UI | `⇧E` Measure | `⌥⌘\` Cursors |
| `⇧M` Timeline | `Space` Play (timeline open) | | |

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
| `src/document/motion.ts` | the timeline: its model, its sampler, and the `@keyframes` it compiles to |
| `src/webgl/glsl.ts` | the shared prelude: value, simplex, Perlin and cellular noise |
| `src/webgl/shaders.ts` | GLSL catalogue + typed params |
| `src/export/tailwind.ts` | the React export, rewritten as utility classes |
| `src/state/tabs.ts` | the open-file strip, per browser |
| `src/components/FileTabs.tsx` | the tab strip itself |
| `src/components/FlexHandles.tsx` | on-canvas gap and padding drags |
| `proxy.ts` | the guest identity a link visitor arrives with |
| `src/export/raster.ts` | PNG / SVG rendering via foreignObject |
| `src/components/Comments.tsx` | comment pins and threads |
| `src/components/Shape.tsx` | shapes and boolean groups, as clipped layers |
| `src/components/VectorEdit.tsx` | anchors, handles, point editing |
| `src/components/Rulers.tsx` | rulers and the guides dragged off them |
| `src/components/Inspect.tsx` | the handoff panel |
| `src/components/Palette.tsx` | quick actions |
| `src/components/TextEditor.tsx` | in-place editing, styled per range |
| `src/components/Timeline.tsx` | the motion panel: playhead, tracks, keyframes, recording |
| `src/components/MotionStyle.tsx` | a frame's timeline as a live stylesheet |
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
