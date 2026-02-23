#!/usr/bin/env python
"""Generate Windows icon assets from assets/microphone_logo.svg.

This keeps `microphone_logo.svg` as the source-of-truth and refreshes:
- assets/microphone_logo.png
- assets/microphone_logo.ico
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw


def parse_stroke_color(svg_text: str) -> tuple[int, int, int, int]:
    match = re.search(r'stroke="(#?[0-9A-Fa-f]{6})"', svg_text)
    if not match:
        return (207, 150, 115, 255)
    hex_color = match.group(1).lstrip("#")
    return (*tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4)), 255)


def draw_round_line(
    draw: ImageDraw.ImageDraw, p1: tuple[float, float], p2: tuple[float, float], color, width: int
) -> None:
    draw.line([p1, p2], fill=color, width=width)
    r = width / 2
    for x, y in (p1, p2):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def render_microphone_icon(size: int, stroke_color: tuple[int, int, int, int]) -> Image.Image:
    # Draw at higher resolution for smoother downsampling.
    supersample = 4
    canvas_size = size * supersample
    scale = canvas_size / 256.0
    stroke = max(2, round(16 * scale))

    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Mic capsule
    draw.rounded_rectangle(
        [88 * scale, 32 * scale, 168 * scale, 160 * scale],
        radius=40 * scale,
        outline=stroke_color,
        width=stroke,
    )

    # U-stand path: M56 116 v12 a72 72 0 0 0 144 0 v-12
    left_top = (56 * scale, 116 * scale)
    left_joint = (56 * scale, 128 * scale)
    right_joint = (200 * scale, 128 * scale)
    right_top = (200 * scale, 116 * scale)
    draw_round_line(draw, left_top, left_joint, stroke_color, stroke)
    draw_round_line(draw, right_joint, right_top, stroke_color, stroke)
    arc_box = [56 * scale, 56 * scale, 200 * scale, 200 * scale]
    draw.arc(arc_box, start=0, end=180, fill=stroke_color, width=stroke)
    # Round off arc endpoints for SVG-like linecaps
    r = stroke / 2
    for x, y in (left_joint, right_joint):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=stroke_color)

    # Stem + base
    draw_round_line(draw, (128 * scale, 200 * scale), (128 * scale, 232 * scale), stroke_color, stroke)
    draw_round_line(draw, (96 * scale, 232 * scale), (160 * scale, 232 * scale), stroke_color, stroke)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> int:
    project_dir = Path(__file__).resolve().parents[1]
    assets_dir = project_dir / "assets"
    svg_path = assets_dir / "microphone_logo.svg"
    if not svg_path.exists():
        raise FileNotFoundError(f"Missing source SVG: {svg_path}")

    stroke_color = parse_stroke_color(svg_path.read_text(encoding="utf-8"))
    icon_256 = render_microphone_icon(256, stroke_color)

    png_path = assets_dir / "microphone_logo.png"
    ico_path = assets_dir / "microphone_logo.ico"
    icon_256.save(png_path, format="PNG")
    icon_256.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    print(f"Updated: {png_path}")
    print(f"Updated: {ico_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
