"""Minimax Prompt From Image — load sidecar / manual snippet for Prompt Compiler slots."""

from __future__ import annotations

import hashlib
import os

from aiohttp import web
from server import PromptServer

from prompt_text_utils import (
    BUILTIN_SLOTS,
    BEHAVIOR_SLOTS,
    PIC_SLOTS,
    format_display,
    is_slot_name,
    normalize_picture_index,
    normalize_slot_name,
    to_inject_snippet,
)

SLOTS = BEHAVIOR_SLOTS + PIC_SLOTS
EXTRACT_KEYS = ("(all)",) + BUILTIN_SLOTS
PICTURE_CHOICES = ("(none)",) + tuple(str(i) for i in range(1, 10))

DEFAULT_FALLBACK = ""


def _normalize_path(path: str) -> str:
    path = (path or "").strip().strip('"').strip("'")
    if not path:
        return ""
    return os.path.abspath(os.path.expanduser(path))


def sidecar_txt_path(image_path: str) -> str:
    """Return path to sibling .txt for an image (same stem)."""
    root, _ = os.path.splitext(image_path)
    return root + ".txt"


def read_sidecar(image_path: str) -> str | None:
    """Read sidecar .txt if present; return None when missing or empty."""
    txt_path = sidecar_txt_path(image_path)
    if not os.path.isfile(txt_path):
        return None
    try:
        with open(txt_path, "r", encoding="utf-8") as f:
            text = f.read().strip()
    except OSError:
        return None
    return text or None


def resolve_raw(image_path: str, from_file: bool, prompt_text: str, fallback: str) -> str:
    """
    from_file True  → sidecar .txt, else fallback
    from_file False → prompt_text widget, else fallback
    """
    fallback = (fallback or "").strip()
    if from_file:
        sidecar = read_sidecar(image_path) if image_path else None
        return sidecar if sidecar is not None else fallback
    text = (prompt_text or "").strip()
    return text if text else fallback


@PromptServer.instance.routes.get("/minimaxutils/sidecar")
async def minimaxutils_sidecar(request):
    """Live preview helper: read sibling .txt for an image path."""
    path = _normalize_path(request.rel_url.query.get("path", ""))
    extract_key = (request.rel_url.query.get("extract_key") or "(all)").strip() or "(all)"
    picture = request.rel_url.query.get("picture") or "(none)"
    if not path:
        return web.json_response({"ok": False, "display": "(no image path)", "snippet": ""})
    txt = sidecar_txt_path(path)
    if not os.path.isfile(txt):
        return web.json_response(
            {
                "ok": False,
                "path": txt,
                "display": f"(no sidecar)\n{os.path.basename(txt)}",
                "snippet": "",
            }
        )
    raw = read_sidecar(path)
    if raw is None:
        return web.json_response(
            {
                "ok": False,
                "path": txt,
                "display": f"(empty sidecar)\n{os.path.basename(txt)}",
                "snippet": "",
            }
        )
    slot = (request.rel_url.query.get("slot") or "").strip()
    snippet = to_inject_snippet(raw, extract_key, picture, default_slot=slot or None)
    display = format_display(raw)
    pic_i = normalize_picture_index(picture)
    if pic_i:
        display = f"<Picture {pic_i}>\n{display}"
    if extract_key and extract_key != "(all)" and snippet:
        display = f"{extract_key} : {snippet}"
    elif extract_key and extract_key != "(all)" and not snippet:
        display = f"(no key '{extract_key}' in sidecar)"
    elif snippet and snippet != raw:
        display = format_display(snippet)
        if pic_i:
            display = f"<Picture {pic_i}>\n{display}"
    return web.json_response(
        {
            "ok": True,
            "path": txt,
            "raw": raw,
            "display": display,
            "snippet": snippet,
            "picture": pic_i or 0,
        }
    )


