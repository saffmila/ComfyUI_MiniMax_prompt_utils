"""Minimax Prompt Compiler — editable REF2VA skeleton + slot injections."""

from __future__ import annotations

import hashlib
import re

from aiohttp import web
from server import PromptServer

from prompt_text_utils import (
    BUILTIN_SLOTS,
    BEHAVIOR_SLOTS,
    PIC_SLOTS,
    PLACEHOLDER_RE,
    discover_placeholders,
    format_pic_insert,
    is_pic_slot,
    is_slot_name,
    normalize_slot_name,
    parse_slot_bundle,
    resolve_template_slots,
)
from prompt_templates_api import load_template

# Built-in optional sockets on the node (ComfyUI INPUT_TYPES are fixed).
# Template-defined slots (action_main, camera_push, …) arrive via bundle labels.
SLOTS = BUILTIN_SLOTS
BEHAVIOR = BEHAVIOR_SLOTS
PICS = PIC_SLOTS

# Colors mirrored in web/minimax_prompt_compiler.js
SLOT_COLORS = {
    "pose": "#e6c84a",
    "camera": "#4a9eff",
    "zoom": "#b44aff",
    "env": "#3dff6a",
    "motion": "#ff9a3d",
    "action": "#ff5a8a",
    "extra": "#c0c0c0",
    "pic1": "#ff6b6b",
    "pic2": "#ffa94d",
    "pic3": "#69db7c",
    "pic4": "#4dabf7",
    "pic5": "#da77f2",
    "pic6": "#ffd43b",
    "pic7": "#22b8cf",
    "pic8": "#ff8787",
    "pic9": "#a9e34b",
}

# Fallback if prompt_templates/basic.json is missing.
_FALLBACK_SKELETON = """subject_definitions:
<Subject 1> is the main character defined by <Picture 1>{pic1}.
<Picture 2> is the pose and composition reference for [Shot 1]{pic2}.
<Picture 3> is the environment and lighting reference for the target scene{pic3}.

summary:
[reference generation] <Subject 1> adopts the posture and framing from <Picture 2> within the environment of <Picture 3>.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - identity and clothing from <Picture 1> remain unchanged.
<Picture 2> ([Shot 1] composition): fully_preserved - pose, camera angle, and framing from <Picture 2> are retained.
<Picture 3> (environment): fully_preserved - room layout and lighting from <Picture 3> are retained.

detailed_description:
Cinematic, photorealistic style with sharp focus.
[Shot 1] A single solitary person strictly in the frame (no other people present). Framing is {zoom}. <Subject 1> holds {pose}. The camera holds a static shot at {camera}, matching the composition of <Picture 2>. The environment from <Picture 3> remains solid and fully visible around the subject. {action} {env} {motion} {extra}

overall_soundscape: Quiet indoor room ambience, subtle fabric rustle.

non_diegetic_music: N/A"""


def _default_skeleton() -> str:
    data = load_template("basic")
    if data and data.get("skeleton"):
        return data["skeleton"]
    return _FALLBACK_SKELETON


DEFAULT_SKELETON = _default_skeleton()


def normalize_slot_value(value: str | None) -> str:
    return (value or "").strip()


def strip_slot_label(slot: str, value: str) -> str:
    """
    Keep only the value for this slot.

    'pose: standing relaxed' on pose → 'standing relaxed'
    'pic1: face ref' on pic2 → '' (wrong key must not leak 'pic1:' into the prompt)
    multi-key blob → that slot's value only
    """
    value = normalize_slot_value(value)
    if not value:
        return ""
    bundled = parse_slot_bundle(value)
    if bundled:
        return bundled.get(slot, "")
    prefix = f"{slot}:"
    if value.lower().startswith(prefix):
        return value[len(prefix) :].strip()
    return value


def parse_bundle(text: str | None) -> dict[str, str]:
    """Split multi-key sidecar / inject text into slot values."""
    return parse_slot_bundle(text)


