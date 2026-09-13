"""Comfyui-MinimaxUtils — helpers for MiniMax / Hailuo video extension workflows."""

import os
import sys
import traceback

# ComfyUI loads custom nodes via spec_from_file_location without package search
# locations, so relative imports are unreliable — import from this folder directly.
_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_LOG = os.path.join(_PKG_DIR, "_load_debug.txt")


def _dbg(msg: str) -> None:
    print(f"[MinimaxUtils] {msg}")
    try:
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except OSError:
        pass


try:
    if os.path.isfile(_LOG):
        os.remove(_LOG)
except OSError:
    pass

# --- core nodes ---
try:
    from load_image_from_dir import LoadImageFromDir
    from minimax_prompt_compiler import MinimaxPromptCompiler
    from minimax_prompt_from_image import MinimaxPromptFromImage
    from minimax_prompt_from_text import MinimaxPromptFromText
    from seamless_video_stitcher import SeamlessVideoStitcher

    NODE_CLASS_MAPPINGS.update(
        {
            "SeamlessVideoStitcher": SeamlessVideoStitcher,
            "LoadImageFromDir": LoadImageFromDir,
            "MinimaxPromptFromImage": MinimaxPromptFromImage,
            "MinimaxPromptFromText": MinimaxPromptFromText,
            "MinimaxPromptCompiler": MinimaxPromptCompiler,
        }
    )
    NODE_DISPLAY_NAME_MAPPINGS.update(
        {
            "SeamlessVideoStitcher": "Seamless Video Stitcher (RIFE)",
            "LoadImageFromDir": "Load Image From Dir",
            "MinimaxPromptFromImage": "Minimax Prompt From Image",
            "MinimaxPromptFromText": "Minimax Prompt From Text",
            "MinimaxPromptCompiler": "Minimax Prompt Compiler",
        }
    )
    _dbg("core OK")
except Exception as e:
    _dbg(f"CORE FAILED: {e}")
    traceback.print_exc()

# --- prompt director ---
try:
    from minimax_prompt_director import MinimaxPromptDirector

    NODE_CLASS_MAPPINGS["MinimaxPromptDirector"] = MinimaxPromptDirector
    NODE_DISPLAY_NAME_MAPPINGS["MinimaxPromptDirector"] = "Minimax Prompt Director"
    _dbg(
        f"director OK category={getattr(MinimaxPromptDirector, 'CATEGORY', '?')} "
        f"keys={list(NODE_CLASS_MAPPINGS.keys())}"
    )
except Exception as e:
    _dbg(f"DIRECTOR FAILED: {e}")
    traceback.print_exc()

# --- template HTTP routes ---
try:
    import prompt_templates_api  # noqa: F401

    _dbg("templates API OK")
except Exception as e:
    _dbg(f"templates API FAILED: {e}")
    traceback.print_exc()

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

_dbg(f"final mappings: {list(NODE_CLASS_MAPPINGS.keys())}")
