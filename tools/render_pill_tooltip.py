"""Generate pill-tooltip.png reference image with mini-bars (matches actual code)."""

import random

from PIL import Image, ImageDraw, ImageFont

# === Constants matching pill_widget.py ===
HOVER_W, HOVER_H = 88, 18
DORMANT_BARS = 14
DORMANT_BAR_W = 1.5
DORMANT_BAR_GAP = 1.5
COL_BG = (41, 37, 36)
COL_BORDER_HV = (255, 255, 255, 40)
COL_MINIBAR_HV = (207, 150, 115)  # terracotta on hover
COL_TOOLTIP_BG = (28, 25, 23, 240)
COL_TOOLTIP_BORDER = (255, 255, 255, 15)
COL_TEXT = (214, 211, 209)
COL_TEXT_KEY = (207, 150, 115)

# === Supersampling ===
SS = 4  # 4x supersampling

# === Layout (1x coords) ===
CANVAS_PAD = 40
GAP = 8
PILL_W, PILL_H = HOVER_W, HOVER_H
TOOLTIP_PAD_H, TOOLTIP_PAD_V = 16, 10
TOOLTIP_RADIUS = 10

# Pre-compute bar heights (same seed as pill_widget.py)
random.seed(42)
max_bar = 14 - 4  # DORMANT_H - 4 = 10
BAR_HEIGHTS = [random.uniform(2, max_bar) for _ in range(DORMANT_BARS)]
random.seed()


def draw_rounded_rect(draw, bbox, radius, fill=None, outline=None, width=1):
    """Draw a rounded rectangle at supersampled resolution."""
    if fill:
        draw.rounded_rectangle(bbox, radius=radius, fill=fill)
    if outline:
        draw.rounded_rectangle(bbox, radius=radius, outline=outline, width=width)


def render():
    # --- Measure tooltip text ---
    # Try to load Segoe UI, fall back to default
    font_size_1x = 13
    font_size_ss = font_size_1x * SS
    font_bold_size_ss = font_size_1x * SS
    try:
        font = ImageFont.truetype("segoeui.ttf", font_size_ss)
        font_bold = ImageFont.truetype("segoeuib.ttf", font_bold_size_ss)
    except OSError:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", font_size_ss)
            font_bold = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", font_bold_size_ss)
        except OSError:
            font = ImageFont.load_default()
            font_bold = font

    text_main = "Click or hold "
    text_key = "Ctrl+Alt+R"
    text_end = " to start dictating"

    # Measure text widths at SS resolution
    tmp = Image.new("RGBA", (1, 1))
    tmp_draw = ImageDraw.Draw(tmp)
    w_main = tmp_draw.textlength(text_main, font=font)
    w_key = tmp_draw.textlength(text_key, font=font_bold)
    w_end = tmp_draw.textlength(text_end, font=font)
    text_total_w = w_main + w_key + w_end
    text_h = font_size_ss + 4 * SS  # approximate line height

    # Tooltip size at SS
    tooltip_w_ss = int(text_total_w + TOOLTIP_PAD_H * 2 * SS)
    tooltip_h_ss = int(text_h + TOOLTIP_PAD_V * 2 * SS)

    # Pill size at SS
    pill_w_ss = PILL_W * SS
    pill_h_ss = PILL_H * SS

    # Canvas size at SS
    content_w = max(tooltip_w_ss, pill_w_ss)
    content_h = tooltip_h_ss + GAP * SS + pill_h_ss
    canvas_w = content_w + CANVAS_PAD * 2 * SS
    canvas_h = content_h + CANVAS_PAD * 2 * SS

    img = Image.new("RGBA", (canvas_w, canvas_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # --- Position elements (centered horizontally) ---
    cx = canvas_w // 2

    # Tooltip
    tt_x = cx - tooltip_w_ss // 2
    tt_y = CANVAS_PAD * SS
    draw_rounded_rect(
        draw,
        (tt_x, tt_y, tt_x + tooltip_w_ss, tt_y + tooltip_h_ss),
        radius=TOOLTIP_RADIUS * SS,
        fill=COL_TOOLTIP_BG,
        outline=COL_TOOLTIP_BORDER,
        width=SS,
    )

    # Tooltip text
    text_y = tt_y + TOOLTIP_PAD_V * SS + 2 * SS
    text_x = float(tt_x + TOOLTIP_PAD_H * SS)
    draw.text((text_x, text_y), text_main, fill=COL_TEXT, font=font)
    text_x += w_main
    draw.text((text_x, text_y), text_key, fill=COL_TEXT_KEY, font=font_bold)
    text_x += w_key
    draw.text((text_x, text_y), text_end, fill=COL_TEXT, font=font)

    # Pill
    pill_x = cx - pill_w_ss // 2
    pill_y = tt_y + tooltip_h_ss + GAP * SS
    pill_radius = pill_h_ss / 2
    draw_rounded_rect(
        draw,
        (pill_x, pill_y, pill_x + pill_w_ss, pill_y + pill_h_ss),
        radius=pill_radius,
        fill=COL_BG,
        outline=COL_BORDER_HV,
        width=SS,
    )

    # Mini-bars (thin rectangles, centered in pill)
    total_bars_w = DORMANT_BARS * DORMANT_BAR_W + (DORMANT_BARS - 1) * DORMANT_BAR_GAP
    sx = pill_x + (pill_w_ss - total_bars_w * SS) / 2
    cy = pill_y + pill_h_ss / 2

    for i in range(DORMANT_BARS):
        bh = BAR_HEIGHTS[i] * SS
        bw = DORMANT_BAR_W * SS
        x = sx + i * (DORMANT_BAR_W + DORMANT_BAR_GAP) * SS
        y0 = cy - bh / 2
        draw.rectangle(
            (int(x), int(y0), int(x + bw), int(y0 + bh)),
            fill=COL_MINIBAR_HV,
        )

    # --- Downscale with LANCZOS ---
    final_w = canvas_w // SS
    final_h = canvas_h // SS
    img = img.resize((final_w, final_h), Image.Resampling.LANCZOS)

    return img


if __name__ == "__main__":
    import os

    img = render()
    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "docs",
        "reference",
        "ui-captures",
        "pill-tooltip.png",
    )
    img.save(out_path, "PNG")
    print(f"Saved: {out_path} ({img.width}x{img.height})")