def _labeled_slot_blob(value: str) -> dict[str, str]:
    """Return parsed slots when value is labeled (pose:/pic1:/…); else {}."""
    return parse_slot_bundle(value)


def _value_for_prompt_body(slot: str, value: str) -> str:
    """
    Final guard before skeleton insert: never emit 'pic1:' / 'pose:' labels.

    Labeled blob on the matching key → that value only.
    Single wrong-key label → prose without the key (still usable).
    Multi wrong-key blob → empty (merge should have redistributed already).
    """
    value = normalize_slot_value(value)
    if not value:
        return ""
    labeled = parse_slot_bundle(value)
    if not labeled:
        return value
    if slot in labeled:
        return labeled[slot]
    if len(labeled) == 1:
        return next(iter(labeled.values()))
    return ""


def merge_slot_values(
    explicit: dict[str, str | None],
    bundle_text: str | None,
    skeleton: str | None = None,
) -> dict[str, str]:
    """
    Explicit wired built-in sockets win; bundle fills empties / custom slots.

    Labeled blobs (pose:/action_main:/pic1:/…) on any socket are split by key
    and routed so labels never appear as literal prompt text.
    """
    from_bundle = parse_bundle(bundle_text)
    raw = {s: normalize_slot_value(explicit.get(s)) for s in SLOTS}

    on_socket: dict[str, str] = {}
    redistributed: dict[str, str] = {}

    for slot in SLOTS:
        val = raw.get(slot) or ""
        if not val:
            continue
        labeled = _labeled_slot_blob(val)
        if labeled:
            for key, item in labeled.items():
                if not item or not is_slot_name(key):
                    continue
                if key == slot:
                    on_socket[slot] = item
                else:
                    redistributed.setdefault(key, item)
            continue
        on_socket[slot] = val

    # Also split labeled content inside the bundle itself.
    for key, item in list(from_bundle.items()):
        labeled = _labeled_slot_blob(item)
        if labeled and (len(labeled) > 1 or (len(labeled) == 1 and key not in labeled)):
            del from_bundle[key]
            for lk, lv in labeled.items():
                if lv and is_slot_name(lk):
                    from_bundle.setdefault(lk, lv)

    keys: list[str] = []
    seen: set[str] = set()

    def _add(key: str) -> None:
        key = normalize_slot_name(key)
        if not key or key in seen:
            return
        seen.add(key)
        keys.append(key)

    for key in discover_placeholders(skeleton):
        _add(key)
    for key in SLOTS:
        _add(key)
    for key in on_socket:
        _add(key)
    for key in redistributed:
        _add(key)
    for key in from_bundle:
        _add(key)

    out: dict[str, str] = {}
    for slot in keys:
        if slot in on_socket and on_socket[slot]:
            out[slot] = on_socket[slot]
        elif slot in redistributed and redistributed[slot]:
            out[slot] = redistributed[slot]
        else:
            out[slot] = from_bundle.get(slot, "")
    return out


