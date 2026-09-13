"""Prompt template presets on disk (list / load / save).

Pack (shipped, git):     prompt_templates/
Local (private, gitignored): prompt_templates_local/
Optional override dir:   $MINIMAXUTILS_TEMPLATES_DIR

Load order (first hit wins): writable dir → local → pack.
Save always writes to the writable dir (never overwrites pack by accident).
"""

from __future__ import annotations

import json
import os
import re

from aiohttp import web
from server import PromptServer

from prompt_text_utils import resolve_template_slots

_PACK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt_templates")
_LOCAL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt_templates_local")
_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")
_ENV_DIR = "MINIMAXUTILS_TEMPLATES_DIR"


def pack_templates_dir() -> str:
    os.makedirs(_PACK_DIR, exist_ok=True)
    return _PACK_DIR


def local_templates_dir() -> str:
    os.makedirs(_LOCAL_DIR, exist_ok=True)
    return _LOCAL_DIR


def env_templates_dir() -> str | None:
    raw = (os.environ.get(_ENV_DIR) or "").strip().strip('"').strip("'")
    if not raw:
        return None
    path = os.path.abspath(os.path.expanduser(raw))
    os.makedirs(path, exist_ok=True)
    return path


def writable_templates_dir() -> str:
    """Where Save writes. Env dir if set, else prompt_templates_local/."""
    return env_templates_dir() or local_templates_dir()


def templates_dir() -> str:
    """Back-compat alias — pack directory (shipped presets)."""
    return pack_templates_dir()


def _iter_search_dirs() -> list[tuple[str, str]]:
    """
    (source, path) in load priority order.
    source: 'user' | 'local' | 'pack'
    """
    out: list[tuple[str, str]] = []
    env = env_templates_dir()
    if env:
        out.append(("user", env))
    out.append(("local", local_templates_dir()))
    out.append(("pack", pack_templates_dir()))
    return out


def validate_template_name(name: str) -> str | None:
    name = (name or "").strip()
    if not name or not _SAFE_NAME.match(name):
        return None
    return name


def _read_template_file(path: str, name: str, source: str) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    skeleton = data.get("skeleton")
    if not isinstance(skeleton, str):
        return None
    slots = resolve_template_slots(skeleton, data.get("slots"))
    label = str(data.get("label") or data.get("name") or name)
    return {
        "name": name,
        "label": label,
        "skeleton": skeleton,
        "slots": slots,
        "source": source,
        "path": path,
    }


def _scan_dir(source: str, directory: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    if not os.path.isdir(directory):
        return found
    try:
        names = os.listdir(directory)
    except OSError:
        return found
    for fname in names:
        if not fname.endswith(".json"):
            continue
        name = fname[:-5]
        if not _SAFE_NAME.match(name):
            continue
        path = os.path.join(directory, fname)
        data = _read_template_file(path, name, source)
        if data:
            found[name] = data
    return found


def list_templates() -> list[dict]:
    """
    Merged catalog. Higher-priority dirs override lower ones on the same name.
    Returns name, label, source (user|local|pack).
    """
    merged: dict[str, dict] = {}
    # Fill from lowest priority first so higher can overwrite.
    for source, directory in reversed(_iter_search_dirs()):
        for name, data in _scan_dir(source, directory).items():
            merged[name] = {
                "name": name,
                "label": data["label"],
                "source": source,
            }
    items = sorted(merged.values(), key=lambda t: (t["source"] != "pack", t["name"]))
    return items


def load_template(name: str) -> dict | None:
    name = validate_template_name(name)
    if not name:
        return None
    for source, directory in _iter_search_dirs():
        path = os.path.join(directory, f"{name}.json")
        if os.path.isfile(path):
            return _read_template_file(path, name, source)
    return None


def save_template(
    name: str,
    skeleton: str,
    label: str | None = None,
    slots=None,
) -> dict | None:
    """Always save into the writable (local/user) directory — never the pack."""
    name = validate_template_name(name)
    if not name:
        return None
    if not isinstance(skeleton, str):
        return None
    resolved = resolve_template_slots(skeleton, slots)
    payload = {
        "name": name,
        "label": (label or name).strip() or name,
        "slots": resolved,
        "skeleton": skeleton,
    }
    directory = writable_templates_dir()
    path = os.path.join(directory, f"{name}.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    source = "user" if env_templates_dir() else "local"
    return {
        **payload,
        "source": source,
        "path": path,
    }


@PromptServer.instance.routes.get("/minimaxutils/templates")
async def minimaxutils_templates_list(_request):
    return web.json_response(
        {
            "ok": True,
            "templates": list_templates(),
            "writable_dir": writable_templates_dir(),
            "pack_dir": pack_templates_dir(),
            "local_dir": local_templates_dir(),
        }
    )


@PromptServer.instance.routes.get("/minimaxutils/templates/{name}")
async def minimaxutils_templates_get(request):
    name = request.match_info.get("name", "")
    data = load_template(name)
    if data is None:
        return web.json_response({"ok": False, "error": "template not found"}, status=404)
    # Don't leak absolute paths to the browser unless useful — keep path for debug.
    return web.json_response({"ok": True, "template": data})


@PromptServer.instance.routes.post("/minimaxutils/templates/{name}")
async def minimaxutils_templates_save(request):
    name = request.match_info.get("name", "")
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)
    skeleton = body.get("skeleton")
    if not isinstance(skeleton, str):
        return web.json_response({"ok": False, "error": "skeleton must be a string"}, status=400)
    saved = save_template(name, skeleton, body.get("label"), body.get("slots"))
    if saved is None:
        return web.json_response({"ok": False, "error": "invalid template name"}, status=400)
    return web.json_response({"ok": True, "template": saved})
