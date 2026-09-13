# Comfyui-MinimaxUtils

ComfyUI helpers for MiniMax / Hailuo video extension workflows.

## Nodes

### Load Image From Dir

Load one image from a folder (with live preview):

| Mode | Behavior |
|------|----------|
| `sequential` | Uses `index` (default 0 = first). After each generate, index increments. |
| `random` | Picks by `seed` (seed randomizes after generate). |
| `custom` | Manual browse: ◀/▶ buttons, **ArrowUp** = next, **ArrowDown** = previous. Preview updates immediately. |

Outputs: `image`, `mask`, `filename`, `path`.

UI: preview updates automatically when `index` / mode / seed / directory change (widget arrows + ↑/↓). **◀ Previous / Next ▶** buttons for browsing.

### Minimax Prompt From Image

Loads text for **Minimax Prompt Compiler** (does not build the final REF2VA prompt alone).

Wire `Load Image From Dir` → `path`.

| Widget | Purpose |
|--------|---------|
| `slot` | Target slot name (`pose`, `action_main`, …) — free STRING. Colors the node; labels freeform for `bundle` |
| `picture` | This image is MiniMax `<Picture N>` → fills skeleton anchor `{picN}` (wins over `slot`) |
| `from_file` | on = sibling `.txt`; off = `prompt_text` widget |
| `extract_key` | `(all)` keeps the whole sidecar, or one slot name |

Sidecar — freeform, behavior keys, and/or picture description:

```
description: young woman, long dark hair, blue cardigan (ignore background)
pose: standing, relaxed posture
camera: low angle
zoom: medium closeup
```

With `picture=1`, `description:` (or freeform text) maps to `{pic1}`. Explicit `pic2:` / `pic3:` keys also work without the widget.

Output: `snippet` → `Compiler.bundle` or a matching slot (`pose`, `pic1`, …).

### Minimax Prompt Compiler

Editable REF2VA skeleton with **anchor** placeholders (insert or replace):

| Anchors | Role |
|---------|------|
| `{pose}` `{camera}` `{zoom}` `{env}` `{motion}` `{action}` `{extra}` | Built-in behavior sockets |
| `{pic1}` … `{pic9}` | Optional description insert next to MiniMax `<Picture N>` |
| `{any_name}` | **Template-defined** custom slots (e.g. `{action_main}`, `{camera_push}`) |

Custom slots have **no dedicated ComfyUI socket** — fill them via `Compiler.bundle` with labeled lines:

```
action_main: continues the sequence
camera_push: The camera pushes in with small amplitude at slow speed.
```

Or wire **Prompt From Text** (`slot=action_main`, freeform text) → `bundle`.

Templates (`prompt_templates/*.json`) may list `"slots": [...]`. If omitted, slots are discovered from `{…}` in the skeleton. Save on the Compiler writes the discovered list back.

`action` = what the character is doing. `motion` = camera / shot dynamics. `extra` = leftover notes.

**Recommended (one multi-key sidecar + picture index):**

```
description: young woman with long dark hair (ignore background)
pose: standing beside a wooden table, relaxed posture
camera: low angle
zoom: medium closeup
action: watering plants with a garden hose
```

```
Prompt From Image (picture=1, extract_key=all) ──► Compiler.bundle
                                                   Compiler.prompt ──► MiniMax
```

`bundle` auto-splits keys into matching placeholders (no duplication).

**Or wire slots separately** (one Prompt From Image per key / picture):

```
Prompt From Image (picture=1)        ──► Compiler.pic1
Prompt From Image (slot=pose)        ──► Compiler.pose
Prompt From Image (slot=camera)      ──► Compiler.camera
…
```

Explicit slot inputs override the same key from `bundle`.

**Templates** (`prompt_templates/` + private local dir):

| Location | Git | Purpose |
|----------|-----|---------|
| `prompt_templates/` | committed | Public SFW presets (`basic`, `advanced`) |
| `prompt_templates_local/` | **gitignored** | Your private presets (`my_scene`, …) |
| `$MINIMAXUTILS_TEMPLATES_DIR` | outside repo | Optional extra folder (wins over local) |

