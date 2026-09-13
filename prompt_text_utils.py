"""Shared sidecar / key-value text helpers (no ComfyUI server imports)."""

from __future__ import annotations

import re

_KEY_LINE = re.compile(r"^([A-Za-z][\w\s_-]{0,32}):\s*(.+)$")

# Fixed ComfyUI sockets on the compiler (always present).
BEHAVIOR_SLOTS = ("pose", "camera", "zoom", "env", "motion", "action", "extra")
PIC_SLOTS = tuple(f"pic{i}" for i in range(1, 10))
BUILTIN_SLOTS = BEHAVIOR_SLOTS + PIC_SLOTS
ALL_SLOTS = BUILTIN_SLOTS  # back-compat alias

# Any skeleton / sidecar slot: {action_main}, action_setup: …
SLOT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
PLACEHOLDER_RE = re.compile(r"\{([A-Za-z][A-Za-z0-9_]*)\}")
_SLOT_LINE = re.compile(r"^([A-Za-z][A-Za-z0-9_]{0,31})\s*:\s*(.+)$")
_SLOT_SPLIT = re.compile(r",\s*(?=[A-Za-z][A-Za-z0-9_]{0,31}\s*:)")

# Alias keys in sidecar → canonical pic description (mapped via picture index).
_DESC_ALIASES = frozenset({"description", "desc", "ref", "reference"})


def is_slot_name(name: str | None) -> bool:
    return bool(name) and bool(SLOT_NAME_RE.match(str(name).strip().lower()))


def is_pic_slot(name: str | None) -> bool:
    s = str(name or "").strip().lower()
    return bool(re.fullmatch(r"pic[1-9]", s))


def normalize_slot_name(name: str | None) -> str:
    s = str(name or "").strip().lower()
    return s if is_slot_name(s) else ""


def discover_placeholders(skeleton: str | None) -> list[str]:
    """Ordered unique {slot} names found in a skeleton."""
    seen: set[str] = set()
    out: list[str] = []
    for m in PLACEHOLDER_RE.finditer(skeleton or ""):
        key = m.group(1).lower()
        if key in seen or not is_slot_name(key):
            continue
        seen.add(key)
        out.append(key)
    return out


def normalize_slots_list(slots) -> list[str]:
    """Validate / dedupe an explicit template slots list."""
    out: list[str] = []
    seen: set[str] = set()
    if not isinstance(slots, (list, tuple)):
        return out
    for item in slots:
        key = normalize_slot_name(item)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def resolve_template_slots(skeleton: str | None, declared=None) -> list[str]:
    """
    Template slot list: explicit `slots` when present, else discover from skeleton.
    Always union with placeholders actually used in the skeleton.
    """
    discovered = discover_placeholders(skeleton)
    declared_list = normalize_slots_list(declared)
    if not declared_list:
        return discovered
    seen = set(declared_list)
    out = list(declared_list)
    for key in discovered:
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def content_lines(text: str) -> list[str]:
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines


def parse_kv_pairs(text: str) -> list[tuple[str, str]] | None:
    """Return key/value pairs when every content line is `key: value`; else None."""
    lines = content_lines(text)
    if not lines:
        return None
    pairs: list[tuple[str, str]] = []
    for line in lines:
        m = _KEY_LINE.match(line)
        if not m:
            return None
        pairs.append((m.group(1).strip().lower(), m.group(2).strip()))
    return pairs


def parse_slot_bundle(text: str | None) -> dict[str, str]:
    """
    Split multi-key sidecar text into slot → value.

    Accepts any valid slot key (built-in or template-defined), e.g.:
      pose: standing relaxed
      action_main: begins the sequence
      pic1: young woman with long dark hair

    Or one-line comma form:
      pose: standing relaxed, camera: low angle, action_main: waves
    """
    text = (text or "").strip()
    if not text:
        return {}

    lines = content_lines(text)

    # 1) Newline form: each line is a slot key.
    if len(lines) >= 2:
        out: dict[str, str] = {}
        ok = True
        for line in lines:
            m = _SLOT_LINE.match(line)
            if not m:
                ok = False
                break
            key = m.group(1).strip().lower()
            if not is_slot_name(key):
                ok = False
                break
            out[key] = m.group(2).strip()
        if ok and out:
            return out

    # 2) Comma-separated slots (one line or flattened).
    flat = ", ".join(lines) if lines else text
    parts = _SLOT_SPLIT.split(flat)
    out: dict[str, str] = {}
    for part in parts:
        m = _SLOT_LINE.match(part.strip())
        if not m:
            continue
        key = m.group(1).strip().lower()
        val = m.group(2).strip().rstrip(",")
        if is_slot_name(key) and val:
            out[key] = val
    if out:
        return out

    # 3) Single slot line.
    m = _SLOT_LINE.match(text)
    if m:
        key = m.group(1).strip().lower()
        if is_slot_name(key):
            return {key: m.group(2).strip()}
    return {}


