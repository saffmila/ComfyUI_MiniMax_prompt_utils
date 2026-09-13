"""SeamlessVideoStitcher — trim original, RIFE-bridge the seam, append AI extension."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import torch
import torch.nn.functional as F

logger = logging.getLogger("Comfyui-MinimaxUtils")

# Fallback list if ComfyUI-Frame-Interpolation is not importable at INPUT_TYPES time.
_DEFAULT_RIFE_CKPTS = [
    "rife47.pth",
    "rife49.pth",
    "rife417.pth",
    "rife426.pth",
    "sudo_rife4_269.662_testV1_scale1.pth",
]


def _frame_interp_root() -> Path | None:
    """Locate the ComfyUI-Frame-Interpolation custom node directory."""
    custom_nodes = Path(__file__).resolve().parent.parent
    for name in ("ComfyUI-Frame-Interpolation", "comfyui-frame-interpolation"):
        candidate = custom_nodes / name
        if candidate.is_dir():
            return candidate
    return None


def _import_rife():
    """
    Import RIFE_VFI and checkpoint names from ComfyUI-Frame-Interpolation.

    That package adds itself to sys.path on load; we mirror that so this node
    works regardless of custom-node load order.
    """
    root = _frame_interp_root()
    if root is None:
        raise ImportError(
            "ComfyUI-Frame-Interpolation not found in custom_nodes. "
            "Install it (Manager: ComfyUI-Frame-Interpolation) and place RIFE "
            "weights under its ckpts/rife folder."
        )
    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
    from vfi_models.rife import CKPT_NAME_VER_DICT, RIFE_VFI

    return RIFE_VFI, CKPT_NAME_VER_DICT


def _list_rife_ckpts() -> list[str]:
    """Return available RIFE checkpoint names, or a static fallback list."""
    try:
        _, ckpt_dict = _import_rife()
        from packaging import version

        return sorted(ckpt_dict.keys(), key=lambda n: version.parse(ckpt_dict[n]))
    except Exception as exc:
        logger.warning("Could not list RIFE checkpoints (%s); using defaults.", exc)
        return list(_DEFAULT_RIFE_CKPTS)


def _resize_nhwc(images: torch.Tensor, height: int, width: int) -> torch.Tensor:
    """Bilinear-resize an NHWC IMAGE batch to (height, width)."""
    if images.shape[1] == height and images.shape[2] == width:
        return images
    nchw = images.permute(0, 3, 1, 2).float()
    resized = F.interpolate(nchw, size=(height, width), mode="bilinear", align_corners=False)
    return resized.permute(0, 2, 3, 1).to(dtype=images.dtype)


class SeamlessVideoStitcher:
    """
    Stitch an original video with an AI extension using a RIFE optical-flow bridge.

    cut_index = len(original) - ref_frames_offset  (dynamic per clip length)
    Output: Original[:cut_index] + RIFE_bridge + AI[ai_skip_first:]
    """

    @classmethod
    def INPUT_TYPES(cls):
        ckpts = _list_rife_ckpts()
        default_ckpt = "rife49.pth" if "rife49.pth" in ckpts else ckpts[0]
        return {
            "required": {
                "original_images": ("IMAGE",),
                "ai_images": ("IMAGE",),
                "ref_frames_offset": (
                    "INT",
                    {
                        "default": 20,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": "How many trailing original frames the AI used as reference. "
                        "cut_index = original_length - this value.",
                    },
                ),
                "rife_multiplier": (
                    "INT",
                    {
                        "default": 2,
                        "min": 2,
                        "max": 8,
                        "step": 2,
                        "tooltip": "2 → 1 bridge frame; 4 → 3 bridge frames.",
                    },
                ),
                "rife_ckpt": (ckpts, {"default": default_ckpt}),
                "fast_mode": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "True = faster / lower quality RIFE. False = better quality.",
                    },
                ),
                "ensemble": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Bidirectional ensemble for more stable optical flow at the seam.",
                    },
                ),
                "ai_skip_first": (
                    "INT",
                    {
                        "default": 1,
                        "min": 0,
                        "max": 16,
                        "step": 1,
                        "tooltip": "Skip this many leading AI frames (MiniMax/Hailuo often freeze index 0).",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("images", "debug_bridge")
    FUNCTION = "stitch"
    CATEGORY = "MinimaxUtils/video"

    def stitch(
        self,
        original_images: torch.Tensor,
        ai_images: torch.Tensor,
        ref_frames_offset: int,
        rife_multiplier: int,
        rife_ckpt: str,
        fast_mode: bool = False,
        ensemble: bool = True,
        ai_skip_first: int = 1,
    ):
        """
        Assemble Original_trimmed + RIFE_bridge + AI_rest into one IMAGE batch.

        Frame_A = last frame of the trimmed original.
        Frame_B = first kept AI frame (after ai_skip_first).
        Bridge frames = RIFE([Frame_A, Frame_B])[1:-1] (boundaries discarded).
        """
        if original_images.ndim != 4 or ai_images.ndim != 4:
            raise ValueError("original_images and ai_images must be NHWC IMAGE tensors.")

        # Guard against shifted widgets_values feeding bool/empty into the combo.
        ckpt = str(rife_ckpt).strip() if rife_ckpt is not None and not isinstance(rife_ckpt, bool) else ""
        if not ckpt or ckpt.lower() in ("true", "false", "none", "null") or not ckpt.lower().endswith(".pth"):
            ckpts = _list_rife_ckpts()
            ckpt = "rife49.pth" if "rife49.pth" in ckpts else ckpts[0]
            logger.warning("Invalid rife_ckpt %r; using %s", rife_ckpt, ckpt)
        rife_ckpt = ckpt

        n_orig = int(original_images.shape[0])
        n_ai = int(ai_images.shape[0])
        cut_index = n_orig - int(ref_frames_offset)

        if cut_index <= 0:
            raise ValueError(
                f"ref_frames_offset ({ref_frames_offset}) >= original length ({n_orig}). "
                "Reduce the offset or use a longer original clip."
            )
        if cut_index > n_orig:
            raise ValueError(f"Invalid cut_index {cut_index} for original length {n_orig}.")
        if n_ai <= int(ai_skip_first):
            raise ValueError(
                f"ai_images has {n_ai} frame(s); need more than ai_skip_first={ai_skip_first}."
            )

        # Part 1: drop the reference tail so the seam lands on the real continuation point.
        original_trimmed = original_images[:cut_index]
        frame_a = original_trimmed[-1:]

        # Part 3 source: drop frozen/duplicated AI head frames.
        ai_rest = ai_images[int(ai_skip_first) :]
        frame_b = ai_rest[:1]

        # Match resolutions so cat and RIFE stay consistent.
        target_h = int(frame_a.shape[1])
        target_w = int(frame_a.shape[2])
        if frame_b.shape[1] != target_h or frame_b.shape[2] != target_w:
            logger.warning(
                "AI resolution %sx%s != original %sx%s; bilinear-resizing AI frames.",
                int(frame_b.shape[2]),
                int(frame_b.shape[1]),
                target_w,
                target_h,
            )
            ai_rest = _resize_nhwc(ai_rest, target_h, target_w)
            frame_b = ai_rest[:1]

        if frame_a.shape[-1] != frame_b.shape[-1]:
            raise ValueError(
                f"Channel mismatch: original C={frame_a.shape[-1]} vs AI C={frame_b.shape[-1]}."
            )

        # RIFE on the two seam frames only; keep only newly generated middles.
        try:
            RIFE_VFI, _ = _import_rife()
        except ImportError as exc:
            logger.error("%s", exc)
            raise

        seam_pair = torch.cat([frame_a, frame_b], dim=0)
        rife_out = RIFE_VFI().vfi(
            ckpt_name=rife_ckpt,
            frames=seam_pair,
            clear_cache_after_n_frames=10,
            multiplier=int(rife_multiplier),
            fast_mode=bool(fast_mode),
            ensemble=bool(ensemble),
            scale_factor=1.0,
            dtype="float32",
            torch_compile=False,
            batch_size=1,
        )[0]

        # RIFE returns [A, middles..., B]; drop A/B — they already exist in the clips.
        if rife_out.shape[0] < 3:
            raise RuntimeError(
                f"RIFE returned {rife_out.shape[0]} frame(s); expected at least 3 "
                f"(A + bridge + B) for multiplier={rife_multiplier}."
            )
        bridge = rife_out[1:-1]
        if bridge.shape[1] != target_h or bridge.shape[2] != target_w:
            bridge = _resize_nhwc(bridge, target_h, target_w)

        # Match dtype/device of the surrounding clips for a clean concat.
        bridge = bridge.to(device=original_trimmed.device, dtype=original_trimmed.dtype)
        ai_rest = ai_rest.to(device=original_trimmed.device, dtype=original_trimmed.dtype)

        stitched = torch.cat([original_trimmed, bridge, ai_rest], dim=0)
        logger.info(
            "SeamlessVideoStitcher: orig=%d cut=%d bridge=%d ai_rest=%d → total=%d",
            n_orig,
            cut_index,
            int(bridge.shape[0]),
            int(ai_rest.shape[0]),
            int(stitched.shape[0]),
        )
        return (stitched, bridge)
