"""Minimax Prompt Director (sketch) — one-shot prompt builder: refs + timed beats → STRING."""

from __future__ import annotations

import glob
import hashlib
import json
import os

from aiohttp import web
from server import PromptServer

from load_image_from_dir import _safe_image_path, list_images, resolve_index

MAX_REFS = 9
DEFAULT_REFS = 3
TEXT_EXTENSIONS = {".txt", ".md", ".prompt"}
_BAD_PATTERNS = frozenset({"fixed", "increment", "decrement", "randomize"})


def _normalize_pattern(pattern: str, fallback: str = "*.txt") -> str:
    pattern = (pattern or fallback).strip() or fallback
    if pattern.lower() in _BAD_PATTERNS:
        return fallback
    return pattern


def _normalize_directory(directory: str) -> str:
    directory = (directory or "").strip().strip('"').strip("'")
    if not directory:
        return ""
    return os.path.abspath(os.path.expanduser(directory))


def list_prompts(directory: str, pattern: str = "*.txt") -> list[str]:
    directory = _normalize_directory(directory)
    if not directory or not os.path.isdir(directory):
        return []
    pattern = _normalize_pattern(pattern)
    search = os.path.join(glob.escape(directory), pattern)
    paths = []
    for path in glob.glob(search):
        if os.path.isfile(path) and os.path.splitext(path)[1].lower() in TEXT_EXTENSIONS:
            paths.append(os.path.abspath(path))
    paths.sort(key=lambda p: os.path.basename(p).lower())
    return paths


def read_prompt_file(path: str) -> str | None:
    path = (path or "").strip()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read().strip()
    except OSError:
        return None
    return text or None


def _default_ref() -> dict:
    return {
        "directory": "",
        "file": "",
        "mode": "sequential",
        "index": 0,
        "seed": 0,
        "pattern": "*",
        "description": "",
    }


def _default_beat() -> dict:
    return {
        "text": "",
        "duration": 3.0,
        "from_disk": False,
        "directory": "",
        "mode": "sequential",
        "index": 0,
        "seed": 0,
        "pattern": "*.txt",
    }


def default_state() -> dict:
    return {
        "globals": {
            "style": "Cinematic, live-action, high-quality film aesthetic.",
            "soundscape": "Quiet ambient sound matching the scene.",
            "music": "N/A",
        },
        "refs": [_default_ref() for _ in range(DEFAULT_REFS)],
        "beats": [_default_beat()],
    }


def parse_state(raw) -> dict:
    base = default_state()
    if raw is None or raw == "":
        return base
    if isinstance(raw, dict):
        data = raw
    else:
        try:
            data = json.loads(str(raw))
        except (TypeError, json.JSONDecodeError):
            return base
    if not isinstance(data, dict):
        return base

    g_in = data.get("globals") if isinstance(data.get("globals"), dict) else {}
    base["globals"] = {
        "style": str(g_in.get("style", base["globals"]["style"])),
        "soundscape": str(g_in.get("soundscape", base["globals"]["soundscape"])),
        "music": str(g_in.get("music", base["globals"]["music"])),
    }

    refs = data.get("refs")
    if isinstance(refs, list) and refs:
        out_refs = []
        for item in refs[:MAX_REFS]:
            if not isinstance(item, dict):
                continue
            r = _default_ref()
            r["directory"] = str(item.get("directory", "") or "")
            r["file"] = str(item.get("file", "") or "")
            r["mode"] = str(item.get("mode", "sequential") or "sequential")
            try:
                r["index"] = int(item.get("index", 0) or 0)
            except (TypeError, ValueError):
                r["index"] = 0
            try:
                r["seed"] = int(item.get("seed", 0) or 0)
            except (TypeError, ValueError):
                r["seed"] = 0
            r["pattern"] = str(item.get("pattern", "*") or "*")
            r["description"] = str(item.get("description", "") or "")
            out_refs.append(r)
        if out_refs:
            base["refs"] = out_refs

    beats = data.get("beats")
    if isinstance(beats, list) and beats:
        out_beats = []
        for item in beats:
            if not isinstance(item, dict):
                continue
            b = _default_beat()
            b["text"] = str(item.get("text", "") or "")
            try:
                b["duration"] = max(0.1, float(item.get("duration", 3.0) or 3.0))
            except (TypeError, ValueError):
                b["duration"] = 3.0
            b["from_disk"] = bool(item.get("from_disk", False))
            b["directory"] = str(item.get("directory", "") or "")
            b["mode"] = str(item.get("mode", "sequential") or "sequential")
            try:
                b["index"] = int(item.get("index", 0) or 0)
            except (TypeError, ValueError):
                b["index"] = 0
            try:
                b["seed"] = int(item.get("seed", 0) or 0)
            except (TypeError, ValueError):
                b["seed"] = 0
            b["pattern"] = _normalize_pattern(str(item.get("pattern", "*.txt") or "*.txt"))
            out_beats.append(b)
        if out_beats:
            base["beats"] = out_beats

    return base