def normalize_picture_index(picture) -> int | None:
    """Return 1–9 or None for '(none)' / empty / invalid."""
    if picture is None:
        return None
    s = str(picture).strip().lower()
    if not s or s in ("(none)", "none", "0", "-"):
        return None
    try:
        n = int(s)
    except ValueError:
        return None
    if 1 <= n <= 9:
        return n
    return None


def expand_sidecar_slots(raw: str, picture: int | None = None) -> dict[str, str]:
    """
    Parse sidecar into compiler slots.

    Supports:
      pose: … / camera: … / action_main: … / pic3: …
      description: …   (→ picN when picture index is set)
      freeform text    (→ picN when picture index is set)
    """
    text = (raw or "").strip()
    if not text:
        return {}

    out = parse_slot_bundle(text)
    pairs = parse_kv_pairs(text)
    if pairs:
        for key, val in pairs:
            if not val:
                continue
            key_l = key.strip().lower()
            # description/desc/ref → picN when picture is set (before generic slot)
            if key_l in _DESC_ALIASES and picture:
                out.setdefault(f"pic{picture}", val)
            elif is_slot_name(key_l):
                out.setdefault(key_l, val)

    if picture:
        pic_key = f"pic{picture}"
        # Remap aliases already stored as literal slot keys (e.g. description:)
        for alias in _DESC_ALIASES:
            if alias in out:
                val = out.pop(alias)
                if val:
                    out.setdefault(pic_key, val)
        if pic_key not in out and not out and not pairs:
            free = " ".join(content_lines(text)).strip()
            if free:
                out[pic_key] = free

    return out


def format_display(text: str) -> str:
    """Human-readable preview (aligned key : value, or raw freeform)."""
    text = (text or "").strip()
    if not text:
        return "(empty)"
    bundled = parse_slot_bundle(text)
    if len(bundled) >= 2:
        width = max(len(k) for k in bundled)
        return "\n".join(f"{k.ljust(width)} : {v}" for k, v in bundled.items())
    pairs = parse_kv_pairs(text)
    if not pairs:
        return text
    width = max(len(k) for k, _ in pairs)
    return "\n".join(f"{k.ljust(width)} : {v}" for k, v in pairs)


def format_pic_insert(value: str) -> str:
    """Optional insert after a <Picture N> clause — prepend separator when needed."""
    value = (value or "").strip()
    if not value:
        return ""
    # Never leak 'pic1:' / 'pose:' labels into the MiniMax prompt body.
    m = _SLOT_LINE.match(value)
    if m:
        value = m.group(2).strip()
    if not value:
        return ""
    if value[0] in ",:;.-(":
        return " " + value.lstrip() if not value.startswith(" ") else value
    return f" - {value}"


def to_inject_snippet(
    text: str,
    extract_key: str = "(all)",
    picture=None,
    default_slot: str | None = None,
) -> str:
    """
    Build snippet for the compiler.
    extract_key '(all)' — keep newline kv (bundle-friendly); freeform as one line
    extract_key 'pose' / 'action_main' / 'pic2' — only that key's value
    picture 1–9 — map description:/freeform onto picN
    default_slot — when text is freeform (no keys) and picture is unset, label as
      'slot: value' so Compiler.bundle can route it
    """
    text = (text or "").strip()
    if not text:
        return text

    pic_i = normalize_picture_index(picture)
    key = (extract_key or "(all)").strip().lower()
    bundled = expand_sidecar_slots(text, pic_i)
    slot = normalize_slot_name(default_slot)

    free = " ".join(content_lines(text)).strip() or text
    is_freeform = not bundled and not parse_kv_pairs(text) and not parse_slot_bundle(text)

    if key and key != "(all)":
        if key in bundled:
            return bundled[key]
        if is_freeform and free and key == slot:
            return free
        return ""

    if bundled:
        return "\n".join(f"{k}: {v}" for k, v in bundled.items())

    pairs = parse_kv_pairs(text)
    if pairs:
        return "\n".join(f"{k}: {v}" for k, v in pairs)

    if is_freeform and free and slot and not pic_i:
        return f"{slot}: {free}"
    return free