Dropdown merges all three. Same name → higher priority wins (`user` env → `local` → `pack`). **Save** always writes to the writable dir (env or `prompt_templates_local/`), never into the shipped pack — so private templates stay off GitHub automatically.

| Preset | Use |
|--------|-----|
| `basic` | Default 3-picture REF2VA skeleton |
| `advanced` | 4-picture layout + `{action_setup}` / `{action_main}` / `{camera_move}` |

Switching a preset loads that skeleton. **Save** writes into the local/user dir. **Refresh** reloads the list from disk.

**Preview button:** compiles the colored prompt from the current skeleton + linked
`Minimax Prompt From Image` sidecars **without running the workflow** (no video generation).

Preview colors injected fragments (pose / camera / …) and MiniMax `<Picture N>` / `<Subject N>` labels.

### Minimax Prompt From Text

Manual snippets **or** load from a folder of `.txt` files — same sequential / random / custom controls as Load Image From Dir.

| Widget | Purpose |
|--------|---------|
| `from_disk` | Off = type in `prompt_text`; on = load from folder |
| `directory` / `mode` / `index` / `seed` / `pattern` | Same as Load Image From Dir (default pattern `*.txt`) |
| `slot` | Free STRING slot name (`action`, `action_main`, …); colors node + labels freeform for `bundle` |
| `picture` | Bind text to MiniMax `<Picture N>` → fills `{picN}` (wins over `slot`) |
| `extract_key` | `(all)` → bundle, or one slot name |

Outputs: `snippet`, `filename`, `path`.

**Dynamic prompts + photos:** use matching `mode` / `index` / `seed` on Load Image From Dir and Prompt From Text (`from_disk` on) so both advance together.

```
action: watering plants with a garden hose
motion: camera pushes in with small amplitude at slow speed
```

Or describe a picture role without a sidecar:

```
picture = 1
prompt_text: identity, clothing, and appearance; ignore background
```
→ injects into `{pic1}` next to `<Picture 1>`.

Wire to `Compiler.bundle` or a single slot. Skeleton stays untouched.

**Typical split**

| Source | Fills |
|--------|--------|
| Prompt From Image (`picture=N` + sidecar) | `{picN}` + pose/camera tied to that file |
| Prompt From Text (`picture=N`) | `{picN}` role/description typed by hand |
| Prompt From Text (`picture=none`) | `{action}` `{motion}` `{extra}` … |

Video motion notes can go in From Text as `motion:` until dedicated `<Video N>` / `{vidN}` anchors exist.

### Seamless Video Stitcher (RIFE)

Stitches an original clip with an AI extension:

1. `cut_index = len(original) - ref_frames_offset` (dynamic; not hard-coded)
2. Seam frames: last trimmed original frame + first kept AI frame (`ai_skip_first`, default 1)
3. RIFE bridge via **ComfyUI-Frame-Interpolation** (required soft dependency)
4. Output: `Original[:cut] + bridge + AI[skip:]`

**Requires:** [ComfyUI-Frame-Interpolation](https://github.com/Fannovel16/ComfyUI-Frame-Interpolation) with a RIFE checkpoint (e.g. `rife49.pth`).

Audio stitching is not included yet (video-only). The node can still be used standalone in a graph.

## MiniMax H3 Extender integration (optional)

Final Decode works with **zero** MinimaxUtils dependency when `original_images` is disconnected.

When you connect the original Instagram / source video:

```
Load Video.IMAGE ──► Final Decode.original_images   (optional)
Extender.cache   ──► Final Decode.cache
Final Decode     ──► stitched mp4 preview / save
```

Final Decode soft-calls `SeamlessVideoStitcher` and exports:

`original[:cut] + RIFE bridge + AI[skip:]`

Stitch widgets on Final Decode (`ref_frames_offset`, `rife_*`, `ai_skip_first`) are ignored unless `original_images` is connected.

Notes:

- Ref2VA full-batch export only (FL2VA stitch not wired yet)
- Original picture track is silent for now; AI audio starts after the bridge
- Without `original_images`, Extender behavior is unchanged
