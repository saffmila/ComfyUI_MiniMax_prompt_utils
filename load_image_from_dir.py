"""Load Image From Dir — sequential / random / custom image loader with live preview."""

from __future__ import annotations

import asyncio
import glob
import hashlib
import mimetypes
import os
import random
from io import BytesIO

import numpy as np
import torch
from aiohttp import web
from PIL import Image, ImageOps, ImageSequence

import node_helpers
from server import PromptServer

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".jfif",
    ".avif",
}


def _normalize_directory(directory: str) -> str:
    directory = (directory or "").strip().strip('"').strip("'")
    if not directory:
        return ""
    return os.path.abspath(os.path.expanduser(directory))


def _is_image_file(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in IMAGE_EXTENSIONS


def list_images(directory: str, pattern: str = "*") -> list[str]:
    """Return sorted absolute image paths matching pattern inside directory (non-recursive)."""
    directory = _normalize_directory(directory)
    if not directory or not os.path.isdir(directory):
        return []

    pattern = (pattern or "*").strip() or "*"
    # Escape the directory so glob metacharacters in the path itself are literal.
    search = os.path.join(glob.escape(directory), pattern)
    paths = []
    for path in glob.glob(search):
        if os.path.isfile(path) and _is_image_file(path):
            paths.append(os.path.abspath(path))
    paths.sort(key=lambda p: os.path.basename(p).lower())
    return paths


def resolve_index(mode: str, index: int, seed: int, count: int) -> int:
    if count <= 0:
        return 0
    mode = (mode or "sequential").lower()
    if mode == "random":
        rng = random.Random(int(seed) & 0xFFFFFFFFFFFFFFFF)
        return rng.randrange(count)
    # sequential + custom both use the index widget (wrap)
    return int(index) % count


def load_image_tensor(image_path: str):
    """Load one image as (IMAGE, MASK) tensors — same convention as core LoadImage."""
    img = node_helpers.pillow(Image.open, image_path)
    img = node_helpers.pillow(ImageOps.exif_transpose, img)

    output_images = []
    output_masks = []
    w = h = None

    for frame in ImageSequence.Iterator(img):
        frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
        image = frame.convert("RGB")
        if w is None:
            w, h = image.size
        if image.size[0] != w or image.size[1] != h:
            continue

        image_np = np.array(image).astype(np.float32) / 255.0
        image_t = torch.from_numpy(image_np)[None,]
        if "A" in frame.getbands():
            mask = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        else:
            mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
        output_images.append(image_t)
        output_masks.append(mask.unsqueeze(0))

    if not output_images:
        raise FileNotFoundError(f"Could not decode image: {image_path}")

    return torch.cat(output_images, dim=0), torch.cat(output_masks, dim=0)


def _safe_image_path(path: str) -> str | None:
    """Resolve and validate a path as an existing image file."""
    path = (path or "").strip().strip('"').strip("'")
    if not path:
        return None
    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(abs_path) or not _is_image_file(abs_path):
        return None
    return abs_path


@PromptServer.instance.routes.get("/minimaxutils/listdir")
async def minimaxutils_listdir(request):
    directory = request.rel_url.query.get("directory", "")
    pattern = request.rel_url.query.get("pattern", "*")
    paths = list_images(directory, pattern)
    files = [{"name": os.path.basename(p), "path": p} for p in paths]
    return web.json_response({"count": len(files), "files": files})


@PromptServer.instance.routes.get("/minimaxutils/resolve")
async def minimaxutils_resolve(request):
    """Resolve which file the node would load — keeps JS preview in sync with Python."""
    q = request.rel_url.query
    file_path = (q.get("file") or "").strip()
    if file_path:
        safe = _safe_image_path(file_path)
        if not safe:
            return web.json_response({"count": 0, "index": 0, "file": None, "source": "file"})
        return web.json_response(
            {
                "count": 1,
                "index": 0,
                "source": "file",
                "file": {"name": os.path.basename(safe), "path": safe},
            }
        )

    directory = q.get("directory", "")
    pattern = q.get("pattern", "*")
    mode = q.get("mode", "sequential")
    try:
        index = int(q.get("index", "0"))
    except ValueError:
        index = 0
    try:
        seed = int(q.get("seed", "0"))
    except ValueError:
        seed = 0

    paths = list_images(directory, pattern)
    if not paths:
        return web.json_response({"count": 0, "index": 0, "file": None, "source": "folder"})

    selected = resolve_index(mode, index, seed, len(paths))
    path = paths[selected]
    return web.json_response(
        {
            "count": len(paths),
            "index": selected,
            "source": "folder",
            "file": {"name": os.path.basename(path), "path": path},
        }
    )


@PromptServer.instance.routes.get("/minimaxutils/pathinfo")
async def minimaxutils_pathinfo(request):
    """Classify a pasted path as image file, directory, or missing."""
    raw = (request.rel_url.query.get("path") or "").strip().strip('"').strip("'")
    if not raw:
        return web.json_response({"ok": True, "type": "empty", "path": ""})
    abs_path = os.path.abspath(os.path.expanduser(raw))
    if os.path.isfile(abs_path) and _is_image_file(abs_path):
        return web.json_response(
            {
                "ok": True,
                "type": "file",
                "path": abs_path,
                "name": os.path.basename(abs_path),
                "directory": os.path.dirname(abs_path),
            }
        )
    if os.path.isdir(abs_path):
        return web.json_response(
            {
                "ok": True,
                "type": "dir",
                "path": abs_path,
                "directory": abs_path,
            }
        )
    return web.json_response({"ok": False, "type": "missing", "path": abs_path})


def _pick_image_dialog() -> str:
    """Native OS file dialog on the ComfyUI server machine (local workflows)."""
    # Prefer WinForms via PowerShell on Windows — tkinter often fails/headless in ComfyUI.
    if os.name == "nt":
        try:
            import subprocess

            ps = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$f = New-Object System.Windows.Forms.OpenFileDialog; "
                "$f.Title = 'Select image'; "
                "$f.Filter = 'Images (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|"
                "*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff|All files (*.*)|*.*'; "
                "$f.Multiselect = $false; "
                "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) "
                "{ [Console]::Out.Write($f.FileName) }"
            )
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", ps],
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
            path = (proc.stdout or "").strip().strip('"')
            if path and os.path.isfile(path):
                return path
        except Exception:
            pass

    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return ""
    root = tk.Tk()
    root.withdraw()
    try:
        root.wm_attributes("-topmost", 1)
    except Exception:
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
    try:
        root.update()
    except Exception:
        pass
    path = filedialog.askopenfilename(
        parent=root,
        title="Select image",
        filetypes=[
            ("Images", "*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff"),
            ("PNG", "*.png"),
            ("JPEG", "*.jpg;*.jpeg"),
            ("All files", "*.*"),
        ],
    )
    try:
        root.destroy()
    except Exception:
        pass
    return path or ""


