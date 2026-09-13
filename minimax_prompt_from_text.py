"""Minimax Prompt From Text — manual or directory-loaded slot/bundle snippets."""

from __future__ import annotations

import glob
import hashlib
import os

from aiohttp import web
from server import PromptServer

from load_image_from_dir import resolve_index
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

TEXT_EXTENSIONS = {".txt", ".md", ".prompt"}

# ComfyUI widgets_values shift can park control_after_generate here.
_BAD_PATTERNS = frozenset({"fixed", "increment", "decrement", "randomize"})


def _normalize_pattern(pattern: str) -> str:
    pattern = (pattern or "*.txt").strip() or "*.txt"
    if pattern.lower() in _BAD_PATTERNS:
        return "*.txt"
    return pattern


def _normalize_directory(directory: str) -> str:
    directory = (directory or "").strip().strip('"').strip("'")
    if not directory:
        return ""
    return os.path.abspath(os.path.expanduser(directory))


def _is_text_file(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in TEXT_EXTENSIONS


def list_prompts(directory: str, pattern: str = "*.txt") -> list[str]:
    """Return sorted absolute text paths matching pattern (non-recursive)."""
    directory = _normalize_directory(directory)
    if not directory or not os.path.isdir(directory):
        return []

    pattern = _normalize_pattern(pattern)
    search = os.path.join(glob.escape(directory), pattern)
    paths = []
    for path in glob.glob(search):
        if os.path.isfile(path) and _is_text_file(path):
            paths.append(os.path.abspath(path))
    paths.sort(key=lambda p: os.path.basename(p).lower())
    return paths


def read_prompt_file(path: str) -> str | None:
    """Read a prompt text file; return None when missing or empty."""
    path = (path or "").strip()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read().strip()
    except OSError:
        return None
    return text or None


def resolve_raw_text(
    from_disk: bool,
    prompt_text: str,
    directory: str,
    mode: str,
    index: int,
    seed: int,
    pattern: str,
    fallback: str,
) -> tuple[str, str, str, int, int]:
    """
    Returns (raw, filename, path, selected_index, count).
    from_disk False → prompt_text widget; True → selected file in directory.
    """
    fallback = (fallback or "").strip()
    if not from_disk:
        text = (prompt_text or "").strip()
        return (text if text else fallback, "", "", 0, 0)

    paths = list_prompts(directory, pattern)
    if not paths:
        return (fallback, "", "", 0, 0)

    selected = resolve_index(mode, index, seed, len(paths))
    path = paths[selected]
    raw = read_prompt_file(path)
    if raw is None:
        raw = fallback
    return (raw, os.path.basename(path), path, selected, len(paths))


@PromptServer.instance.routes.get("/minimaxutils/listprompts")
async def minimaxutils_listprompts(request):
    directory = request.rel_url.query.get("directory", "")
    pattern = request.rel_url.query.get("pattern", "*.txt")
    paths = list_prompts(directory, pattern)
    files = [{"name": os.path.basename(p), "path": p} for p in paths]
    return web.json_response({"count": len(files), "files": files})


@PromptServer.instance.routes.get("/minimaxutils/resolveprompt")
async def minimaxutils_resolveprompt(request):
    """Resolve which prompt file the node would load — keeps JS preview in sync."""
    q = request.rel_url.query
    directory = q.get("directory", "")
    pattern = q.get("pattern", "*.txt")
    mode = q.get("mode", "sequential")
    try:
        index = int(q.get("index", "0"))
    except ValueError:
        index = 0
    try:
        seed = int(q.get("seed", "0"))
    except ValueError:
        seed = 0

    paths = list_prompts(directory, pattern)
    if not paths:
        return web.json_response({"count": 0, "index": 0, "file": None, "raw": ""})

    selected = resolve_index(mode, index, seed, len(paths))
    path = paths[selected]
    raw = read_prompt_file(path) or ""
    return web.json_response(
        {
            "count": len(paths),
            "index": selected,
            "file": {"name": os.path.basename(path), "path": path},
            "raw": raw,
        }
    )


class MinimaxPromptFromText:
    """
    Type behavior / picture-role text for the Prompt Compiler, or load from a
    directory of .txt files with the same sequential / random / custom controls
    as Load Image From Dir.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "from_disk": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "label_on": "directory",
                        "label_off": "manual",
                        "tooltip": "Off = prompt_text widget; on = load .txt from directory",
                    },
                ),
                "directory": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "E:/path/to/prompts",
                    },
                ),
                "mode": (["sequential", "random", "custom"], {"default": "sequential"}),
                "index": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFF,
                        "step": 1,
                        "control_after_generate": True,
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                    },
                ),
                "pattern": ("STRING", {"default": "*.txt", "multiline": False}),
                "prompt_text": (
                    "STRING",
                    {
                        "default": "action: ",
                        "multiline": True,
                        "placeholder": (
                            "action: watering plants with a garden hose\n"
                            "action_main: continues the beat\n"
                            "motion: camera pushes in slowly\n"
                            "# or freeform with slot=action_main\n"
                            "# or with picture=1:\n"
                            "# identity, clothing, and appearance; ignore background"
                        ),
                    },
                ),
                "slot": (
                    "STRING",
                    {
                        "default": "action",
                        "multiline": False,
                        "tooltip": (
                            "Target slot name (pose, action, action_main, camera_push, …). "
                            "Colors the node; freeform text is labeled for Compiler.bundle."
                        ),
                    },
                ),
                "picture": (
                    list(PICTURE_CHOICES),
                    {
                        "default": "(none)",
                        "tooltip": "Bind this text to MiniMax <Picture N> → fills {picN}",
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
                "fallback": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("snippet", "filename", "path")
    FUNCTION = "load"
    CATEGORY = "MinimaxUtils/prompt"
    DESCRIPTION = (
        "Manual or directory-loaded text for Minimax Prompt Compiler. "
        "Turn on from_disk and use sequential/random/custom like Load Image From Dir."
    )

    @classmethod
    def VALIDATE_INPUTS(cls, extract_key, slot, from_disk=False, directory="", pattern="*.txt"):
        ek = (extract_key or "").strip() or "(all)"
        if ek != "(all)" and not is_slot_name(ek):
            return f"extract_key: {extract_key!r} must be '(all)' or a slot name"
        sl = (slot or "").strip()
        if sl and not is_slot_name(sl):
            return f"slot: {slot!r} must be a-z / digits / underscore (e.g. action_main)"
        if from_disk:
            directory = _normalize_directory(directory)
            if not directory:
                return "directory is empty"
            if not os.path.isdir(directory):
                return f"Directory not found: {directory}"
            if not list_prompts(directory, pattern):
                return f"No prompts in '{directory}' matching '{pattern}'"
        return True

    def load(
        self,
        prompt_text,
        slot,
        picture,
        extract_key,
        fallback,
        from_disk=False,
        directory="",
        mode="sequential",
        index=0,
        seed=0,
        pattern="*.txt",
    ):
        extract_key = (extract_key or "").strip() or "(all)"
        slot = normalize_slot_name(slot) or "action"
        raw, filename, path, selected, count = resolve_raw_text(
            bool(from_disk), prompt_text, directory, mode, index, seed, pattern, fallback
        )
        snippet = (
            to_inject_snippet(raw, extract_key, picture, default_slot=slot) if raw else ""
        )
        if not snippet and (fallback or "").strip():
            snippet = (fallback or "").strip()
        display = format_display(raw) if raw else "(empty)"
        pic_i = normalize_picture_index(picture)
        if pic_i and raw:
            display = f"<Picture {pic_i}>\n{display}"
        if extract_key and extract_key != "(all)" and snippet:
            display = f"{extract_key} : {snippet}"
        elif snippet and snippet != raw:
            display = format_display(snippet)
        ui_slot = f"pic{pic_i}" if pic_i else slot
        return {
            "ui": {
                "display": [display],
                "snippet": [snippet],
                "slot": [ui_slot],
                "picture": [str(pic_i or "")],
                "index": [selected],
                "filename": [filename],
                "path": [path],
                "count": [count],
            },
            "result": (snippet, filename, path),
        }

    @classmethod
    def IS_CHANGED(
        cls,
        prompt_text,
        slot,
        picture,
        extract_key,
        fallback,
        from_disk=False,
        directory="",
        mode="sequential",
        index=0,
        seed=0,
        pattern="*.txt",
    ):
        m = hashlib.sha256()
        raw, filename, path, selected, count = resolve_raw_text(
            bool(from_disk), prompt_text, directory, mode, index, seed, pattern, fallback
        )
        m.update(
            f"{bool(from_disk)}|{slot}|{picture}|{extract_key}|{fallback}|{mode}|{index}|{seed}|{pattern}|{selected}|{count}".encode(
                "utf-8", errors="replace"
            )
        )
        m.update(raw.encode("utf-8", errors="replace"))
        if path:
            m.update(path.encode("utf-8", errors="replace"))
            try:
                m.update(str(os.path.getmtime(path)).encode("utf-8"))
            except OSError:
                pass
        else:
            m.update((prompt_text or "").encode("utf-8", errors="replace"))
        return m.digest().hex()