def resolve_ref_path(ref: dict) -> tuple[str, str]:
    """Return (filename, abs_path) or ('', '')."""
    file_path = (ref.get("file") or "").strip()
    if file_path:
        safe = _safe_image_path(file_path)
        if safe:
            return os.path.basename(safe), safe

    paths = list_images(ref.get("directory", ""), ref.get("pattern", "*"))
    if not paths:
        return "", ""
    selected = resolve_index(
        ref.get("mode", "sequential"),
        int(ref.get("index", 0) or 0),
        int(ref.get("seed", 0) or 0),
        len(paths),
    )
    path = paths[selected]
    return os.path.basename(path), path


def resolve_beat_text(beat: dict) -> str:
    # UI is source of truth (disk load + optional <Picture N> inserts).
    # from_disk only controls how the UI loads/refreshes text, not compile.
    return (beat.get("text") or "").strip()


def _fmt_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    whole = int(seconds)
    ms = int(round((seconds - whole) * 1000))
    if ms >= 1000:
        whole += 1
        ms = 0
    mm = whole // 60
    ss = whole % 60
    return f"{mm:02d}:{ss:02d}.{ms:03d}"


def compile_director_prompt(state: dict) -> tuple[str, list[dict], list[dict]]:
    """
    Build a single-shot REF2VA-style prompt.
    Returns (prompt, resolved_refs, resolved_beats).
    """
    state = parse_state(state)
    g = state["globals"]
    style = (g.get("style") or "").strip() or "Cinematic, live-action."
    soundscape = (g.get("soundscape") or "").strip() or "N/A"
    music = (g.get("music") or "").strip() or "N/A"

    resolved_refs = []
    for i, ref in enumerate(state["refs"], start=1):
        name, path = resolve_ref_path(ref)
        desc = (ref.get("description") or "").strip()
        resolved_refs.append(
            {
                "n": i,
                "filename": name,
                "path": path,
                "description": desc,
            }
        )

    resolved_beats = []
    for beat in state["beats"]:
        text = resolve_beat_text(beat)
        dur = max(0.1, float(beat.get("duration", 3.0) or 3.0))
        resolved_beats.append({"text": text, "duration": dur})

    # subject_definitions
    subj_lines = []
    for r in resolved_refs:
        n = r["n"]
        desc = r["description"]
        if r["path"] or desc:
            if desc:
                subj_lines.append(
                    f"<Subject {n}> is defined by <Picture {n}> — {desc}."
                )
            else:
                subj_lines.append(
                    f"<Subject {n}> is defined by <Picture {n}>."
                )
        else:
            subj_lines.append(f"<Picture {n}> — (no image selected).")

    # timeline prose inside one Extender shot
    total = sum(b["duration"] for b in resolved_beats) or 1.0
    beat_parts = []
    t = 0.0
    for i, b in enumerate(resolved_beats):
        text = b["text"] or "(empty beat)"
        dur = b["duration"]
        start = t
        t += dur
        if i == 0:
            beat_parts.append(
                f"From the start through {_fmt_time(dur)} ({dur:.1f}s), {text}"
            )
        else:
            beat_parts.append(
                f"At {_fmt_time(start)}, for the next {dur:.1f}s, {text}"
            )
    beats_prose = " ".join(beat_parts)

    pic_mentions = ", ".join(
        f"<Picture {r['n']}>" for r in resolved_refs if r["path"] or r["description"]
    )
    subject_mentions = ", ".join(
        f"<Subject {r['n']}>" for r in resolved_refs if r["path"] or r["description"]
    )

    summary_body = (
        f"[reference generation] A single continuous shot ({total:.1f}s). "
    )
    if subject_mentions:
        summary_body += f"Uses {subject_mentions}. "
    summary_body += beats_prose

    retention_lines = []
    for r in resolved_refs:
        if not (r["path"] or r["description"]):
            continue
        retention_lines.append(
            f"<Subject {r['n']}> (appears in [Shot 1]): fully_preserved — "
            f"identity and appearance from <Picture {r['n']}> remain unchanged."
        )
    if not retention_lines:
        retention_lines.append(
            "<Subject 1> (appears in [Shot 1]): fully_preserved — appearance remains unchanged."
        )

    detail = (
        f"{style}\n"
        f"[Shot 1] A single continuous shot. "
    )
    if pic_mentions:
        detail += f"Reference material: {pic_mentions}. "
    if subject_mentions:
        detail += f"On-screen: {subject_mentions}. "
    detail += beats_prose

    prompt = "\n".join(
        [
            "subject_definitions:",
            *subj_lines,
            "",
            "summary:",
            summary_body,
            "",
            "retention_analysis:",
            *retention_lines,
            "",
            "detailed_description:",
            detail,
            "",
            f"overall_soundscape: {soundscape}",
            "",
            f"non_diegetic_music: {music}",
        ]
    )
    return prompt.strip() + "\n", resolved_refs, resolved_beats


