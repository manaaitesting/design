# Paperlike ↔ Figma parity ledger

This file is the campaign's memory. **Read it at the start of every session and
update it at the end of every session.** It outlives compaction; nothing else here does.

## How to use it

- `verdict` is one of `parity` · `partial` · `missing` · `wrong` · `deliberate`.
- **Every row cites `file:line`.** A row without evidence is not a row — delete it
  rather than leave it unsourced.
- "Paperlike today" is established by reading source and running tests. **Never by
  reading `README.md`** — the README is a claim (it says both "twenty-six" and
  "eight" shaders). Where prose and code disagree, the code is the fact.
- A row moves to `parity` only with a commit hash and a passing test name.

## Status

- **Phase 1 (ledger): complete** — 2026-08-30. 116 rows below.
- **Baseline on the day the ledger was written:** `pnpm typecheck` clean;
  `pnpm test` **345 passed, 0 failed** (2.8m, all seven projects).
- **Phase 2 (ranking): complete** — the ranked list is below, kept for the record.
- **Phase 3: the ranked twenty are done.** 19 rows closed with code and tests;
  SV-01 was argued rather than changed. Suite now **366 passed, 0 failed**;
  typecheck clean. Every row below carries its commit and its test name.
- **Next session starts here:** re-read this file, then pick from *Still open*
  near the bottom. Nothing in the top twenty is outstanding.

### What Phase 3 changed