@PromptServer.instance.routes.post("/minimaxutils/resolve_snippet")
async def minimaxutils_resolve_snippet(request):
    """Resolve Prompt-From-Image snippet without running the workflow."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)

    path = _normalize_path(str(data.get("image_path") or ""))
    from_file = bool(data.get("from_file", True))
    extract_key = str(data.get("extract_key") or "(all)").strip() or "(all)"
    picture = data.get("picture") or "(none)"
    slot = str(data.get("slot") or "").strip()
    prompt_text = str(data.get("prompt_text") or "")
    fallback = str(data.get("fallback") or "")

    raw = resolve_raw(path, from_file, prompt_text, fallback)
    snippet = (
        to_inject_snippet(raw, extract_key, picture, default_slot=slot or None)
        if raw
        else ""
    )
    if not snippet and fallback.strip():
        snippet = fallback.strip()
    display = format_display(raw) if raw else "(empty)"
    pic_i = normalize_picture_index(picture)
    if pic_i and raw:
        display = f"<Picture {pic_i}>\n{display}"
    if extract_key and extract_key != "(all)" and snippet:
        display = f"{extract_key} : {snippet}"
    elif snippet and snippet != raw:
        display = format_display(snippet)
        if pic_i and raw:
            display = f"<Picture {pic_i}>\n{display}"
    return web.json_response(
        {
            "ok": True,
            "snippet": snippet,
            "display": display,
            "raw": raw or "",
            "picture": pic_i or 0,
        }
    )


class MinimaxPromptFromImage:
    """
    Load a text snippet for Minimax Prompt Compiler.

    Wire Load Image From Dir → path. Set slot to match the intended compiler key
    (pose / camera / zoom / pic1 / …): colors the node, and for freeform text
    (no pose:/… keys) labels the snippet so Compiler.bundle can route it.

    Set picture=N when this image is MiniMax <Picture N>; sidecar description:/
    freeform maps onto skeleton anchor {picN} (picture wins over slot).

    For a multi-key sidecar, prefer Compiler.bundle (extract_key=all), or use
    extract_key to pull one field into a dedicated slot.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_path": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "from Load Image From Dir → path",
                    },
                ),
                "slot": (
                    "STRING",
                    {
                        "default": "pose",
                        "multiline": False,
                        "tooltip": (
                            "Target slot (pose, action_main, pic1, …). Colors the node; "
                            "freeform text is labeled for Compiler.bundle."
                        ),
                    },
                ),
                "picture": (
                    list(PICTURE_CHOICES),
                    {
                        "default": "(none)",
                        "tooltip": "This image is MiniMax <Picture N> → fills {picN}",
                    },
                ),
                "from_file": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "label_on": "from file",
                        "label_off": "manual",
                    },
                ),
                "extract_key": (
                    "STRING",
                    {
                        "default": "(all)",
                        "multiline": False,
                        "tooltip": "(all) keeps every key, or one slot name to extract",
                    },
                ),
                "prompt_text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "placeholder": (
                            "description: young woman, long dark hair\n"
                            "pose: standing, relaxed posture\n"
                            "camera: low angle\n"
                            "zoom: medium closeup"
                        ),
                    },
                ),
                "fallback": (
                    "STRING",
                    {
                        "default": DEFAULT_FALLBACK,
                        "multiline": False,
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("snippet",)
    FUNCTION = "load"
    CATEGORY = "MinimaxUtils/prompt"
    DESCRIPTION = (
        "Loads a sidecar/manual snippet for Minimax Prompt Compiler. "
        "Set picture=N for <Picture N> → {picN}. Wire multi-key txt to Compiler.bundle."
    )

    @classmethod
    def VALIDATE_INPUTS(cls, extract_key, slot):
        # Allow blank extract_key from older workflows → treated as (all).
        ek = (extract_key or "").strip() or "(all)"
        if ek != "(all)" and not is_slot_name(ek):
            return f"extract_key: {extract_key!r} must be '(all)' or a slot name"
        sl = (slot or "").strip()
        if sl and not is_slot_name(sl):
            return f"slot: {slot!r} must be a-z / digits / underscore (e.g. action_main)"
        return True

    def load(self, image_path, slot, picture, from_file, extract_key, prompt_text, fallback):
        extract_key = (extract_key or "").strip() or "(all)"
        slot = normalize_slot_name(slot) or "pose"
        path = _normalize_path(image_path)
        raw = resolve_raw(path, bool(from_file), prompt_text, fallback)
        snippet = (
            to_inject_snippet(raw, extract_key, picture, default_slot=slot) if raw else ""
        )
        if not snippet and (fallback or "").strip():
            snippet = (fallback or "").strip()
        sidecar = sidecar_txt_path(path) if path else ""
        has_sidecar = bool(path and os.path.isfile(sidecar))
        display = format_display(raw) if raw else "(empty)"
        pic_i = normalize_picture_index(picture)
        if pic_i and raw:
            display = f"<Picture {pic_i}>\n{display}"
        if extract_key and extract_key != "(all)" and snippet:
            display = f"{extract_key} : {snippet}"
        elif snippet and snippet != raw:
            display = format_display(snippet)
            if pic_i and raw:
                display = f"<Picture {pic_i}>\n{display}"
        # Prefer picture coloring when bound to a MiniMax picture index.
        ui_slot = f"pic{pic_i}" if pic_i else slot
        return {
            "ui": {
                "display": [display],
                "snippet": [snippet],
                "slot": [ui_slot],
                "picture": [str(pic_i or "")],
                "sidecar": [sidecar if has_sidecar else ""],
                "from_file": [bool(from_file)],
            },
            "result": (snippet,),
        }

    @classmethod
    def IS_CHANGED(cls, image_path, slot, picture, from_file, extract_key, prompt_text, fallback):
        path = _normalize_path(image_path)
        m = hashlib.sha256()
        m.update(path.encode("utf-8", errors="replace"))
        m.update(
            f"{slot}:{picture}:{bool(from_file)}:{extract_key}:{fallback}:{prompt_text}".encode(
                "utf-8", errors="replace"
            )
        )
        if path:
            try:
                m.update(str(os.path.getmtime(path)).encode("utf-8"))
            except OSError:
                pass
            if from_file:
                try:
                    m.update(str(os.path.getmtime(sidecar_txt_path(path))).encode("utf-8"))
                except OSError:
                    pass
        return m.digest().hex()