@PromptServer.instance.routes.post("/minimaxutils/director_preview")
async def minimaxutils_director_preview(request):
    """Live compile Director state → colored preview without running the workflow."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)

    state = data.get("director_state")
    if state is None:
        state = data
    try:
        prompt, refs, beats = compile_director_prompt(state)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)

    filled = {}
    for r in refs:
        if r.get("description"):
            filled[f"pic{r['n']}"] = r["description"]
        if r.get("path"):
            filled[f"path{r['n']}"] = r["path"]
            filled[f"file{r['n']}"] = r.get("filename") or ""
    for i, b in enumerate(beats, start=1):
        if b.get("text"):
            filled[f"beat{i}"] = b["text"]

    return web.json_response(
        {
            "ok": True,
            "prompt": prompt,
            "filled": filled,
            "refs": refs,
            "beats": beats,
            "total_duration": sum(b["duration"] for b in beats),
        }
    )


class MinimaxPromptDirector:
    """
    Sketch UI node: refs (dir load) + timed beats (manual or dir load) → one prompt.

    One Director instance = one Extender shot. Duplicate the node for more shots.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "director_state": (
                    "STRING",
                    {
                        "default": json.dumps(default_state(), ensure_ascii=False),
                        "multiline": True,
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "resolved_json")
    FUNCTION = "build"
    CATEGORY = "MinimaxUtils/prompt"
    DESCRIPTION = (
        "Prompt Director: reference images + timed action beats → one MiniMax prompt. "
        "Supports directory loading for refs and beat prompts."
    )

    def build(self, director_state):
        prompt, refs, beats = compile_director_prompt(director_state)
        resolved = {
            "refs": refs,
            "beats": beats,
            "total_duration": sum(b["duration"] for b in beats),
        }
        return {
            "ui": {
                "prompt": [prompt],
                "resolved_json": [json.dumps(resolved, ensure_ascii=False)],
            },
            "result": (prompt, json.dumps(resolved, ensure_ascii=False, indent=2)),
        }

    @classmethod
    def IS_CHANGED(cls, director_state):
        state = parse_state(director_state)
        m = hashlib.sha256()
        m.update(json.dumps(state, sort_keys=True, ensure_ascii=False).encode("utf-8"))
        for ref in state["refs"]:
            _, path = resolve_ref_path(ref)
            if path:
                try:
                    m.update(str(os.path.getmtime(path)).encode("utf-8"))
                except OSError:
                    pass
        for beat in state["beats"]:
            if beat.get("from_disk"):
                text = resolve_beat_text(beat)
                m.update(text.encode("utf-8", errors="replace"))
        return m.digest().hex()
