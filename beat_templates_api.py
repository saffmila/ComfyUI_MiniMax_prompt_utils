"""Beat template presets for Prompt Director (timeline atoms, not full REF2VA).

Pack (shipped, git):     beat_templates/
Local (private, gitignored): beat_templates_local/
Optional override dir:   $MINIMAXUTILS_BEAT_TEMPLATES_DIR

Load order (first hit wins): writable dir → local → pack.
"""

from __future__ import annotations

import json
import os
import re

from aiohttp import web
from server import PromptServer

from prompt_text_utils import PLACEHOLDER_RE, resolve_template_slots

_PACK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "beat_templates")
_LOCAL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "beat_templates_local")
_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")
_ENV_DIR = "MINIMAXUTILS_BEAT_TEMPLATES_DIR"


def pack_beat_templates_dir() -> str:
    os.makedirs(_PACK_DIR, exist_ok=True)
    return _PACK_DIR


def local_beat_templates_dir() -> str:
    os.makedirs(_LOCAL_DIR, exist_ok=True)
    return _LOCAL_DIR


def env_beat_templates_dir() -> str | None:
    raw = (os.environ.get(_ENV_DIR) or "").strip().strip('"').strip("'")
    if not raw:
        return None
    path = os.path.abspath(os.path.expanduser(raw))
    os.makedirs(path, exist_ok=True)
    return path


def writable_beat_templates_dir() -> str:
    return env_beat_templates_dir() or local_beat_templates_dir()


def validate_beat_template_name(name: str) -> str | None:
    name = (name or "").strip()
    if not name or not _SAFE_NAME.match(name):
        return None
    return name


def _normalize_defaults(raw) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        k = str(key or "").strip().lower()
        if not k or not isinstance(val, str):
            continue
        out[k] = val.strip()
    return out


def fill_beat_skeleton(
    skeleton: str,
    defaults: dict | None = None,
    overrides: dict | None = None,
) -> str:
    """Replace {slots} with defaults/overrides; drop unknown placeholders."""
    values = {**_normalize_defaults(defaults), **_normalize_defaults(overrides)}

    def repl(m: re.Match) -> str:
        return values.get(m.group(1).lower(), "")

    text = PLACEHOLDER_RE.sub(repl, skeleton or "")
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


def _read_beat_template_file(path: str, name: str, source: str) -> dict | None:
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
    try:
        order = int(data.get("order", 100) or 100)
    except (TypeError, ValueError):
        order = 100
    defaults = _normalize_defaults(data.get("defaults"))
    return {
        "name": name,
        "label": label,
        "order": order,
        "skeleton": skeleton,
        "slots": slots,
        "defaults": defaults,
        "source": source,
        "path": path,
        "filled": fill_beat_skeleton(skeleton, defaults),
    }


def _iter_search_dirs() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    env = env_beat_templates_dir()
    if env:
        out.append(("user", env))
    out.append(("local", local_beat_templates_dir()))
    out.append(("pack", pack_beat_templates_dir()))
    return out


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
        data = _read_beat_template_file(path, name, source)
        if data:
            found[name] = data
    return found


def list_beat_templates() -> list[dict]:
    merged: dict[str, dict] = {}
    for source, directory in reversed(_iter_search_dirs()):
        for name, data in _scan_dir(source, directory).items():
            merged[name] = {
                "name": name,
                "label": data["label"],
                "order": data["order"],
                "source": source,
            }
    return sorted(
        merged.values(),
        key=lambda t: (t.get("order", 100), t["name"]),
    )


def load_beat_template(name: str) -> dict | None:
    name = validate_beat_template_name(name)
    if not name:
        return None
    for source, directory in _iter_search_dirs():
        path = os.path.join(directory, f"{name}.json")
        if os.path.isfile(path):
            return _read_beat_template_file(path, name, source)
    return None


@PromptServer.instance.routes.get("/minimaxutils/beat_templates")
async def minimaxutils_beat_templates_list(_request):
    return web.json_response(
        {
            "ok": True,
            "templates": list_beat_templates(),
            "writable_dir": writable_beat_templates_dir(),
            "pack_dir": pack_beat_templates_dir(),
            "local_dir": local_beat_templates_dir(),
        }
    )


@PromptServer.instance.routes.get("/minimaxutils/beat_templates/{name}")
async def minimaxutils_beat_templates_get(request):
    name = request.match_info.get("name", "")
    data = load_beat_template(name)
    if data is None:
        return web.json_response({"ok": False, "error": "beat template not found"}, status=404)
    return web.json_response({"ok": True, "template": data})