def _cleanup_compiled(text: str) -> str:
    """Tidy empty optional inserts: (; ; closeup) → (closeup), 'in within' → 'within'."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r";\s*;\s*", "; ", text)
        text = re.sub(r"\(\s*;\s*", "(", text)
        text = re.sub(r";\s*\)", ")", text)
        text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" +\n", "\n", text)
    text = re.sub(r"\bin\s+within\b", "within", text)
    text = re.sub(r"\bthe exact\s+camera framing\b", "the camera framing", text, flags=re.I)
    return text


def compile_skeleton(skeleton: str, values: dict[str, str], empty_placeholder: str = "") -> str:
    """Replace {slot} placeholders (built-in or template-defined). Unknown braces left if invalid names."""
    skeleton = (skeleton or DEFAULT_SKELETON).strip() or DEFAULT_SKELETON
    empty_placeholder = empty_placeholder if empty_placeholder is not None else ""

    def repl(match: re.Match) -> str:
        key = match.group(1).lower()
        if not is_slot_name(key):
            return match.group(0)
        val = _value_for_prompt_body(key, values.get(key) or "")
        if not val:
            return empty_placeholder
        if is_pic_slot(key):
            return format_pic_insert(val)
        return val

    text = PLACEHOLDER_RE.sub(repl, skeleton)
    return _cleanup_compiled(text)


def slot_fill_map(values: dict[str, str]) -> dict[str, str]:
    """Which slots actually contributed non-empty text (for UI coloring)."""
    return {k: normalize_slot_value(v) for k, v in values.items() if normalize_slot_value(v)}


def _explicit_from_request(data: dict) -> dict[str, str | None]:
    return {s: data.get(s) for s in SLOTS}


@PromptServer.instance.routes.post("/minimaxutils/compile_preview")
async def minimaxutils_compile_preview(request):
    """Compile skeleton + slots without running the workflow."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)

    skeleton = data.get("skeleton") or DEFAULT_SKELETON
    values = merge_slot_values(_explicit_from_request(data), data.get("bundle"), skeleton)
    prompt = compile_skeleton(
        skeleton,
        values,
        data.get("empty_placeholder") or "",
    )
    filled = slot_fill_map(values)
    slots = resolve_template_slots(skeleton, data.get("slots"))
    return web.json_response(
        {"ok": True, "prompt": prompt, "filled": filled, "slots": slots}
    )


class MinimaxPromptCompiler:
    """
    Compile a MiniMax REF2VA prompt from an editable skeleton + slot snippets.

    Built-in sockets: pose/camera/zoom/env/motion/action/extra + pic1…pic9.
    Template-defined slots ({action_main}, {camera_push}, …) are filled via
    Compiler.bundle using labeled lines (action_main: …).

    Preferred for one multi-key sidecar:
      Prompt From Image/Text (extract_key=all) → bundle
    """

    @classmethod
    def INPUT_TYPES(cls):
        optional = {
            "bundle": (
                "STRING",
                {
                    "forceInput": True,
                    "default": "",
                    "tooltip": (
                        "Multi-key sidecar (pose:/action_main:/pic1:/…). "
                        "Fills built-in and template-defined slots."
                    ),
                },
            ),
        }
        for slot in SLOTS:
            optional[slot] = ("STRING", {"forceInput": True, "default": ""})
        return {
            "required": {
                "skeleton": (
                    "STRING",
                    {
                        "default": DEFAULT_SKELETON,
                        "multiline": True,
                    },
                ),
                "empty_placeholder": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "text used when a slot is empty",
                    },
                ),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "compile"
    CATEGORY = "MinimaxUtils/prompt"
    DESCRIPTION = (
        "Editable REF2VA skeleton. Use {pose}/{pic1}/… or any {custom_slot}. "
        "Custom slots fill via bundle labels. MiniMax labels stay <Picture N>."
    )

    def compile(
        self,
        skeleton,
        empty_placeholder="",
        bundle=None,
        **slot_kwargs,
    ):
        explicit = {s: slot_kwargs.get(s) for s in SLOTS}
        values = merge_slot_values(explicit, bundle, skeleton)
        prompt = compile_skeleton(skeleton, values, empty_placeholder)
        filled = slot_fill_map(values)
        slots = resolve_template_slots(skeleton)
        return {
            "ui": {
                "prompt": [prompt],
                "filled_json": ["\n".join(f"{k}={v}" for k, v in filled.items())],
                "filled_keys": [",".join(filled.keys())],
                "slots": [",".join(slots)],
            },
            "result": (prompt,),
        }

    @classmethod
    def IS_CHANGED(
        cls,
        skeleton,
        empty_placeholder="",
        bundle=None,
        **slot_kwargs,
    ):
        m = hashlib.sha256()
        parts = [str(skeleton), str(empty_placeholder), str(bundle)]
        parts.extend(str(slot_kwargs.get(s) or "") for s in SLOTS)
        m.update("|".join(parts).encode("utf-8", errors="replace"))
        return m.digest().hex()
