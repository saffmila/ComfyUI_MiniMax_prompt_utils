"""Minimax Prompt From Text — manual slot/bundle snippets (no image path)."""

from __future__ import annotations

import hashlib

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


class MinimaxPromptFromText:
    """
    Type behavior / picture-role text for the Prompt Compiler without an image sidecar.

    Examples:
      action: watering plants with a garden hose
      action_main: continues the sequence toward the camera
      motion: camera pushes in with small amplitude at slow speed

    slot may be any name matching {slot} in the skeleton (pose, action_main, …).
    Freeform text is labeled as that slot for Compiler.bundle routing.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
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

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("snippet",)
    FUNCTION = "load"
    CATEGORY = "MinimaxUtils/prompt"
    DESCRIPTION = (
        "Manual text for Minimax Prompt Compiler. Use for action/motion/extra, custom "
        "template slots (action_main), or set picture=N to describe <Picture N>."
    )

    @classmethod
    def VALIDATE_INPUTS(cls, extract_key, slot):
        ek = (extract_key or "").strip() or "(all)"
        if ek != "(all)" and not is_slot_name(ek):
            return f"extract_key: {extract_key!r} must be '(all)' or a slot name"
        sl = (slot or "").strip()
        if sl and not is_slot_name(sl):
            return f"slot: {slot!r} must be a-z / digits / underscore (e.g. action_main)"
        return True

    def load(self, prompt_text, slot, picture, extract_key, fallback):
        extract_key = (extract_key or "").strip() or "(all)"
        slot = normalize_slot_name(slot) or "action"
        raw = (prompt_text or "").strip() or (fallback or "").strip()
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
            },
            "result": (snippet,),
        }

    @classmethod
    def IS_CHANGED(cls, prompt_text, slot, picture, extract_key, fallback):
        m = hashlib.sha256()
        m.update(
            f"{prompt_text}|{slot}|{picture}|{extract_key}|{fallback}".encode(
                "utf-8", errors="replace"
            )
        )
        return m.digest().hex()
