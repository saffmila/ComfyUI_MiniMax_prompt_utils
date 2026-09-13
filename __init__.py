"""Comfyui-MinimaxUtils — helpers for MiniMax / Hailuo video extension workflows."""

import os
import sys

# ComfyUI loads custom nodes via spec_from_file_location without package search
# locations, so relative imports are unreliable — import from this folder directly.
_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)

from load_image_from_dir import LoadImageFromDir
from minimax_prompt_compiler import MinimaxPromptCompiler
from minimax_prompt_from_image import MinimaxPromptFromImage
from minimax_prompt_from_text import MinimaxPromptFromText
from seamless_video_stitcher import SeamlessVideoStitcher
import prompt_templates_api  # noqa: F401 — registers /minimaxutils/templates routes

NODE_CLASS_MAPPINGS = {
    "SeamlessVideoStitcher": SeamlessVideoStitcher,
    "LoadImageFromDir": LoadImageFromDir,
    "MinimaxPromptFromImage": MinimaxPromptFromImage,
    "MinimaxPromptFromText": MinimaxPromptFromText,
    "MinimaxPromptCompiler": MinimaxPromptCompiler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SeamlessVideoStitcher": "Seamless Video Stitcher (RIFE)",
    "LoadImageFromDir": "Load Image From Dir",
    "MinimaxPromptFromImage": "Minimax Prompt From Image",
    "MinimaxPromptFromText": "Minimax Prompt From Text",
    "MinimaxPromptCompiler": "Minimax Prompt Compiler",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
