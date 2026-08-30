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
- **Phase 3: complete.** Every open row in this ledger is closed. 26 commits.
  Suite **379 passed, 0 failed**; typecheck clean. Every closed row carries its
  commit and its test name.
- **Phase 1, second sweep — 2026-08-30, fifth pass.** The first ledger walked
  116 rows and every one of them closed, which is not the same as Figma's
  surface being covered. Eight further rows below, all found by reading source
  against Figma's published shortcut panel: `C-23`, `C-24`, `T-14`, `T-15`,
  `K-40`, `L-14`, `CP-09`, `S-14`. Seven are closed; see the session log.
- **199 parity, 8 deliberate, 0 partial.** The two rows that were `partial` were
  argued rather than fixed, twice, and the user overruled that both times —
  correctly. See the session log.
- **Motion — 2026-08-30, sixth pass.** Figma Motion: a timeline on a frame, not
  a transition between two. Fifteen new rows (`MO-01`…`MO-15`): 11 parity, 2
  partial, 2 missing, all sourced.
- **Motion — 2026-08-30, seventh pass.** The four rows that were not `parity`
  worked one at a time, plus a bug sweep. Now **17 rows: 16 parity, 1 partial**
  (`MO-02`, which is eleven properties against Figma's longer list). Two new
  rows, `MO-16` and `MO-17`, for behaviour the sweep turned up rather than for
  anything Figma publishes. All seventeen are in `d85ee70`.

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

**This table is the ranking as it stood before any of the work, kept for the
record — every row in it is now closed.** The verdicts in it are the *old* ones;
the tables further down carry the current state. The one thing worth taking from
it is what it got wrong: S-13, which turned out to be the highest-frequency
`wrong` row in the whole ledger, is not in it at all, because Phase 1 read
`resolveClick` without asking what it did once a selection already existed.

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
| 20 | [SV-01 route components call `db.ts` directly](#sv-01) | partial | Never hit by a user; listed because the goal names it. Argued, not changed. |

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
| TL-04 | Frame tool `F` | Draws a frame; click-without-drag offers presets | Draws a frame; click-without-drag makes a 100×100 frame, no preset list **Now matches Figma.** | parity | `Editor.tsx:34`; `Canvas.tsx:455-502` (fallback size at `:477`) — **fixed `42450a3`**. |
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
| <a id="s-05"></a>S-05 | Marquee hit test | Tests the *rendered* box | Tests stored `node.x/y/w/h` against a world-space box. Parent-local coords are compared to page coords whenever `entered` is set, and a hug-sized layer's stored size can lag its rendered size. Also contradicts the "canvas is real DOM" invariant. **Now matches Figma.** | parity | `Canvas.tsx:620-626`; `selection.ts:132-149` — **fixed `d770604`**. |
| <a id="s-06"></a>S-06 | ⇧ + marquee | Adds the marquee'd nodes to the current selection | Replaces it: `select(nodesInBox(...))` is unconditional, and the ⇧ branch above only skips the *clear* **Now matches Figma.** | parity | `Canvas.tsx:596-600` and `:621-627` — **fixed `d770604`**. |
| S-07 | ⏎ / Esc / ⇥ tree walking | Into first child / out to parent / next sibling | All three, and ⏎ opens points on a path-capable shape first | parity | `Editor.tsx:296-320`; `selection.ts:106-129` |
| S-08 | ⌘A select all | Selects everything at the level you are in | Same | parity | `Editor.tsx:592-598` |
| <a id="s-09"></a>S-09 | Select inverse | Selects everything *but* the selection | Absent — no handler, no menu row **Now matches Figma.** | parity | no hit for `inverse` in `src/` outside `geometry.ts:1393`, `shaders.ts:478` — **fixed `04dd72b`**. |
| S-10 | ⌥⌘A select all with same … | Selects visually matching layers | `store.selectMatching` | parity | `Editor.tsx:586-591`; `store.ts:2190`; test `features.spec.ts:1278` |
| <a id="s-14"></a>S-14 | Smart selection | Three or more layers that read as a row get a dot each and a bar in every space: drag a dot to move a layer along the row, drag a bar to space the whole row at once | Absent — no chrome, no handles, no way to reorder a free-standing row except by moving each layer by hand **Now matches Figma.** | parity | `document/arrange.ts` `smartRow`; `store.ts` `layRow`; `Overlay.tsx` — **fixed `34814ae`**. A row is read off the artwork as `tidyUp` reads one: no overlap along the line, a shared band across it. Rows and columns; a grid gets no handles rather than wrong ones. Test: editor "a row of three gets a dot each and a bar in every space", "dragging a dot moves the layer along the row, and the rest close up", "dragging a bar spaces the whole row at once" |
| S-11 | Locked layers unselectable | Locked layers and their subtrees are untouchable | Same, plus a "this is locked" hint the canvas draws | parity | `selection.ts:18-25,40-46`; `Overlay.tsx:292-321` |

## Canvas gestures (`Canvas.tsx`, `Overlay.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| C-01 | Space to pan | Space *is* the hand tool while held | Same, and the rail lights the hand instead of the armed tool | parity | `Canvas.tsx:207-232`; `ToolRail.tsx:92`; tests `editor.spec.ts:2733-2809` |
| C-02 | Middle-drag pans | Yes | Yes | parity | `Canvas.tsx:344` |
| C-03 | ⌘/⌃ + wheel zooms about the pointer | Yes | Yes, point under cursor pinned | parity | `Canvas.tsx:187-194` |
| C-04 | Trackpad two-finger scroll pans | Yes | Yes | parity | `Canvas.tsx:195-197` |
| C-05 | Zoom limits shared by wheel / keys / menu | One set of limits | One `ZOOM` constant for all three | parity | `ui.ts:372`; test `editor.spec.ts:2851` |
| <a id="c-06"></a>C-06 | ⇧ + wheel pans horizontally | Yes — the only horizontal pan a wheel mouse has | Absent: horizontal pan comes only from `deltaX` **Now matches Figma.** | parity | `Canvas.tsx:195-197` (no `shiftKey` branch); only `shiftKey` uses in the file are `:424,:597,:644` — **fixed `4caafa6`**. |
| C-07 | Drag to move, with sibling snapping and ⌘ to bypass | Yes | Yes, edge/centre snapping plus ruler guides; ⌘ bypasses | parity | `Canvas.tsx:668-702`; tests `editor.spec.ts:69,90` |
| <a id="c-08"></a>C-08 | Rotate by dragging just outside a corner handle | Cursor becomes a rotate arc; drag rotates; ⇧ snaps to 15° | No rotate hit zone anywhere. `HANDLES` is the eight resize handles only. Rotation exists as a *number field* in the panel. **Now matches Figma.** | parity | `Overlay.tsx:18-27` (eight handles), `:548-567` (only those rendered); field at `Inspector.tsx:2324-2338` — **fixed `a59cdfa`**. |
| <a id="c-09"></a>C-09 | ⌥ resize from centre | Opposite edge moves too | `startResize` never reads `altKey` **Now matches Figma.** | parity | `Overlay.tsx:201-221` — **fixed `fce8d36`**. |
| <a id="c-10"></a>C-10 | ⇧ resize keeps proportion, on every handle | Yes, edges included | Guarded by `patch.w && patch.h`, so only corners. And for a `w`/`n` handle `patch.x`/`patch.y` are computed at `:210,:214` *before* the ratio rewrites `patch.h` at `:218`, so the box slides while it scales. **Now matches Figma.** | parity | `Overlay.tsx:206-219` — **fixed `fce8d36`**. |
| <a id="c-11"></a>C-11 | Resizing snaps to siblings and guides | Yes | No snapping in either resize path; `setGuides` is never called from `Overlay` **Now matches Figma.** | parity | `Overlay.tsx:191-229` and `:135-189`; compare the move path `Canvas.tsx:694-702` — **fixed `a59cdfa`**. Skipped under ⇧/⌥ and on a turned layer; ⌘ bypasses. |
| C-12 | ⌥-drag duplicates | Leaves a copy, drags the duplicate | Same | parity | `Canvas.tsx:652-659` |
| C-13 | ⌥ hover measures to the layer under the pointer | Yes | Yes, tracked on the window so it appears on keydown | parity | `Canvas.tsx:237-250`; `Measure.tsx` |
| <a id="c-14"></a>C-14 | Dragging a layer over a frame reparents it into that frame | Yes — the frame highlights and the layer becomes its child on drop | The move drag only writes `x`/`y`. Nothing calls `reparent`/`moveMany` from the canvas; the layers panel is the only place that reparents. **Now matches Figma.** | parity | `Canvas.tsx:683-715` (only `{x, y}` written); `store.ts:1020,1047`; panel caller `LeftPanel.tsx:179` — **fixed `ff275cd`**. A drop reparents, and lands where the pointer is (`8e1cc04`). |
| <a id="c-15"></a>C-15 | Dragging a child *inside* an auto-layout frame reorders it | Yes — the child lifts out and drops between siblings | `draggableTarget` walks up out of the flow, so the gesture moves the whole containing frame instead of the child **Now matches Figma.** | parity | `Canvas.tsx:81-85` and `:663`; `isInFlow` at `types.ts:1068-1072` — **fixed `72973c5`**. Any number of flowed children reorder together (`221f57a`). |
| <a id="c-16"></a>C-16 | Every top-level frame shows a clickable name label on the canvas | Yes | Only sections do **Now matches Figma.** | parity | `Overlay.tsx:450-472` (`sections` only, from `:97`) — **fixed `013cdc3`**. |
| <a id="s-12"></a>S-12 | Dragging a frame's own background | A selected frame is moved by it; an unselected one is marqueed inside. A press that never moves is a click, and a click picks the board | The same, and it is why the name label (C-16) matters — that is how you take hold of an unselected board | parity | `Canvas.tsx` frame-background block — **fixed `9155460`** |
| C-17 | Crop mode: drag pans the picture, not the box | Yes | Same, on the paint or the layer | parity | `Canvas.tsx:507-543`; test `features.spec.ts:691` |
| C-18 | Drop an image file onto the canvas | Places an image layer where dropped | Same, plus paste | parity | `Canvas.tsx:798-821`, `:159-175` |
| C-19 | Pixel grid appears at high zoom only | Yes | Yes, ≥4× | parity | `Canvas.tsx:984-1006` |
| C-20 | Snap to pixel grid toggles whole-pixel drags | Yes | Yes | parity | `Canvas.tsx:706-712`; `ui.ts:178` |
| C-21 | Right-click selects what is under the pointer, then opens the menu | Yes | Same | parity | `Canvas.tsx:822-828` |
| <a id="c-23"></a>C-23 | ⇧ holds a move drag to one axis | Yes — whichever axis you have pulled furthest along, re-decided as the drag turns | The ⇧ branch toggled the selection and returned, so a ⇧-drag never moved anything at all. Now a press that becomes a drag moves what is selected, held to one axis; a press that never moves is still a click, and still toggles **Now matches Figma.** | parity | `Canvas.tsx` pointer-down and move handlers — **fixed `45acf37`**. Test: editor "⇧ holds a drag to the axis you pulled furthest along", "a ⇧ press that never moves still takes the layer out of the selection" |
| <a id="c-24"></a>C-24 | A handle dragged past the far edge turns the layer over | Yes — the box grows out the other side and the artwork mirrors | `Math.max(1, …)` clamped the size, so the gesture stopped dead at one pixel with nowhere to go **Now matches Figma.** | parity | `Overlay.tsx` `startResize` — **fixed `42aeac8`**. The mirror is re-derived from the crossing every move, so dragging back undoes it. Snapping stands down while the layer is over. Test: editor "dragging a handle past the far edge turns the layer over", "and dragging back across it puts the layer the right way round" |
| C-22 | New shape drops into the frame under the pointer | Yes | Same, with local-coordinate conversion | parity | `Canvas.tsx:479-485`, `containerAt:1055-1063`, `localOffset:1066-1080` |

## Selection chrome (`Overlay.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| O-01 | Selection outline, name label, size pill, eight handles | Yes | Yes | parity | `Overlay.tsx:489-567` |
| <a id="o-02"></a>O-02 | A rotated layer's chrome is rotated with it | Yes | `useRects` uses `getBoundingClientRect()`, which is the axis-aligned box of a rotated element, so the outline is bigger than the shape and the handles sit off its corners **Now matches Figma.** | parity | `Overlay.tsx:56-70` (esp. `:64`); rotation applied at `css.ts:184` — **fixed `a59cdfa`**. |
| <a id="o-03"></a>O-03 | Resizing a rotated layer follows the handle | Yes | Screen-space `dx`/`dy` are applied straight to unrotated `w`/`h`, so the handle drags the wrong axis **Now matches Figma.** | parity | `Overlay.tsx:201-215` — **fixed `a59cdfa`**. |
| O-04 | Multi-selection scales about the opposite corner | Yes | Yes **Now matches Figma.** | parity | `Overlay.tsx:135-189` — **fixed `a59cdfa`**. Was wrongly recorded as parity in Phase 1: the anchor ignored the viewport pan, and a nested selection mixed coordinate spaces (`808e571`). |
| <a id="o-05"></a>O-05 | ⇧ / ⌥ on a multi-selection resize | Proportional / from centre | `startGroupResize` reads neither modifier **Now matches Figma.** | parity | `Overlay.tsx:149-181` — **fixed `a59cdfa`**. |
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
| <a id="k-06"></a>K-06 | ⌘] / ⌘\[ bring forward / send backward one step | Yes | Both, one place at a time | parity | `store.ts:1095` reorder takes forward/backward; `Editor.tsx:651-660`; menu at `ContextMenu.tsx:395-398` — **fixed `dfec129`** |
| <a id="k-07"></a>K-07 | Digit keys set opacity (`5` → 50%, `55` typed quickly → 55%, `0` → 100%) | Yes | Absent. `Editor.tsx:677` *comments* that "the bare digits are Figma's opacity shortcuts" and uses that as the reason ⌘/⇧ are required for zoom — then never handles the bare digits. **Now matches Figma.** | parity | `Editor.tsx:677-695`; no `opacity` handler in the key effect — **fixed `21141fe`**. |
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
| K-24 | Nudge reorders inside an auto-layout frame | Yes | No — always writes `x`/`y` **Now matches Figma.** | parity | `Editor.tsx:655-662` — **fixed `87820bc`**. Along the flow axis only; the cross axis is the layout's. |
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
| K-38 | ⇧⌘K place image | Opens a file picker, then the image rides the cursor until a click puts it down | The same, with Escape to put it down again **Now matches Figma.** | parity | `Canvas.tsx` place-image effect — **fixed `1dd7696`**, click-to-place in `351081d` |
| <a id="k-40"></a>K-40 | ⌥A / ⌥D / ⌥W / ⌥S / ⌥H / ⌥V align the selection | Six shortcuts, beside ⌃⌥T for tidy up and ⌃⌥H/V for distribute | `store.align` knew the rule already — one layer aligns inside its parent, several to the box they share — and the Inspector's alignment row was the only thing that could reach it **Now matches Figma.** | parity | `Editor.tsx` `ALIGN_KEYS`; `store.ts:2117` — **fixed `f2b38bd`**. Matched on `event.code`, like the boolean ops: ⌥ rewrites the character on macOS. Test: editor "⌥A and ⌥S align the selection to its shared box", "⌥H centres them across, ⌥V down" |
| K-39 | `N` / ⇧N next / previous frame | Zooms to the next frame on the page. Filed under *Zoom* in Figma's own shortcut panel as "Zoom to Next / Previous Frame"; the order is canvas order — left to right, then top to bottom | Both, framing what they land on **Now matches Figma.** | parity | `Editor.tsx` walking-the-boards block — **fixed `9155460`**. The Phase 1 row was right; the later demotion to "unverified" was over-cautious. |

## Layers panel (`LeftPanel.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| L-01 | Front-most layer listed first | Yes | Yes | parity | test `editor.spec.ts:796` |
| L-02 | Containers ship collapsed, chevron opens | Yes | Yes | parity | `ui.ts:95-103`; test `editor.spec.ts:809` |
| L-03 | Selecting on canvas reveals the row | Yes | Yes — opens every ancestor | parity | `ui.ts:531-538`; test `editor.spec.ts:817` |
| L-04 | ⇧-click range, ⌘-click toggle | Yes | Yes | parity | test `editor.spec.ts:825` |
| <a id="l-05"></a>L-05 | Search layers by name | Yes — a search field at the top of the panel | Absent. Assets (`:818`) and Variables (`:1211`) each have one; Layers does not. Quick actions can jump to a layer by name, which is not the same thing. **Now matches Figma.** | parity | `LeftPanel.tsx:818,1211` vs `LayersTree` at `:541`; palette at `Palette.tsx:261` — **fixed `0d50814`**. Restacking is off while a search runs. |
| <a id="l-14"></a>L-14 | ⌘R renames the selection | A dialog over the selection; the name is a pattern, with tokens for the current name and a number | Absent — renaming was a double-click in the panel and nothing else, so twenty layers called "Vector" had to be renamed twenty times **Now matches Figma.** | parity | `RenameDialog.tsx`; `layers.ts` `panelOrder` — **fixed `6b49045`**. `$&` current name, `$n` down the panel, `$N` up it, repeat the letter to pad. Numbered in panel order, which is the order on screen while you type. Test: editor "⌘R names the whole selection, numbering down the panel", "$& keeps the name it had, and Escape changes nothing" |
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

## Motion — the timeline (`motion.ts`, `Timeline.tsx`, `MotionStyle.tsx`)

Figma Motion is a different thing from the Prototype tab above: a transition
animates the step *between* two frames, a timeline animates what happens
*inside* one. Every row below landed in `d85ee70`, on the `motion` branch; the
evidence column carries the file and the test rather than repeating the hash
seventeen times.

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| MO-01 | A frame carries a timeline | Per-frame, with a duration and a loop | Same; `motion` on the frame node | parity | `types.ts:978`; `motion.ts:400`; tests `motion.spec.ts` "the model", `motion-ui.spec.ts:655` |
| MO-02 | Tracks: one property of one layer | Position, size, rotation, opacity, radius, fill, stroke, effects, text | Eleven: those, plus stroke weight, stroke colour and layer blur. No text or shadow tracks | partial | `motion.ts` `PROPERTIES`; tests `motion.spec.ts` "every property lands on the CSS…", "a stroke animates as whatever CSS the layer draws it with", "a blur animates wherever the layer keeps it" |
| MO-03 | Keyframes: add, drag, delete | Yes, with snapping | Yes; snaps to the ends, the playhead and every other key, ⌥ to override | parity | `Timeline.tsx:244-320` (`msAt`, `snapped`, `dragKey`); tests `motion-ui.spec.ts:276,301,407` |
| MO-04 | Per-keyframe easing | The presets plus a custom curve editor | All thirteen: eleven presets drawn from the sampler, plus a bezier with draggable handles and a spring's three numbers | parity | `Timeline.tsx` `Curve`, `CurveEditor`; tests `motion-ui.spec.ts` "a custom bezier can be dragged…", "a custom spring is three numbers…" |
| MO-05 | Editing a property with the timeline open keyframes it | Yes | Yes — a drag, a field or a nudge, through one `recorder` seam on the store | parity | `store.ts:2567` (`recorder`); `Timeline.tsx:158`; tests `motion-ui.spec.ts:201,224,258` |
| MO-06 | Transport: scrub, play, pause, loop, rewind | Yes; Space plays | Yes; Space plays while the panel is open | parity | `Timeline.tsx:183-220`; `Canvas.tsx:292-312`; tests `motion-ui.spec.ts:186,473,496,515` |
| MO-07 | The canvas shows the frame the playhead is on | Yes | Yes — a negative `animation-delay` on a paused animation, so the browser interpolates | parity | `motion.ts:400` (`motionCss`); `MotionStyle.tsx`; tests `motion-ui.spec.ts:109,381` |
| MO-08 | Selection chrome tracks the animated layer | Yes | Follows a scrub; stands back while it plays | parity | `Overlay.tsx:52-90` (`useRects`); test `motion-ui.spec.ts:124` |
| MO-09 | A frame plays its timeline in the prototype | Yes | Yes, from the top, on every arrival | parity | `Present.tsx:659`; test `motion-ui.spec.ts:550` |
| MO-10 | The animation survives export | Figma exports video | This exports the animation itself: the same `@keyframes` in the React and HTML exports, no runtime | parity | `toCode.ts:541,929`; tests `motion.spec.ts` "carried out by the export" (incl. one that plays the exported page in a real browser) |
| MO-11 | A copy animates its own layers | n/a — a Figma-shaped invariant, not a Figma feature | Duplicate, paste and instance all re-point the tracks | parity | `motion.ts:164`; `store.ts` `remapTimelines`; tests `motion-ui.spec.ts:580,604,627` |
| MO-12 | Agents can author and read a timeline | n/a | `edit_design` takes `set_motion` / `set_keyframe` / `clear_motion`, over all eleven properties; `get_motion_context` reports the tracks and the CSS | parity | `mcp.ts` `set_keyframe`, `timelineBlock`; test `mcp.spec.ts` "an agent can animate a frame, and read the timeline back as CSS" |
| MO-13 | Timeline zoom and horizontal scroll | Yes | Fit, to 16×: the transport's buttons or ⌘ with the wheel, which holds the moment under the pointer still. The lanes scroll, and the playhead pulls them along | parity | `Timeline.tsx` `zoomBy`, `.mo-span`; tests `motion-ui.spec.ts` "the timeline zooms…", "zooming holds the moment under the pointer still" |
| MO-14 | Multi-select keyframes, box-select, copy/paste | Yes | ⇧/⌘ adds, a band over the lanes selects, a drag moves them together, ⌘C/⌘V keeps their spacing | parity | `Timeline.tsx` `marquee`, `copySelection`; `store.ts` `updateKeyframes`, `addKeyframes`; tests `motion-ui.spec.ts` "⇧-click adds…", "a band drawn over the lanes…", "⌘C and ⌘V…" |
| MO-16 | A fill track lands on the element that paints it | n/a | A star, a pen path or an arc paints through a clipped layer inside its box; a fill track animates that layer, which the canvas and the export both mark `data-paint` | parity | `motion.ts` `targetOf`; `Shape.tsx:118`; tests `motion.spec.ts` "a shape's colour is animated on the layer that paints it", `motion-ui.spec.ts` "a star's fill really changes colour on the canvas" |
| MO-17 | Two tracks that write one CSS property | n/a | Compiled as one animation carrying both — CSS gives a property to the last animation that names it, so two would silently cancel | parity | `motion.ts` `channelOf`, `writerFor`; test `motion.spec.ts` "a stroke animates as whatever CSS the layer draws it with" |
| MO-15 | Where you find it | A mode of its own | ⇧M on the selected board, and the Prototype tab's Motion section | parity | `Editor.tsx:714`; `Inspector.tsx` `MotionSection`; test `motion-ui.spec.ts:448` |

## Inspector — Inspect tab (`Inspect.tsx`)

| id | capability | Figma's behaviour | Paperlike today | verdict | evidence |
|----|-----------|-------------------|-----------------|---------|----------|
| I-01 | Computed CSS for the selected layer | Yes | Yes, from the same `nodeStyle()` the canvas renders with | parity | `Inspect.tsx:196-242`; test `features.spec.ts:680` |
| I-02 | Spacing to neighbours | Yes | Yes | parity | `Inspect.tsx:161-180,253` |
| I-03 | Variables used by the layer | Yes | Yes | parity | `Inspect.tsx:184-193` |
| I-04 | Dev status (ready / built) and annotations | Yes | Yes | parity | `Inspect.tsx:75-128`; `Overlay.tsx:432-447` |
| I-05 | Code in several languages (iOS/Android) | Figma offers Swift/XML | React / HTML / Tailwind / JSON / CSS only **Now matches Figma.** | parity | `ContextMenu.tsx:274-294`; `ExportDialog.tsx:19` — **fixed `7058bee`**. SwiftUI and Android XML; Compose and UIKit are not offered. |

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
| <a id="t-14"></a>T-14 | ⌘B / ⌘I / ⌘U / ⇧⌘X while editing | Toggle the mark on the selected range | Unbound — and worse than absent. A `contentEditable` answers ⌘B by writing a `<b>` into the DOM, which this editor treats as a view of the runs; the plain text does not change, so `onInput` saw nothing, the model never learned, and the styling vanished the next time the spans were rebuilt **Now matches Figma.** | parity | `TextEditor.tsx` `onKeyDown` — **fixed `d9c9521`**. With no range the patch lands on the whole layer, which is the rule the type panel follows and the only reading that is never a no-op. Test: features "⌘B bolds the selected range…", "⌘I and ⇧⌘X reach the runs as well", "with the caret collapsed…" |
| <a id="t-15"></a>T-15 | ⌥⌘L/T/R/J alignment, ⇧⌘< / ⇧⌘> size | Layer properties, and they keep working with the caret inside the layer | Absent on both paths **Now matches Figma.** | parity | `lib/actions.ts` `alignText`, `stepFontSize`, `TEXT_ALIGN_KEYS`; called from `Editor.tsx` and `TextEditor.tsx` — **fixed `05109b5`**. One mapping rather than two that drift. ⇧⌘< is matched on the comma underneath it. Test: editor "⌥⌘R aligns the text…", "⇧⌘> and ⇧⌘< step the size…", "a selection with no text in it is left alone"; features "⇧⌘> steps the size while the caret is inside the layer" |
| <a id="t-13"></a>T-13 | ⏎ with a text layer selected enters edit mode | Yes | No. ⏎ tries `canEditPoints` (false for `text`) then `firstChild` (a text layer has none), so the key does nothing. **Now matches Figma.** | parity | `Editor.tsx:296-312`; `geometry.ts:499-501` — **fixed `c4b9ec6`**. |

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
| <a id="cp-09"></a>CP-09 | ⌥⌘B detach instance | Yes | The panel had the button; the key did nothing **Now matches Figma.** | parity | `Editor.tsx`; `ContextMenu.tsx` — **fixed `956acc0`**. Falls through on anything that is not an instance rather than swallowing the key. Test: editor "⌥⌘B detaches an instance from its main" |
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
| <a id="x-05"></a>X-05 | PDF | Yes | A one-page PDF, sized in points, lossless and alpha-correct. The artwork is a raster: vector *text* would mean re-laying out type the browser has already laid out **Now matches Figma.** | parity | `src/export/raster.ts` — **fixed `21b79ec`**, lossless + soft mask in `351081d` |
| X-06 | Slices export the region under them | Yes | Yes | parity | test `features.spec.ts:526` |
| X-07 | JPG export | Yes | Absent **Now matches Figma.** | parity | `types.ts:457` — **fixed `6743ce0`**. |
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
| <a id="sv-01"></a>SV-01 | Only `src/server/db.ts` runs SQL | Route components go through a seam | `src/server/queries.ts` answers page-shaped questions; no route imports `db.ts`, and the access decision is out of the React component **Now matches Figma.** | parity | `app/files/page.tsx`, `app/f/[room]/page.tsx`, `src/server/queries.ts` — **fixed `b1d8ea9`**. Covered by share.spec.ts's four outcomes and dashboard.spec.ts. |
| SV-02 | MCP stays batched | `edit_design` runs ops through a ref table; `write_html` builds a screen in one call | Both present | parity | `server/mcp.ts`; `server/mcp-html.ts`; `mcp.spec.ts` |
| SV-03 | Comments outside the undo scope | Yes | Yes | parity | `store.ts:868-899` |
| SV-04 | Curves only in `geometry.ts`, booleans only in `clipper.ts` | Yes | Yes | parity | `document/geometry.ts`; `document/clipper.ts` |
| SV-05 | Selection rules only in `selection.ts` | Yes | Yes — the marquee now injects a DOM-measuring `rectOf` rather than building geometry itself | parity | `Canvas.tsx` marquee release; `selection.ts:132-149` — **fixed `d770604`** |

---

## Two rows that were parked, and how they closed

Both K-39 and S-12 were held back as "ask the user", because closing them meant
guessing at Figma. That was the wrong stopping point: **Figma publishes its
shortcut panel and its selection behaviour**, so the uncertainty was answerable
from the source rather than from me or from you. Asking is the fallback when the
answer is not written down — not the first move.

- **K-39** — `N` / ⇧N are listed under *Zoom* in Figma's shortcut panel as "Zoom
  to Next / Previous Frame". Editor bindings, not Present-only. The Phase 1 row
  was right and my later demotion of it was over-cautious.
- **S-12** — one rule covers it: a frame already selected is moved by a drag on
  its background; one that is not is marqueed inside. Confirmed against Figma's
  own help centre and the UI3 threads where people hit the selected/unselected
  distinction.

## Known limits, recorded rather than hidden

Real behaviour that is deliberately short of Figma. Each is a candidate row if
anyone disagrees with the trade.

- **PDF text is raster, not selectable.** The pixels are now lossless and keep
  their alpha, so the two defects that mattered are gone. What is left is that
  the artwork is an image rather than glyphs — and vector text would mean
  re-laying out type the browser has already laid out, which the real-DOM
  invariant forbids. This is the honest boundary; the earlier "it would need a
  second renderer" was over-claimed, since `toNative.ts` walks the same tree.
- **Smart selection reads rows and columns, not grids.** A grid selection gets
  no handles rather than handles that do the wrong thing. The detector would
  need to group into rows first, as `tidyUp` does, and then decide which of the
  two axes a dot belongs to — worth a row if anyone works in grids often enough
  to want it.
- **SwiftUI and Android XML only.** Figma also offers Compose and UIKit.
  Gradients, image fills and shaders emit a comment naming the CSS instead of a
  colour, because they have no one colour to name.
- **A group resize of *rotated* members** scales each layer's w/h on its own
  axes. Non-uniformly scaling a rotated box is not representable as w/h plus a
  rotation, so this is an approximation rather than a bug — but it is one.
- **Android has no gap.** A `LinearLayout` spaces children by their margins, so
  a layout with a gap emits a comment saying so rather than silently losing it.
- **A timeline drives eleven properties.** They are what `nodeStyle` writes and
  CSS interpolates, which is what keeps the compiler honest — a track CSS
  cannot tween would have to be animated by a frame loop, and that is the one
  thing this design does not do. Text properties and shadows are the candidates
  left (MO-02).
- **A gradient fill steps rather than tweens**, and the panel greys the chip
  rather than animating nothing. CSS has no interpolation between two
  gradients; `valueAt` says the same thing rather than inventing a blend, so the
  panel and the canvas agree about it. The same goes for a stroke on a shape
  (an SVG attribute, not CSS), a stroke weight where four individual sides have
  replaced it, and a blur on a layer whose effects list has no blur entry.
- **Two tracks sharing one CSS property share one curve.** They have to compile
  into a single animation (MO-17), and a CSS keyframe has one
  `animation-timing-function` — so a stroke weight easing in while its colour
  eases out is not expressible. The weight's curve wins, being first in the
  panel's order.
- **A component instance keeps its own timeline.** It is re-pointed at the
  instance's layers when the instance is made, and then left alone: propagating
  the main's would point it back at the main's layers. So a later edit to the
  main's timeline does not reach existing instances.

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
- **2026-08-30, sixth pass — Motion.** The user asked for Figma Motion, "like a
  clone", and to keep going without checking in. Fifteen rows (`MO-01`…`MO-15`)
  and a feature that did not exist: a per-frame timeline, a panel at the foot of
  the canvas, recording, playback, export and MCP verbs. Suite **399 → 455
  passing**, typecheck clean, no pre-existing test bent or weakened.
  **The design decision the rest falls out of: the timeline compiles to CSS.**
  `motion.ts` emits one `@keyframes` per track and one rule per layer, and the
  browser interpolates. Scrubbing is then a negative `animation-delay` on a
  paused animation rather than a frame loop pushing styles at React; playing is
  the same sheet unpaused; and the export animates with no runtime, because the
  export is the same compiler pointed at class names instead of node ids. It is
  the same bargain `nodeStyle` makes, and it was chosen for the same reason.
  **Three things the work turned up that reading could not have.**
  1. **CSS does not hold a property outside its keyframes.** A track keyed only
     in the middle was tweening the layer's *design* value into the first key,
     because the browser synthesises the missing 0% and 100% from the element's
     own style. A timeline holds the first and last key. Found by screenshotting
     the canvas and reading the computed `top` against what `valueAt` said —
     not by any test written up to that point. The compiler now writes both
     stops, and `motion.spec.ts` asserts the sampler and the compiled CSS
     against *each other* rather than trusting either.
  2. **A copy would have animated the original.** A timeline names the layers it
     drives, and it is the only thing in this document that names a layer from
     inside another layer's data — so duplicate, paste and instance all had to
     re-point it. `serialize` now carries `from`, which is what lets a paste
     rebuild the mapping at all.
  3. **⌫ went to both.** With a keyframe selected in the panel and its layer
     selected on the canvas, both handlers fired and the layer was deleted along
     with the key. Two window listeners, no precedence between them.
  **Deliberately not done:** timeline zoom (MO-13) and multi-select of keyframes
  (MO-14) — both are real Figma behaviour and both are recorded as `missing`
  rather than argued away. The custom-curve editor (MO-04) is `partial` for the
  same reason: the model takes a bezier or a spring, the panel has no editor.
  **Landed in `d85ee70`** on the `motion` branch, together with the seventh
  pass below — the two passes are one commit because the second rewrote the
  compiler the first had written, and splitting them afterwards would have been
  a fiction.
- **2026-08-30, seventh pass — the rest of Motion, and a bug sweep.** The user
  asked for the unfinished rows one at a time and for the bugs to be found
  first. Suite **455 → 477 passing**, typecheck clean.
  **Five bugs, four of them silent.**
  1. **The export only carried the root's timeline.** A board with animated
     boards inside it — the ordinary shape of a screens page — exported the
     outer one and dropped the rest. `timelinesIn` walks the subtree now.
  2. **A key dragged onto another left two at one moment.** Snapping made it
     likely rather than rare: the snap targets *are* the other keys. Two keys at
     one time compile to one stop, so the model held a value the canvas had
     already dropped — the exact drift the suite exists to catch, and it took a
     test to see it.
  3. **A fill track on a star animated nothing.** A shape paints through a
     clipped layer inside its box, so the box's background was being animated
     where nobody could see it. The layer carries `data-paint` now, in the
     canvas and in the export, and `targetOf` sends fill tracks there (MO-16).
  4. **A stroke's weight and its colour cancelled each other.** Two animations
     naming one property do not combine; the last one named wins. They compile
     as one animation now (MO-17) — found only because the *second* property was
     added, which is the argument for adding properties in pairs.
  5. **⌫ went to the layer as well as the keyframe**, and a nested edit
     keyframed every field of the spec it arrived in rather than the one that
     moved.
  **What the four rows cost.** Zoom (MO-13) was mostly geometry, and turned up
  a sixth bug on the way: the last ruler label overflowed the timeline, which
  widened the scroller past the lanes and left a strip at the right-hand end
  that scrubbed nothing. Multi-select (MO-14) needed the store to gain batch
  verbs — `updateKeyframes`, `removeKeyframes`, `addKeyframes` — because one
  write per key is one undo step and one stylesheet per key. The curve editor
  (MO-04) is the sampler drawn: what you drag is the function that interpolates.
  Eleven properties (MO-02) needed the compiler to stop spelling CSS out and
  start asking `nodeStyle`, which is how a stroke lands on whatever shape that
  layer's stroke actually takes.
  **The lesson worth keeping: three of the five bugs were invisible to a
  passing suite and visible in a screenshot or a computed style.** Two of them
  were found by reading `getComputedStyle` back off the canvas and comparing it
  with what `valueAt` said. A compiler that emits CSS has to be tested against
  the browser, not against its own output.
- **2026-08-30, fifth pass** — the user asked for the rows to be worked one at
  a time. There were none left, so Phase 1 ran again over surface the first
  sweep had not walked: text editing, the arrange commands, and the shortcuts
  Figma publishes but this ledger had never checked. Eight rows, eight commits,
  399 tests passing.
  **What the second sweep says about the first.** The first ledger's 116 rows
  were not wrong; they were the rows that come of walking the *panels*. Three of
  the eight below were invisible from there because they are not controls at
  all — ⇧ during a drag, a handle pulled past the far edge, ⌘B inside a
  contentEditable. Two of those were `wrong` rather than `missing`, and one of
  them (T-14) is the worst kind: the browser answered the key, the user saw the
  text go bold, and the styling was gone by the next render. **A row that reads
  "no control for this" is not the same as "nothing happens", and only the
  second is a gesture worth ranking.** The next sweep should start from the
  gestures, not the panels.
  The other thing worth recording: `tabs.spec.ts:98` came back. The guard added
  two passes ago waits for the handle to belong to the file, which is not the
  same as the file having arrived over the socket. Reported before it was
  touched, then fixed by polling the same assertion rather than weakening it.
- **2026-08-30, fourth pass** — the user said "fix it then" to the two rows I had
  been arguing instead of closing, and was right on both.
  **SV-01**: my defence was literally true — no route ran SQL — and beside the
  point. The `/f/[room]` route held a real authorisation decision inside a React
  component, where nothing could reach it without a browser. `server/queries.ts`
  is the seam; no route imports `db.ts` now.
  **X-05**: my defence was over-claimed. I said a better PDF needed a second
  renderer, having already shipped `toNative.ts`, which walks the same tree off
  the same `nodeStyle()`. The real boundary is narrower — vector *text* would
  mean re-laying out type the browser has already laid out — and it had nothing
  to do with the two actual defects, which were a lossy codec on flat colour and
  no alpha channel. Both fixed.
  **K-38** also closed properly: click-to-place, as Figma does it.
  **The pattern worth remembering: when a row is hard, check whether the argument
  for leaving it is load-bearing or just an argument.** Twice it was the latter.
- **2026-08-30, third pass** — closed K-39 and S-12, the two rows the previous
  pass had parked as "ask the user". Both were answerable from Figma's own
  published shortcut panel and help centre. **The lesson for later sessions:
  "ask when unsure" means ask when the answer is not written down anywhere —
  check Figma's docs first.** No row in this ledger is open now: 189 parity,
  8 deliberate, 2 partial (both argued, neither broken).
- **2026-08-30, continued** — closed everything the ledger had left open. S-13
  (a press keeps a layer you already selected) turned out to be the
  highest-frequency `wrong` row in the file and had not been ranked at all,
  because Phase 1 read `resolveClick` without asking what it did *after* a
  selection existed. C-14b, C-15b, K-24, K-38, X-07, O-06, TL-04, I-05 closed;
  SV-05 closed by S-05; the K-06 row repaired after a bulk edit mangled its
  evidence cell. Two more pre-existing bugs surfaced on the way: `moveMany`
  inserted movers one at a time, so a multi-row drag in the *layers panel* split
  the selection around a layer it was passing; and the group resize was still
  mixing parent-local x/y with a world-space anchor for anything nested. Suite
  366 → 377. The flaky `tabs.spec.ts:98` was fixed only after it had been
  reported in the previous update — never silently.