| row | commit | test |
|-----|--------|------|
| C-14 drop reparents into a frame | `ff275cd` | editor: "dropping a layer on a frame makes it a child of that frame", "dragging a layer clear of every frame returns it to the page" |
| C-15 auto-layout child drag reorders | `72973c5` | editor: "dragging a child inside an auto layout reorders it, and leaves the frame alone" |
| C-09 ⌥ resize from centre | `fce8d36` | editor: "⌥ resizes about the centre, so the far edge moves too" |
| C-10 ⇧ proportional resize | `fce8d36` | editor: "⇧ keeps the proportion on an edge handle, not only a corner", "⇧ on a corner keeps the opposite corner pinned" |
| S-06 ⇧ marquee adds | `d770604` | editor: "a ⇧ marquee adds to the selection instead of replacing it" |
| S-05 marquee measures the DOM | `d770604` | editor: "a marquee inside a frame you have drilled into catches the right layers" |
| K-06 ⌘] / ⌘[ | `dfec129` | editor: "⌘] and ⌘[ move a layer one place, not all the way" |
| K-07 opacity digits | `21141fe` | editor: "the digit keys set opacity, and two in a row read as one number" |
| T-13 ⏎ edits a text layer | `c4b9ec6` | editor: "⏎ opens a selected text layer for editing" |
| C-06 ⇧ + wheel pans across | `4caafa6` | editor: "⇧ with the wheel pans across, not down" |
| S-09 select inverse | `04dd72b` | editor: "⇧⌘A selects everything that is not selected" |
| C-08 rotate gesture | `a59cdfa` | editor: "rotation › dragging outside a corner turns the layer" |
| O-02 rotated selection box | `a59cdfa` | editor: "rotation › the size readout reports the layer, not the box around it" |
| O-03 resizing a rotated layer | `a59cdfa` | editor: "rotation › a handle on a turned layer pulls along the layer, not the screen" |
| O-05 group resize modifiers | `a59cdfa` | editor: "⌥ on a multi-selection handle scales about the middle of the group" |
| C-11 resize snapping | `a59cdfa` | editor: "a resize snaps its edge to a sibling, as a move does" |
| C-16 frame name labels | `013cdc3` | editor: "a frame wears its name on the canvas, and the name selects it" |
| L-05 layers panel search | `0d50814` | editor: "the layers panel searches by name, keeping the chain to each hit" |
| X-05 PDF export | `21b79ec` | editor: "a layer exports as a PDF the size of the layer" |
| SV-01 db seam | — | argued only; see the row |

### Three things Phase 3 turned up that the ledger had wrong

1. **O-04 was not parity.** `startGroupResize` divided canvas-local pixels by the
   zoom and called the result world coordinates, ignoring the pan — so a
   multi-selection scaled about a point that was not on it. Invisible only while
   the canvas sat at the origin, which is why reading the code missed it. Fixed
   in `a59cdfa`; O-04 is now genuinely parity and covered by O-05's test.
2. **The C-10 expectation was mine and it was wrong.** I first asserted that ⇧ on
   an edge handle holds the top edge. It holds the *opposite edge*, which is a
   line rather than a corner, so the cross axis grows evenly either side of it.
   The test was corrected in `a59cdfa`, not the behaviour bent to match it.
   **If a future session finds Figma anchors the top here instead, this is the
   row to revisit** — it is the one place in this campaign where the model of
   Figma was reasoned to rather than known.
3. **`tabs.spec.ts:98` is flaky, and was before this work.** It calls
   `page.goto(DEMO)` and reads the document without the `ready()` guard that the
   file's own docstring says is required, so it can sample the *outgoing* file
   and then look for that file's node id in the new one. It failed once in five
   full runs here and passes in isolation. Left alone deliberately — it is a
   pre-existing test bug, not a behaviour change, and bending it was not mine to
   do. Worth a row of its own.

---

# Phase 2 — ranked open rows

Ordered by **how often a real user hits it per hour**, not by difficulty.
`wrong` outranks `missing` at equal frequency: behaviour that contradicts Figma is
worse than absent behaviour, because the user already trusted it.

| # | row | verdict | why it ranks here |
|---|-----|---------|-------------------|
| 1 | [C-14 drag a layer into another frame](#c-14) | missing | Every layout session. Dropping a layer on a frame must reparent it; here it only changes x/y, so the layer sits visually inside a frame it is not a child of. Silently corrupts the tree. |
| 2 | [C-15 drag an auto-layout child](#c-15) | wrong | Any auto-layout edit. Figma reorders the child; Paperlike drags the whole parent frame away instead. Actively destructive to the thing you were aiming at. |
| 3 | [C-09 ⌥ resize from centre](#c-09) | missing | Constant during sizing. ⌥ is ignored, so the box grows from the opposite edge and has to be re-positioned by hand every time. |
| 4 | [C-10 ⇧ proportional resize](#c-10) | wrong | Constant during sizing. Only fires on corner handles, and on a `nw`/`n`/`w` handle it corrects `h` *after* computing `y`, so the box slides while it scales. |
| 5 | [S-06 ⇧ + marquee](#s-06) | wrong | Every multi-select. Figma adds the marquee'd nodes to the selection; Paperlike replaces it, so a shift-drag silently discards what you already had. |
| 6 | [C-08 rotate by dragging outside a corner](#c-08) | missing | The only way to rotate is to type a number in the panel. The gesture every user reaches for does nothing. |
| 7 | [C-11 resize does not snap](#c-11) | partial | Every sizing gesture. Dragging *moves* snap to siblings and guides; dragging a *handle* snaps to nothing, so edges that should align never quite do. |
| 8 | [K-06 ⌘] / ⌘\[ bring forward / send backward](#k-06) | missing | Frequent in any stacked layout. `store.reorder` only knows `front` and `back`, so single-step z-order does not exist at all. |
| 9 | [K-07 opacity number keys](#k-07) | missing | Frequent. Typing `5` should set 50%. Editor.tsx even *comments* that the bare digits are Figma's opacity shortcuts, then never handles them. |
| 10 | [T-13 ⏎ to edit a selected text layer](#t-13) | missing | Every text edit that starts from the keyboard. ⏎ falls through to `firstChild`, a text layer has none, so nothing happens. |
| 11 | [C-06 ⇧ + wheel pans horizontally](#c-06) | missing | Constant on a mouse. Only `deltaX` pans horizontally, which a wheel mouse never produces. |
| 12 | [O-02 selection box of a rotated layer](#o-02) | wrong | Any rotated layer. `getBoundingClientRect()` returns the axis-aligned box, so the chrome does not match the shape and its handles sit off the corners. |
| 13 | [O-03 resizing a rotated layer](#o-03) | wrong | Any rotated layer. Screen-space `dx/dy` is applied to unrotated `w/h`, so the handle moves the wrong way. |
| 14 | [C-16 frame name labels on canvas](#c-16) | missing | Frequent. Only sections get a canvas label; frames do not, so the click target Figma users aim for to select a board is absent. |
| 15 | [S-05 marquee tests stored geometry](#s-05) | wrong | Also breaks the "canvas is real DOM" invariant. `nodesInBox` reads `node.x/y/w/h` — parent-local and possibly stale — against a world-space box. |
| 16 | [L-05 layers panel search](#l-05) | missing | Frequent in a large file. Assets and Variables each have a search field; Layers has none. |
| 17 | [S-09 select inverse](#s-09) | missing | Occasional but has no workaround at all. |
| 18 | [X-05 PDF export](#x-05) | missing | Occasional, but it is the format handoff asks for and nothing in the README calls it deliberate. |
| 19 | [O-05 multi-selection resize ignores ⇧ and ⌥](#o-05) | missing | Same modifiers as C-09/C-10, on the group path, which is a separate code path. |
| 20 | [SV-01 route components call `db.ts` directly](#sv-01) | partial | Never hit by a user; listed because the goal names it. See the row — the stated invariant is arguably *not* violated, and that argument belongs here rather than in a fix. |

Everything below rank 20 is in the tables; unranked rows are either `parity`,
`deliberate`, or too rare to compete with the twenty above.

---

# Phase 1 — the ledger

## Tools (`ToolRail.tsx`, `Canvas.tsx`, `Editor.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| TL-01 | Move tool `V` | Selects and drags | Same | parity | `Editor.tsx:31`; `Canvas.tsx:581-716` |
| TL-02 | Scale tool `K` | Scales layer *and* its type/radii/strokes | Scales via `store.scaleNodes` against a gesture-start baseline | parity | `Editor.tsx:32`; `Canvas.tsx:546-579`; `store.ts:1922`; test `features.spec.ts:278` |
| TL-03 | Hand tool `H` | Pans | Same, plus middle-drag and Space | parity | `Editor.tsx:33`; `Canvas.tsx:344-360` |
| TL-04 | Frame tool `F` | Draws a frame; click-without-drag offers presets | Draws a frame; click-without-drag makes a 100×100 frame, no preset list | partial | `Editor.tsx:34`; `Canvas.tsx:455-502` (fallback size at `:477`) |
| TL-05 | Shape flyout `R`/`O` + polygon/star | Six shapes behind one button, remembers the last | Same six, remembers the last | parity | `ToolRail.tsx:25-32,127-167`; test `features.spec.ts:18` |
| TL-06 | Line `L` / Arrow `⇧L` | Two-endpoint drag, ⇧ constrains to 45° | Same | parity | `Editor.tsx:45-47`; `Canvas.tsx:415-453`; `constrain45` at `Canvas.tsx:67-78` |
| TL-07 | Pen `P` | Click places a corner, drag pulls handles, click first point closes, ⏎ ends open, ⌫ removes last | All five | parity | `Canvas.tsx:386-412`, key handling `:310-328` |
| TL-08 | Slice `S` | Invisible export region, always outlined | Same | parity | `Editor.tsx:39`; `Overlay.tsx:412-428`; test `features.spec.ts:526` |
| TL-09 | Text `T` | Draws a box or clicks for auto-width, enters edit mode | Same; click gives `wMode/hMode: fit` | parity | `Canvas.tsx:486-499` |
| TL-10 | Comment `C` | Pins a thread | Same | parity | `Editor.tsx:41`; `Canvas.tsx:362-365` |
| TL-11 | Measure `⇧E` | Latches the ⌥ readout | Same, and ⌥ still works unlatched | parity | `Editor.tsx:357-361`; `Canvas.tsx:237-250`; test `features.spec.ts:1539` |
| TL-12 | Annotate | Pins a dev note to a layer | Same, and jumps to the Inspect tab | parity | `Canvas.tsx:369-384`; test `features.spec.ts:1520` |
| TL-13 | Eyedropper / Copy colors `I` | Samples a colour into the selection | Same, via the browser `EyeDropper` | parity | `Editor.tsx:381-385`; `ToolRail.tsx:216-227` |
| TL-14 | Create image / Create SVG | *(no Figma equivalent)* | Deterministic local generation, no model call | deliberate | README "honest limits"; `src/lib/generate.ts` |
| TL-15 | Shaders | *(no Figma equivalent — Figma has shader fills)* | Eight WebGL shaders usable as a fill | deliberate | `src/webgl/shaders.ts`; README |

## Selection (`selection.ts`, `Canvas.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| S-01 | Plain click | Selects the ancestor at the level you are in | Same | parity | `selection.ts:54-76`; test `editor.spec.ts:14` |
| S-02 | Double-click | Descends exactly one level, never to the leaf | Same | parity | `selection.ts:82-103`; test `editor.spec.ts:22` |
| S-03 | ⌘-click | Selects the deepest node under the pointer | Same | parity | `selection.ts:63-66`; `Canvas.tsx:634-639` |
| S-04 | ⇧-click | Adds/removes one node | Same (`toggle`) | parity | `Canvas.tsx:644-647`; `ui.ts:516-521` |
| <a id="s-05"></a>S-05 | Marquee hit test | Tests the *rendered* box | parity | wrong — **fixed `d770604`**. | `Canvas.tsx:620-626`; `selection.ts:132-149` |
| <a id="s-06"></a>S-06 | ⇧ + marquee | Adds the marquee'd nodes to the current selection | parity | wrong — **fixed `d770604`**. | `Canvas.tsx:596-600` and `:621-627` |
| S-07 | ⏎ / Esc / ⇥ tree walking | Into first child / out to parent / next sibling | All three, and ⏎ opens points on a path-capable shape first | parity | `Editor.tsx:296-320`; `selection.ts:106-129` |
| S-08 | ⌘A select all | Selects everything at the level you are in | Same | parity | `Editor.tsx:592-598` |
| <a id="s-09"></a>S-09 | Select inverse | Selects everything *but* the selection | parity | missing — **fixed `04dd72b`**. | no hit for `inverse` in `src/` outside `geometry.ts:1393`, `shaders.ts:478` |
| S-10 | ⌥⌘A select all with same … | Selects visually matching layers | `store.selectMatching` | parity | `Editor.tsx:586-591`; `store.ts:2190`; test `features.spec.ts:1278` |
| S-11 | Locked layers unselectable | Locked layers and their subtrees are untouchable | Same, plus a "this is locked" hint the canvas draws | parity | `selection.ts:18-25,40-46`; `Overlay.tsx:292-321` |

## Canvas gestures (`Canvas.tsx`, `Overlay.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| C-01 | Space to pan | Space *is* the hand tool while held | Same, and the rail lights the hand instead of the armed tool | parity | `Canvas.tsx:207-232`; `ToolRail.tsx:92`; tests `editor.spec.ts:2733-2809` |
| C-02 | Middle-drag pans | Yes | Yes | parity | `Canvas.tsx:344` |
| C-03 | ⌘/⌃ + wheel zooms about the pointer | Yes | Yes, point under cursor pinned | parity | `Canvas.tsx:187-194` |
| C-04 | Trackpad two-finger scroll pans | Yes | Yes | parity | `Canvas.tsx:195-197` |
| C-05 | Zoom limits shared by wheel / keys / menu | One set of limits | One `ZOOM` constant for all three | parity | `ui.ts:372`; test `editor.spec.ts:2851` |
| <a id="c-06"></a>C-06 | ⇧ + wheel pans horizontally | Yes — the only horizontal pan a wheel mouse has | parity | missing — **fixed `4caafa6`**. | `Canvas.tsx:195-197` (no `shiftKey` branch); only `shiftKey` uses in the file are `:424,:597,:644` |
| C-07 | Drag to move, with sibling snapping and ⌘ to bypass | Yes | Yes, edge/centre snapping plus ruler guides; ⌘ bypasses | parity | `Canvas.tsx:668-702`; tests `editor.spec.ts:69,90` |
| <a id="c-08"></a>C-08 | Rotate by dragging just outside a corner handle | Cursor becomes a rotate arc; drag rotates; ⇧ snaps to 15° | parity | missing — **fixed `a59cdfa`**. | `Overlay.tsx:18-27` (eight handles), `:548-567` (only those rendered); field at `Inspector.tsx:2324-2338` |
| <a id="c-09"></a>C-09 | ⌥ resize from centre | Opposite edge moves too | parity | missing — **fixed `fce8d36`**. | `Overlay.tsx:201-221` |
| <a id="c-10"></a>C-10 | ⇧ resize keeps proportion, on every handle | Yes, edges included | parity | wrong — **fixed `fce8d36`**. | `Overlay.tsx:206-219` |
| <a id="c-11"></a>C-11 | Resizing snaps to siblings and guides | Yes | parity | partial — **fixed `a59cdfa`**. | `Overlay.tsx:191-229` and `:135-189`; compare the move path `Canvas.tsx:694-702` |
| C-12 | ⌥-drag duplicates | Leaves a copy, drags the duplicate | Same | parity | `Canvas.tsx:652-659` |
| C-13 | ⌥ hover measures to the layer under the pointer | Yes | Yes, tracked on the window so it appears on keydown | parity | `Canvas.tsx:237-250`; `Measure.tsx` |
| <a id="c-14"></a>C-14 | Dragging a layer over a frame reparents it into that frame | Yes — the frame highlights and the layer becomes its child on drop | parity | missing — **fixed `ff275cd`**. Dropping into an auto-layout frame appends to the end of the flow rather than inserting at the pointer — still open. | `Canvas.tsx:683-715` (only `{x, y}` written); `store.ts:1020,1047`; panel caller `LeftPanel.tsx:179` |
| <a id="c-15"></a>C-15 | Dragging a child *inside* an auto-layout frame reorders it | Yes — the child lifts out and drops between siblings | parity | wrong — **fixed `72973c5`**. A multi-selection inside a layout still moves the container — still open. | `Canvas.tsx:81-85` and `:663`; `isInFlow` at `types.ts:1068-1072` |
| <a id="c-16"></a>C-16 | Every top-level frame shows a clickable name label on the canvas | Yes | parity | missing — **fixed `013cdc3`**. | `Overlay.tsx:450-472` (`sections` only, from `:97`) |
| C-17 | Crop mode: drag pans the picture, not the box | Yes | Same, on the paint or the layer | parity | `Canvas.tsx:507-543`; test `features.spec.ts:691` |
| C-18 | Drop an image file onto the canvas | Places an image layer where dropped | Same, plus paste | parity | `Canvas.tsx:798-821`, `:159-175` |
| C-19 | Pixel grid appears at high zoom only | Yes | Yes, ≥4× | parity | `Canvas.tsx:984-1006` |
| C-20 | Snap to pixel grid toggles whole-pixel drags | Yes | Yes | parity | `Canvas.tsx:706-712`; `ui.ts:178` |
| C-21 | Right-click selects what is under the pointer, then opens the menu | Yes | Same | parity | `Canvas.tsx:822-828` |
| C-22 | New shape drops into the frame under the pointer | Yes | Same, with local-coordinate conversion | parity | `Canvas.tsx:479-485`, `containerAt:1055-1063`, `localOffset:1066-1080` |

## Selection chrome (`Overlay.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| O-01 | Selection outline, name label, size pill, eight handles | Yes | Yes | parity | `Overlay.tsx:489-567` |
| <a id="o-02"></a>O-02 | A rotated layer's chrome is rotated with it | Yes | parity | wrong — **fixed `a59cdfa`**. | `Overlay.tsx:56-70` (esp. `:64`); rotation applied at `css.ts:184` |
| <a id="o-03"></a>O-03 | Resizing a rotated layer follows the handle | Yes | parity | wrong — **fixed `a59cdfa`**. | `Overlay.tsx:201-215` |
| O-04 | Multi-selection scales about the opposite corner | Yes | parity | parity — **fixed `a59cdfa`**. Was wrongly recorded as parity: the anchor ignored the viewport pan. | `Overlay.tsx:135-189` |
| <a id="o-05"></a>O-05 | ⇧ / ⌥ on a multi-selection resize | Proportional / from centre | parity | missing — **fixed `a59cdfa`**. | `Overlay.tsx:149-181` |
| O-06 | Hover highlight | Yes | Yes | parity | `Overlay.tsx:339-351` |
| O-07 | Other people's selections, in their colour and name | Yes | Yes | parity | `Overlay.tsx:234-270` |
| O-08 | Auto-layout gutter/padding handles on canvas | Yes | Yes | parity | `Overlay.tsx:409`; `FlexHandles.tsx`; tests `features.spec.ts:2166-2280` |
| O-09 | "Additional labels" — a size under every frame | Yes | Yes | parity | `Overlay.tsx:476-486`; test `features.spec.ts:1511` |
| O-10 | Dev-status badge on canvas | Yes | Yes | parity | `Overlay.tsx:432-447` |

## Keyboard (`Editor.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| K-01 | Tool letters `V K H F R O L P S T C` | Yes | Same map | parity | `Editor.tsx:30-42` |
| K-02 | ⌘Z / ⇧⌘Z | Undo / redo, one gesture per step | Same; every drag calls `store.commit()` | parity | `Editor.tsx:575-579`; `store.ts:2697-2707`; `Canvas.tsx:1048`; test `editor.spec.ts:108` |
| K-03 | ⌘C / ⌘X / ⌘V / ⇧⌘V | Copy, cut, paste, paste in place | All four; plain text on the clipboard becomes a text layer | parity | `Editor.tsx:510-539`; test `editor.spec.ts:153` |
| K-04 | ⌘D duplicate | Yes | Yes | parity | `Editor.tsx:580-584` |
| K-05 | `]` / `[` bring to front / send to back | Yes | Yes | parity | `Editor.tsx:651-652`; `store.ts:1095-1108`; test `editor.spec.ts:1196` |
| <a id="k-06"></a>K-06 | ⌘] / ⌘\[ bring forward / send backward one step | Yes | parity | 'back'`; there is no single-step path and no key bound. — **fixed `dfec129`**. | missing | `store.ts:1095`; `Editor.tsx:651-652`; menu at `ContextMenu.tsx:395-396` |
| <a id="k-07"></a>K-07 | Digit keys set opacity (`5` → 50%, `55` typed quickly → 55%, `0` → 100%) | Yes | parity | missing — **fixed `21141fe`**. | `Editor.tsx:677-695`; no `opacity` handler in the key effect |
| K-08 | ⌘G / ⇧⌘G group, ungroup | Yes | Yes | parity | `Editor.tsx:542-555` |
| K-09 | ⌥⌘G frame selection | Yes | Yes | parity | `Editor.tsx:326-331` |
| K-10 | ⇧A add auto layout | Yes | Yes | parity | `Editor.tsx:633-638` |
| K-11 | ⌥⌘K create component | Yes | Yes | parity | `Editor.tsx:332-336` |
| K-12 | ⌥⌘U/S/I/E booleans | Yes (Exclude is `E`, not `X`) | Same, matched on `event.code` so ⌥ key-rewriting on macOS does not break it | parity | `Editor.tsx:50-56,337-342` |
| K-13 | ⌘E flatten | Yes | Yes, and opens point editing | parity | `Editor.tsx:417-425` |
| K-14 | ⇧⌘O outline stroke | Yes | Yes | parity | `Editor.tsx:427-432` |
| K-15 | ⌃⌘M use as mask | Yes | Yes | parity | `Editor.tsx:411-415` |
| K-16 | ⌃⌥T / ⌃⌥V / ⌃⌥H tidy up, distribute | Yes | Yes | parity | `Editor.tsx:392-409`; `store.ts:2048,2136`; test `editor.spec.ts:1757` |
| K-17 | ⌥⌘C / ⌥⌘V copy & paste properties | Yes | Yes, style-only key list | parity | `Editor.tsx:433-442`; `actions.ts:20-58`; test `editor.spec.ts:1178` |
| K-18 | ⇧⌘R paste to replace | Yes | Yes | parity | `Editor.tsx:480-493`; test `editor.spec.ts:1287` |
| K-19 | ⇧⌘C copy as PNG | Yes | Yes, with a download fallback where `ClipboardItem` is refused | parity | `Editor.tsx:494-502`; `actions.ts:106-127` |
| K-20 | ⇧H / ⇧V flip | Yes | Yes | parity | `Editor.tsx:503-507` |
| K-21 | ⇧⌘H / ⇧⌘L hide, lock | Yes | Yes | parity | `Editor.tsx:615-624` |
| K-22 | ⌫ / ⌦ delete | Yes | Yes | parity | `Editor.tsx:626-631` |
| K-23 | Arrow nudge 1px, ⇧arrow 10px | Yes | Yes | parity | `Editor.tsx:655-662` |
| K-24 | Nudge reorders inside an auto-layout frame | Yes | No — always writes `x`/`y` | missing | `Editor.tsx:655-662` |
| K-25 | ⇧1 fit, ⇧2 fit selection, ⇧0 100% | Yes | Yes, and also accepts ⌘ | parity | `Editor.tsx:678-695`; tests `editor.spec.ts:2843,2860` |
| K-26 | `+` / `−` zoom about the canvas centre | Yes | Yes | parity | `Editor.tsx:667-676`; `ui.ts:396-401`; test `editor.spec.ts:2823` |
| K-27 | ⌘\ hide UI | Yes | Yes | parity | `Editor.tsx:351-355`; test `features.spec.ts:1451` |
| K-28 | ⇧R rulers, ⇧G layout guides, ⇧C comments, ⇧Y annotations, ⌥⇧O outlines, ⇧' pixel grid, ⇧⌘' snap-to-pixel, ⌥⌘\ cursors, ⌃⇧P pixel preview | Yes | All nine | parity | `Editor.tsx:343-349,443-479` |
| K-29 | ⌥L collapse all layers | Yes | Yes | parity | `Editor.tsx:386-391`; test `features.spec.ts:1430` |
| K-30 | ⇧D dev mode / handoff | Yes | Toggles the Inspect tab | parity | `Editor.tsx:557-562` |
| K-31 | ⌘/ quick actions | Yes | Yes, and ⌘K unless a text layer is selected (where ⌘K is Create link) | parity | `Editor.tsx:243-258`; test `features.spec.ts:650` |
| K-32 | ⇧⌘E export dialog | Yes | Yes | parity | `Editor.tsx:604-608` |
| K-33 | ⇧⌘⏎ present | Yes | Yes | parity | `Editor.tsx:232-236` |
| K-34 | ⌘L copy link to selection/page | Yes | Yes, and `?node=` / `?page=` are honoured on open | parity | `Editor.tsx:362-372` and `:124-153`; test `features.spec.ts:2121` |
| K-35 | Held shortcuts fire once | Yes | Yes — `ONE_SHOT` guard | parity | `Editor.tsx:282-287`; test `editor.spec.ts:125` |
| K-36 | Shortcuts do not fire while typing | Yes | Yes, plus a belt-and-braces `ui.editing` guard | parity | `Editor.tsx:58-62,280,291` |
| K-37 | ⌥T copy as Tailwind | *(Figma has no equivalent)* | Present | deliberate | `Editor.tsx:373-379` |
| K-38 | ⇧⌘K place image | Opens a file picker and places the image | Absent | missing | no `ShiftK`/place-image handler in `Editor.tsx` |
| K-39 | `N` / ⇧N next / previous frame | Zooms to the next frame on the page | Absent | missing | no `KeyN` in `Editor.tsx` |

## Layers panel (`LeftPanel.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| L-01 | Front-most layer listed first | Yes | Yes | parity | test `editor.spec.ts:796` |
| L-02 | Containers ship collapsed, chevron opens | Yes | Yes | parity | `ui.ts:95-103`; test `editor.spec.ts:809` |
| L-03 | Selecting on canvas reveals the row | Yes | Yes — opens every ancestor | parity | `ui.ts:531-538`; test `editor.spec.ts:817` |
| L-04 | ⇧-click range, ⌘-click toggle | Yes | Yes | parity | test `editor.spec.ts:825` |
| <a id="l-05"></a>L-05 | Search layers by name | Yes — a search field at the top of the panel | parity | missing — **fixed `0d50814`**. | `LeftPanel.tsx:818,1211` vs `LayersTree` at `:541`; palette at `Palette.tsx:261` |
| L-06 | Drag a row to restack | Yes | Yes | parity | `LeftPanel.tsx:70-192`; test `editor.spec.ts:839` |
| L-07 | Drop a row onto a frame to reparent | Yes | Yes | parity | `LeftPanel.tsx:179`; test `editor.spec.ts:856` |
| L-08 | A drag carries the whole selection | Yes | Yes | parity | test `editor.spec.ts:873` |
| L-09 | Press inside a multi-selection keeps it until release | Yes | Yes | parity | test `editor.spec.ts:893` |
| L-10 | Double-click a row to rename | Yes | Yes | parity | `LeftPanel.tsx:612` |
| L-11 | Per-row visibility and lock toggles | Yes | Yes | parity | `LeftPanel.tsx:585-748` |
| L-12 | Pages: add, rename, duplicate, delete, reorder; the last page cannot be deleted | Yes | Yes | parity | `LeftPanel.tsx:266-396`; `store.ts:423,441,476`; tests `editor.spec.ts:2603,2636,2654` |
| L-13 | Assets tab: components, drag onto canvas, shared library | Yes | Yes | parity | `LeftPanel.tsx:749-1023`; `Canvas.tsx:803-815`; test `features.spec.ts:456` |

## Inspector — Design tab (`Inspector.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| D-01 | Position X/Y, rotation, flips, rotate 90° | Yes | Yes | parity | `Inspector.tsx:2196-2360` |
| D-02 | Size W/H with hug / fill / fixed, min & max | Yes | Yes | parity | `Inspector.tsx:2436-2736`; test `features.spec.ts:204` |
| D-03 | Constraints | Yes | Yes | parity | `Inspector.tsx:2807-2848`; `constraints.ts`; test `editor.spec.ts:201` |
| D-04 | Auto layout: direction, gap, padding, distribution, wrap, grid, advanced | Yes | Yes | parity | `Inspector.tsx:2850-3160`; tests `editor.spec.ts:2425-2600` |
| D-05 | Absolute position inside an auto-layout frame | Yes | Yes | parity | test `editor.spec.ts:2511` |
| D-06 | Appearance: opacity, blend, corner radius (per-corner), smoothing | Yes | Yes | parity | `Inspector.tsx:3165-3270`; test `editor.spec.ts:1493` |
| D-07 | Fill: swatch + hex + opacity in one row, six paint types, gradient ramp | Yes | Yes | parity | `ui/PaintPicker.tsx`; tests `editor.spec.ts:400,464-775` |
| D-08 | Stroke: weight, per-side weights, style, alignment | Yes | Yes | parity | tests `editor.spec.ts:1505,2396` |
| D-09 | Effects: eight types, per-effect visibility and blend | Yes | Yes | parity | `EffectsSection.tsx`; tests `editor.spec.ts:1587-1755` |
| D-10 | Selection colours | Yes | Yes | parity | `Inspector.tsx:4982` |
| D-11 | Mixed values across a multi-selection | Reads "Mixed", typing settles all | Yes | parity | `Inspector.tsx:139-166`; tests `editor.spec.ts:1842-1962` |
| D-12 | Export section: per-layer settings, suffix, contents-only, preview | Yes | Yes | parity | `Inspector.tsx:5026-5100`; tests `editor.spec.ts:1399-1433,1530` |
| D-13 | Text: font picker over the whole Google Fonts directory, uploaded fonts, variable axes, OpenType | Yes | Yes | parity | `FontPicker.tsx`; `TypeSettings.tsx`; tests `features.spec.ts:599,633` |
| D-14 | Layout grids on a frame | Yes | Yes | parity | test `editor.spec.ts:2352` |
| D-15 | Frame dimension presets (device sizes) | Yes | Yes | parity | test `features.spec.ts:1294` |
| D-16 | Page section: background colour, show in exports | Yes | Yes | parity | `Inspector.tsx:674-726`; test `editor.spec.ts:2704` |

## Inspector — Prototype tab

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| P-01 | Drag a handle from a layer onto a frame to connect | Yes | Yes | parity | `Connections.tsx`; test `editor.spec.ts:950` |
| P-02 | Triggers: click, drag, hover, press, key, after delay, touch variants | Yes | Yes | parity | `Inspector.tsx:1069-1090`; tests `features.spec.ts:1679,1713` |
| P-03 | Actions: navigate, back, overlay, swap, change to, set variable, set variable mode, conditional, video | Yes | Yes | parity | `Inspector.tsx:1315-1520`; tests `features.spec.ts:1553,1585,1861,1949` |
| P-04 | Animations: instant, dissolve, smart animate, move in/out, slide in/out, push | Yes | Yes | parity | test `features.spec.ts:1731` |
| P-05 | Easing incl. custom bezier and spring | Yes | Yes; spring is sampled to a `linear()` curve | parity | `Inspector.tsx:1188-1283`; test `features.spec.ts:2090` |
| P-06 | Scroll behaviour: overflow, position, preserve scroll | Yes | Yes | parity | `Inspector.tsx:1014-1067`; tests `features.spec.ts:1774,2048` |
| P-07 | Flow starting points, named, playable | Yes | Yes | parity | `Inspector.tsx:889-975`; test `editor.spec.ts:970` |
| P-08 | Prototype settings live on the page | Yes | Yes | parity | `Inspector.tsx:977-1012`; test `features.spec.ts:1356` |
| P-09 | Present: device frames, hotspot flash, Escape closes | Yes | Yes | parity | `Present.tsx`; tests `editor.spec.ts:983,1022,1060` |

## Inspector — Inspect tab (`Inspect.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| I-01 | Computed CSS for the selected layer | Yes | Yes, from the same `nodeStyle()` the canvas renders with | parity | `Inspect.tsx:196-242`; test `features.spec.ts:680` |
| I-02 | Spacing to neighbours | Yes | Yes | parity | `Inspect.tsx:161-180,253` |
| I-03 | Variables used by the layer | Yes | Yes | parity | `Inspect.tsx:184-193` |
| I-04 | Dev status (ready / built) and annotations | Yes | Yes | parity | `Inspect.tsx:75-128`; `Overlay.tsx:432-447` |
| I-05 | Code in several languages (iOS/Android) | Figma offers Swift/XML | React / HTML / Tailwind / JSON / CSS only | missing | `ContextMenu.tsx:274-294`; `ExportDialog.tsx:19` |

## Text

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| T-01 | Double-click a text layer to edit, all selected | Yes | Yes | parity | `Canvas.tsx:730-732`; `TextEditor.tsx:69-82` |
| T-02 | Styling per range | Yes | Yes | parity | `document/text.ts`; tests `features.spec.ts:386,399,419` |
| T-03 | Floating bar over a selection | Yes | Yes | parity | `TextEditor.tsx:183-278` |
| T-04 | Auto-width / auto-height / fixed | Yes | Yes | parity | `Canvas.tsx:492` (`wMode/hMode: 'fit'`) |
| T-05 | Paragraph spacing, lists | Yes | Yes | parity | test `editor.spec.ts:2376` |
| T-06 | Text case, decoration, truncation | Yes | Yes | parity | test `editor.spec.ts:1552` |
| T-07 | Text styles | Yes | Yes | parity | test `editor.spec.ts:2227` |
| T-08 | Hyperlink (⌘K) | Yes | Yes, and it reaches the export | parity | `Editor.tsx:243-253`; test `features.spec.ts:1335` |
| T-09 | Escape leaves edit mode keeping the layer selected | Yes | Yes (blur commits) | parity | `TextEditor.tsx:130-136,147-168` |
| T-10 | Paste keeps the model in step | Yes | Yes — diffs the plain text after every change | parity | `TextEditor.tsx:137-146` |
| T-11 | Text on a path | Figma does not have it either | Absent | deliberate | README "honest limits" |
| T-12 | A shader as a text fill | — | Absent | deliberate | README "honest limits" |
| <a id="t-13"></a>T-13 | ⏎ with a text layer selected enters edit mode | Yes | parity | missing — **fixed `c4b9ec6`**. | `Editor.tsx:296-312`; `geometry.ts:499-501` |

## Vectors

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| V-01 | ⏎ / double-click opens point editing | Yes | Yes, on any path-capable shape incl. rect & ellipse | parity | `Editor.tsx:300-304`; `Canvas.tsx:737`; test `features.spec.ts:724` |
| V-02 | Move, lasso, paint, bend, cut, erase sub-tools | Yes | All six, plus shape builder and variable width | parity | `ui.ts:52-60`; `VectorEdit.tsx`; tests `features.spec.ts:807-1034` |
| V-03 | Editing a point converts a parametric shape | Yes | Yes, and it stays parametric until a point moves | parity | test `features.spec.ts:751,1102` |
| V-04 | Per-point corner radius, variable stroke width | Yes | Yes | parity | `Inspector.tsx:2018-2190`; tests `features.spec.ts:926,962` |
| V-05 | Live boolean groups, still editable | Yes | Yes | parity | `store.ts:1459,1515`; test `features.spec.ts:65` |
| V-06 | Flatten, outline stroke | Yes | Yes | parity | `store.ts:1740,1804`; tests `features.spec.ts:130,174` |
| V-07 | Booleans keep béziers | Yes | The kernel flattens curves before combining | deliberate | README "honest limits"; `clipper.ts` |
| V-08 | Masks | Yes | Yes | parity | `store.ts:1529`; test `features.spec.ts:98` |

## Components, variants, properties

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| CP-01 | Create component, instances follow the main | Yes | Yes | parity | `store.ts:2326,2334,2593`; test `editor.spec.ts:177` |
| CP-02 | Overrides survive main changes | Yes | Yes — `markOverridden` | parity | `store.ts:949-966` |
| CP-03 | Detach, reset instance | Yes | Yes | parity | `store.ts:2554,2566` |
| CP-04 | Swap instance | Yes | Yes | parity | `store.ts:2391`; test `editor.spec.ts:1807` |
| CP-05 | Component properties: boolean, text, instance-swap, variant | Yes | Yes | parity | `store.ts:2423-2500`; tests `editor.spec.ts:1963-2101` |
| CP-06 | Combine as variants | Yes | Yes | parity | `store.ts:2502`; test `editor.spec.ts:2117` |
| CP-07 | Publish to a shared library, subscribe, take revisions | Yes | Yes | parity | `store.ts:1654,1680`; `library.spec.ts`; test `features.spec.ts:456` |
| CP-08 | Component descriptions | Yes | Yes | parity | `Inspector.tsx:834-888` |

## Variables and styles

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| VR-01 | Collections and modes | Yes | Yes | parity | `store.ts:528-616`; test `features.spec.ts:298` |
| VR-02 | Bind a numeric field to a variable, detach it | Yes | Yes | parity | `store.ts:724`; tests `editor.spec.ts:2295,2321` |
| VR-03 | Set a mode on a frame, children publish it | Yes | Yes | parity | `store.ts:638`; test `features.spec.ts:298` |
| VR-04 | Scoping | Yes | Yes | parity | `LeftPanel.tsx:483-540` |
| VR-05 | Paint / text / effect / grid styles | Yes | Yes | parity | `store.ts:673-866`; tests `editor.spec.ts:2153-2293` |
| VR-06 | Deleting a style releases its layers without repainting | Yes | Yes | parity | test `editor.spec.ts:2213` |

## Export

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| X-01 | PNG at a chosen scale | Yes | Yes | parity | `ExportDialog.tsx:80-83`; `export/raster.ts` |
| X-02 | SVG | Yes | Yes | parity | `export/raster.ts`; `ContextMenu.tsx:308` |
| X-03 | Code export (React / HTML / Tailwind / JSON) | Figma offers CSS/iOS/Android | Present, and Tailwind rewrites the React output rather than re-walking the document | parity | `export/toCode.ts`; `export/tailwind.ts`; test `editor.spec.ts:222` |
| X-04 | Export suffix, contents-only | Yes | Yes | parity | `ExportDialog.tsx:22-24`; test `editor.spec.ts:1530` |
| <a id="x-05"></a>X-05 | PDF | Yes | partial | missing — **fixed `21b79ec`**. The page is the layer's size in points; the artwork inside is a raster, not vector — see the commit for why. | `types.ts:457` |
| X-06 | Slices export the region under them | Yes | Yes | parity | test `features.spec.ts:526` |
| X-07 | JPG export | Yes | Absent | missing | `types.ts:457` |
| X-08 | One source of style for canvas and export | — | `nodeStyle()` feeds both | parity (invariant) | `document/css.ts`; `export/toCode.ts` |

## Collaboration and file management

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| M-01 | Multiplayer cursors, selections, follow, spotlight | Yes | Yes | parity | `Cursors.tsx`; `Follow.tsx`; `Presence.tsx` |
| M-02 | Cursor chat | Yes | Yes | parity | `CursorChat.tsx`; `ui.ts:310-311` |
| M-03 | Comment threads with replies and resolve | Yes | Yes, and outside the undo scope | parity | `store.ts:868-899`; `Comments.tsx` |
| M-04 | Version history | Yes | Yes, from the sync server's snapshots | parity | `History.tsx`; `server/history.ts`; `snapshots.spec.ts` |
| M-05 | Share to edit / to view, enforced on the socket | Yes | Yes | parity | `server/ws.mjs`; `share.spec.ts` |
| M-06 | Plugin API | Yes | Absent | deliberate | README "honest limits" |
| M-07 | FigJam, Slides | Yes | Absent | deliberate | README "honest limits" |
| M-08 | File tabs: a visited file joins the strip and stays | Yes | Yes | parity | `FileTabs.tsx`; tests `tabs.spec.ts:51,70,81` |
| M-09 | ⌥⌘→/← walk the tab strip, ⇧⌘T reopens the last closed | Yes | Yes, and ⌥⌘→ does not fall through to a nudge | parity | tests `tabs.spec.ts:98,136` |
| M-10 | A reopened file lands where you left it | Yes | Yes — viewport and page remembered per file | parity | `ui.ts:448-496`; `Editor.tsx:158-221`; test `tabs.spec.ts:179` |
| M-11 | File browser: folders, duplication, live thumbnails, members | Yes | Yes | parity | `app/files/page.tsx`; `Thumbnail.tsx`; `dashboard.spec.ts` |

## Architecture / invariants

| id | capability | expected | Paperlike today | verdict | evidence |
|----|-----------|----------|-----------------|---------|----------|
| <a id="sv-01"></a>SV-01 | Only `src/server/db.ts` runs SQL | Route components go through a seam | Neither route component runs SQL — they *import and call* `db.ts` functions directly (`listFiles`, `listFolders`, `listMembers`; `getFileByLink`, `getFileFor`, `listFiles`, `touchFile`). **The stated invariant is therefore not literally violated**; what is unusual is that these two bypass `src/server/actions.ts`. Recording the disagreement rather than "fixing" it, per the campaign rules. | partial | `app/files/page.tsx:4`; `app/f/[room]/page.tsx:9`; seam at `src/server/db.ts`, `src/server/actions.ts` |
| SV-02 | MCP stays batched | `edit_design` runs ops through a ref table; `write_html` builds a screen in one call | Both present | parity | `server/mcp.ts`; `server/mcp-html.ts`; `mcp.spec.ts` |
| SV-03 | Comments outside the undo scope | Yes | Yes | parity | `store.ts:868-899` |
| SV-04 | Curves only in `geometry.ts`, booleans only in `clipper.ts` | Yes | Yes | parity | `document/geometry.ts`; `document/clipper.ts` |
| SV-05 | Selection rules only in `selection.ts` | Yes | Mostly — but `Canvas.tsx` builds the marquee's geometry itself instead of measuring the DOM (see S-05) | partial | `Canvas.tsx:620-626` |

---

## Still open

The ranked twenty are closed. These are what is left, and where a next session
should start. Frequencies are guesses until someone watches a real user.

**Turned up while fixing the twenty — highest confidence, already scoped:**

- **Dropping into an auto-layout frame appends** rather than inserting at the
  pointer. C-14 reparents; the ordering is C-15's model applied to a drop.
  `Canvas.tsx` — the `dropInto` call in the move-drag release.
- **A multi-selection inside an auto layout still moves the container.** C-15
  handles a single flowed child; two or more fall through to the old path.
  `Canvas.tsx` — the `nextSelection.length === 1` guard.
- **`tabs.spec.ts:98` is flaky** — a pre-existing missing `ready()` guard. See
  *Three things Phase 3 turned up* above. A test fix, not a behaviour fix.
- **Group resize mixes coordinate spaces for a nested selection.** `a59cdfa`
  fixed the pan offset, but `source.x` is parent-local while the group box is
  world, so scaling a selection of nested layers is still wrong.
  `Overlay.tsx` — `startGroupResize`.
- **Marquee cannot start inside a frame.** Pressing on a frame's background
  always hits the frame, so there is no way to rubber-band its children even
  after drilling in. `Canvas.tsx` — the `!stack.length` guard.
- **A press on an already-selected nested layer re-selects its artboard.**
  `resolveClick` returns the top-level ancestor without consulting the current
  selection, so dragging a layer you had selected from the panel picks up the
  board instead. `selection.ts:54-76`. Reachable today only via ⌘ or drilling
  in — and a plausible `wrong` row worth ranking high next time.

**From the Phase 1 ledger, unranked and still true:**

- K-24 nudge does not reorder inside an auto layout · K-38 ⇧⌘K place image ·
  K-39 `N` / ⇧N next frame · TL-04 frame-tool presets on a click · I-05 Swift /
  XML in the Inspect tab · X-07 JPG export · SV-01 (argued, not a defect).

**Deliberate — do not fix, argue here if you disagree:** M-06, M-07, T-11, T-12,
V-07, and the four approximate adjustments. All six README limits stand.

## Session log

- **2026-08-30** — Phase 1 and Phase 2 complete. Baseline recorded above: typecheck
  clean, 345/345 tests green. Ledger built from source reading plus the existing
  Playwright suites as evidence.
- **2026-08-30, same session** — the user asked for the whole ranked twenty rather
  than one row at a time, so Phase 3 ran the list end to end: 13 commits, 19 rows
  closed with code, SV-01 argued. Suite 345 → 366 passing, typecheck clean, no
  pre-existing test bent. Three ledger corrections recorded above; the C-10 edge
  anchor is the one place a model of Figma was reasoned to rather than known, and
  is flagged for challenge.