@PromptServer.instance.routes.post("/minimaxutils/pick_image")
async def minimaxutils_pick_image(_request):
    """Open a native file picker and return the selected image path."""
    try:
        path = await asyncio.to_thread(_pick_image_dialog)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    if not path:
        return web.json_response({"ok": False, "cancelled": True})
    safe = _safe_image_path(path)
    if not safe:
        return web.json_response({"ok": False, "error": "not an image"}, status=400)
    return web.json_response(
        {
            "ok": True,
            "path": safe,
            "name": os.path.basename(safe),
            "directory": os.path.dirname(safe),
        }
    )


@PromptServer.instance.routes.get("/minimaxutils/view")
async def minimaxutils_view(request):
    path = _safe_image_path(request.rel_url.query.get("path", ""))
    if path is None:
        return web.Response(status=404, text="Image not found")

    # Optional downscaled preview for the node thumbnail.
    preview = request.rel_url.query.get("preview")
    if preview:
        try:
            with Image.open(path) as img:
                img = ImageOps.exif_transpose(img)
                img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                buf = BytesIO()
                fmt = "WEBP" if preview.startswith("webp") else "JPEG"
                if fmt == "JPEG" and img.mode == "RGBA":
                    img = img.convert("RGB")
                quality = 85
                parts = preview.split(";")
                if len(parts) > 1 and parts[-1].isdigit():
                    quality = int(parts[-1])
                img.save(buf, format=fmt, quality=quality)
                buf.seek(0)
                ctype = "image/webp" if fmt == "WEBP" else "image/jpeg"
                return web.Response(body=buf.read(), content_type=ctype)
        except Exception:
            return web.Response(status=500, text="Preview failed")

    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return web.FileResponse(path, headers={"Content-Type": ctype})


class LoadImageFromDir:
    """
    Load a single image from a directory.

    Modes:
      sequential — uses index; set control_after_generate to increment (UI does this)
      random     — picks by seed
      custom     — manual index; ArrowUp/ArrowDown (+ UI arrows) with live preview
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "E:/path/to/images",
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
                "pattern": ("STRING", {"default": "*", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "filename", "path")
    FUNCTION = "load"
    CATEGORY = "MinimaxUtils/image"
    DESCRIPTION = (
        "Load one image from a directory. sequential advances index after generate, "
        "random picks by seed, custom lets you browse with arrows and live preview."
    )

    def load(self, directory, mode, index, seed, pattern="*"):
        paths = list_images(directory, pattern)
        if not paths:
            raise FileNotFoundError(
                f"No images found in '{directory}' matching pattern '{pattern}'."
            )

        selected = resolve_index(mode, index, seed, len(paths))
        image_path = paths[selected]
        image, mask = load_image_tensor(image_path)
        filename = os.path.basename(image_path)

        # Keep the index widget in sync with what was actually loaded (wrap / random).
        return {
            "ui": {
                "index": [selected],
                "filename": [filename],
                "path": [image_path],
                "count": [len(paths)],
                "size": [f"{image.shape[2]} × {image.shape[1]}"],
            },
            "result": (image, mask, filename, image_path),
        }

    @classmethod
    def IS_CHANGED(cls, directory, mode, index, seed, pattern="*"):
        paths = list_images(directory, pattern)
        if not paths:
            return float("NaN")
        selected = resolve_index(mode, index, seed, len(paths))
        path = paths[selected]
        m = hashlib.sha256()
        m.update(path.encode("utf-8", errors="replace"))
        try:
            m.update(str(os.path.getmtime(path)).encode("utf-8"))
        except OSError:
            pass
        m.update(f"{mode}:{index}:{seed}:{pattern}".encode("utf-8"))
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, directory, mode, index, seed, pattern="*"):
        directory = _normalize_directory(directory)
        if not directory:
            return "directory is empty"
        if not os.path.isdir(directory):
            return f"Directory not found: {directory}"
        if not list_images(directory, pattern):
            return f"No images in '{directory}' matching '{pattern}'"
        return True
