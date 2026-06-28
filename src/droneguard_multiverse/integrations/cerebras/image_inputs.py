from __future__ import annotations

import base64
from pathlib import Path
from typing import Any


SUPPORTED_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


class ImageInputError(ValueError):
    pass


def encode_image_data_uri(path: Path, max_bytes: int = 4_000_000) -> str:
    suffix = path.suffix.lower()
    mime_type = SUPPORTED_MIME_TYPES.get(suffix)
    if mime_type is None:
        raise ImageInputError(f"unsupported image format for Cerebras image input: {path.suffix}")
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise ImageInputError(f"image payload is too large for MVP request: {path}")
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def build_image_content_parts(frame_paths: list[Path], max_images: int = 5) -> list[dict[str, Any]]:
    if len(frame_paths) > max_images:
        raise ImageInputError(f"image request includes {len(frame_paths)} frames; max is {max_images}")
    return [
        {"type": "image_url", "image_url": {"url": encode_image_data_uri(path)}}
        for path in frame_paths
    ]
