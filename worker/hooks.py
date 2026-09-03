"""Hook text overlay renderer.

Generates a PNG image with punchy hook text (max ~10 words) and overlays it
onto the video clip via ffmpeg. Six visual styles inspired by OpenShorts.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HOOK_STYLES = {
    "classic": {"bg": (255, 255, 255), "fg": (0, 0, 0), "outline": False},
    "dark": {"bg": (30, 30, 30), "fg": (255, 255, 255), "outline": False},
    "yellow": {"bg": (255, 220, 0), "fg": (0, 0, 0), "outline": False},
    "red": {"bg": (220, 30, 30), "fg": (255, 255, 255), "outline": False},
    "outline": {"bg": None, "fg": (255, 255, 255), "outline": True},
    "outline_yellow": {"bg": None, "fg": (255, 220, 0), "outline": True},
}

_FONT_PATHS = [
    Path(__file__).resolve().parent / "fonts" / "NotoSans-Bold.ttf",
    Path(__file__).resolve().parent / "fonts" / "NotoSans.ttf",
    Path(__file__).resolve().parent / "fonts" / "Inter-Bold.ttf",
]


def _get_font(size: int) -> ImageFont.FreeTypeFont:
    for p in _FONT_PATHS:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines or [text]


def create_hook_image(
    text: str,
    width: int = 972,
    style: str = "classic",
    font_size: int = 72,
) -> Image.Image:
    """Render hook text onto a transparent PNG at the given width."""
    spec = HOOK_STYLES.get(style, HOOK_STYLES["classic"])
    font = _get_font(font_size)

    tmp = Image.new("RGBA", (width, 1), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tmp)
    lines = _wrap_text(draw, text.upper(), font, width - 60)

    line_height = font_size + 12
    total_h = len(lines) * line_height + 50

    img = Image.new("RGBA", (width, total_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad_x, pad_y = 30, 25
    box_h = total_h

    if spec["bg"] and not spec["outline"]:
        # Rounded rectangle background
        draw.rounded_rectangle(
            [(0, 0), (width - 1, box_h - 1)],
            radius=18,
            fill=spec["bg"] + (230,),
        )
        # Subtle shadow
        shadow = Image.new("RGBA", (width, box_h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rounded_rectangle(
            [(5, 5), (width - 1 + 5, box_h - 1 + 5)],
            radius=18,
            fill=(0, 0, 0, 60),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
        composite = Image.new("RGBA", (width + 10, box_h + 10), (0, 0, 0, 0))
        composite.paste(shadow, (0, 0))
        composite.paste(img, (0, 0), img)
        img = composite
        draw = ImageDraw.Draw(img)

    y = pad_y
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        if spec["outline"]:
            # Draw thick black outline, then colored text on top
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    draw.text((x + dx, y + dy), line, font=font, fill=(0, 0, 0, 255))
            draw.text((x, y), line, font=font, fill=spec["fg"] + (255,))
        else:
            draw.text((x, y), line, font=font, fill=spec["fg"] + (255,))
        y += line_height

    return img


def add_hook_to_video(
    video_path: Path,
    hook_text: str,
    out_path: Path,
    style: str = "classic",
    position: str = "top",
    duration: float | None = None,
) -> Path:
    """Overlay hook text PNG onto a video clip via ffmpeg.

    position: "top" (20% from top), "center", or "bottom" (70% from top).
    duration: how many seconds the hook stays on screen (default: 4s or clip length).
    """
    if not hook_text.strip():
        # No hook text — just copy
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-c", "copy", str(out_path)],
            capture_output=True, timeout=120,
        )
        return out_path

    # Probe video dimensions
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True, timeout=30,
    )
    try:
        w, h = [int(x) for x in probe.stdout.strip().split(",")]
    except Exception:
        w, h = 1080, 1920

    # Generate hook image at 90% of video width
    hook_w = int(w * 0.9)
    hook_img = create_hook_image(hook_text, width=hook_w, style=style)

    # Save to temp PNG
    tmp_dir = Path(tempfile.mkdtemp())
    hook_png = tmp_dir / "hook.png"
    hook_img.save(str(hook_png))

    # Position calculation
    hh = hook_img.height
    if position == "top":
        y_pos = int(h * 0.18)
    elif position == "bottom":
        y_pos = int(h * 0.68)
    else:  # center
        y_pos = (h - hh) // 2

    x_pos = (w - hook_w) // 2

    # Duration filter
    dur = duration or 4.0
    enable = f"between(t,0.3,{dur})"

    proc = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-i", str(hook_png),
            "-filter_complex",
            f"[1:v]format=rgba[hook];[0:v][hook]overlay={x_pos}:{y_pos}:enable='{enable}'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "copy",
            str(out_path),
        ],
        capture_output=True, text=True, timeout=60 * 5,
    )

    # Cleanup
    hook_png.unlink(missing_ok=True)
    tmp_dir.rmdir()

    if proc.returncode != 0 or not out_path.exists():
        # Fallback: copy without hook
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-c", "copy", str(out_path)],
            capture_output=True, timeout=120,
        )
    return out_path
