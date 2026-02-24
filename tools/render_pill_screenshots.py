"""Render high-resolution pill widget screenshots for the landing page.

Produces crisp PNGs by painting the pill widget onto a scaled QPixmap.
States: dormant (idle), hover (with tooltip), recording (with audio bars).

Usage:
    python tools/render_pill_screenshots.py [--scale 3] [--output docs/assets]
"""

import argparse
import os
import random
import sys

# Ensure src/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QFont, QFontMetrics, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import QApplication

from src.pill_widget import (
    BAR_GAP,
    BAR_W,
    COL_BAR,
    COL_BG,
    COL_BORDER,
    COL_BORDER_HV,
    COL_MINIBAR,
    COL_MINIBAR_HV,
    COL_STOP_BG,
    COL_STOP_FG,
    COL_X_BG,
    COL_X_FG,
    DORMANT_BAR_GAP,
    DORMANT_BAR_W,
    DORMANT_BARS,
    DORMANT_H,
    DORMANT_W,
    HOVER_H,
    HOVER_W,
    NUM_BARS,
    RECORDING_H,
    RECORDING_W,
)


def _paint_capsule(p: QPainter, w: float, h: float, border_col: QColor):
    """Draw the capsule background and border."""
    radius = h / 2
    path = QPainterPath()
    path.addRoundedRect(QRectF(0, 0, w, h), radius, radius)
    p.fillPath(path, QBrush(COL_BG))
    p.setPen(QPen(border_col, 1))
    p.drawRoundedRect(QRectF(0.5, 0.5, w - 1, h - 1), radius, radius)


def render_dormant(scale: int) -> QPixmap:
    """Render the pill in idle/dormant state."""
    w, h = DORMANT_W, DORMANT_H
    pix = QPixmap(int(w * scale), int(h * scale))
    pix.fill(Qt.GlobalColor.transparent)

    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.scale(scale, scale)

    _paint_capsule(p, w, h, COL_BORDER)

    # Mini bars — static, slightly varied
    random.seed(42)
    max_bar = h - 4
    dormant_bar_h = [random.uniform(2, max_bar) for _ in range(DORMANT_BARS)]
    random.seed()

    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(COL_MINIBAR))

    total_bars_w = DORMANT_BARS * DORMANT_BAR_W + (DORMANT_BARS - 1) * DORMANT_BAR_GAP
    sx = (w - total_bars_w) / 2
    cy = h / 2

    for i in range(DORMANT_BARS):
        bh = dormant_bar_h[i]
        x = sx + i * (DORMANT_BAR_W + DORMANT_BAR_GAP)
        p.drawRect(QRectF(x, cy - bh / 2, DORMANT_BAR_W, bh))

    p.end()
    return pix


def render_hover(scale: int) -> QPixmap:
    """Render the pill in hover state with tooltip bubble above."""
    pw, ph = HOVER_W, HOVER_H

    # Tooltip dimensions
    font = QFont("Segoe UI", 11)
    font.setWeight(QFont.Weight.Normal)
    fm = QFontMetrics(font)
    font_bold = QFont("Segoe UI", 11)
    font_bold.setWeight(QFont.Weight.DemiBold)
    fm_bold = QFontMetrics(font_bold)

    text_main = "Click or hold "
    text_key = "Ctrl+Shift+R"
    text_end = " to start dictating"
    pad_h, pad_v = 16, 10

    text_w = fm.horizontalAdvance(text_main) + fm_bold.horizontalAdvance(text_key) + fm.horizontalAdvance(text_end)
    text_h = fm.height()
    tw = int(text_w + pad_h * 2)
    th = int(text_h + pad_v * 2)

    gap = 8  # gap between tooltip and pill
    padding = 12  # extra padding around the composite

    # Canvas size
    canvas_w = max(tw, pw) + padding * 2
    canvas_h = th + gap + ph + padding * 2

    pix = QPixmap(int(canvas_w * scale), int(canvas_h * scale))
    pix.fill(Qt.GlobalColor.transparent)

    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.scale(scale, scale)

    # Position tooltip centered at top
    tx = (canvas_w - tw) / 2
    ty = padding

    # Position pill centered below tooltip
    pill_x = (canvas_w - pw) / 2
    pill_y = padding + th + gap

    # --- Draw tooltip ---
    p.save()
    p.translate(tx, ty)
    tooltip_radius = 10
    path = QPainterPath()
    path.addRoundedRect(QRectF(0, 0, tw, th), tooltip_radius, tooltip_radius)
    p.fillPath(path, QBrush(QColor(28, 25, 23, 240)))
    p.setPen(QPen(QColor(255, 255, 255, 15), 1))
    p.drawRoundedRect(QRectF(0.5, 0.5, tw - 1, th - 1), tooltip_radius, tooltip_radius)

    # Tooltip text
    text_y = pad_v + text_h - 3
    text_x = float(pad_h)

    p.setFont(font)
    p.setPen(QColor(214, 211, 209))
    p.drawText(QPointF(text_x, text_y), text_main)
    text_x += fm.horizontalAdvance(text_main)

    p.setFont(font_bold)
    p.setPen(QColor(207, 150, 115))
    p.drawText(QPointF(text_x, text_y), text_key)
    text_x += fm_bold.horizontalAdvance(text_key)

    p.setFont(font)
    p.setPen(QColor(214, 211, 209))
    p.drawText(QPointF(text_x, text_y), text_end)

    p.restore()

    # --- Draw hover pill ---
    p.save()
    p.translate(pill_x, pill_y)
    _paint_capsule(p, pw, ph, COL_BORDER_HV)

    # Mini bars — terracotta on hover
    random.seed(42)
    max_bar = ph - 4
    dormant_bar_h = [random.uniform(2, max_bar) for _ in range(DORMANT_BARS)]
    random.seed()

    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(COL_MINIBAR_HV))
    total_bars_w = DORMANT_BARS * DORMANT_BAR_W + (DORMANT_BARS - 1) * DORMANT_BAR_GAP
    sx = (pw - total_bars_w) / 2
    cy = ph / 2
    for i in range(DORMANT_BARS):
        bh = dormant_bar_h[i]
        x = sx + i * (DORMANT_BAR_W + DORMANT_BAR_GAP)
        p.drawRect(QRectF(x, cy - bh / 2, DORMANT_BAR_W, bh))

    p.restore()
    p.end()
    return pix


def render_recording(scale: int) -> QPixmap:
    """Render the pill in recording state with simulated audio bars."""
    w, h = RECORDING_W, RECORDING_H

    pix = QPixmap(int(w * scale), int(h * scale))
    pix.fill(Qt.GlobalColor.transparent)

    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.scale(scale, scale)

    _paint_capsule(p, w, h, COL_BORDER_HV)

    # --- X button (cancel) ---
    btn_size = h - 8
    xr = QRectF(4, 4, btn_size, btn_size)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(COL_X_BG))
    p.drawEllipse(xr)
    p.setPen(QPen(COL_X_FG, 1.8))
    margin = xr.width() * 0.3
    p.drawLine(QPointF(xr.x() + margin, xr.y() + margin), QPointF(xr.right() - margin, xr.bottom() - margin))
    p.drawLine(QPointF(xr.right() - margin, xr.y() + margin), QPointF(xr.x() + margin, xr.bottom() - margin))

    # --- Stop button ---
    sr = QRectF(w - btn_size - 4, 4, btn_size, btn_size)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(COL_STOP_BG))
    p.drawEllipse(sr)
    sq_size = sr.width() * 0.35
    sq_x = sr.center().x() - sq_size / 2
    sq_y = sr.center().y() - sq_size / 2
    p.setBrush(QBrush(COL_STOP_FG))
    p.drawRoundedRect(QRectF(sq_x, sq_y, sq_size, sq_size), 1.5, 1.5)

    # --- Voice bars (simulated mid-speech) ---
    bars_left = xr.right() + 4
    bars_right = sr.x() - 4
    bars_width = bars_right - bars_left
    total_bars_w = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP
    bx = bars_left + (bars_width - total_bars_w) / 2
    cy = h / 2

    # Generate a natural-looking waveform pattern
    random.seed(7)
    max_h = h - 10
    min_h = 3.0
    bar_heights = []
    for i in range(NUM_BARS):
        # Create a wave-like pattern with some randomness
        center_factor = 1.0 - abs(i - NUM_BARS / 2) / (NUM_BARS / 2) * 0.3
        base = 0.5 + random.random() * 0.4
        bar_heights.append(min_h + (max_h - min_h) * base * center_factor)
    random.seed()

    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(COL_BAR))
    for i in range(NUM_BARS):
        bh = max(2, bar_heights[i])
        x = bx + i * (BAR_W + BAR_GAP)
        p.drawRect(QRectF(x, cy - bh / 2, BAR_W, bh))

    p.end()
    return pix


def main():
    parser = argparse.ArgumentParser(description="Render pill widget screenshots")
    parser.add_argument("--scale", type=int, default=3, help="Render scale factor (default: 3)")
    parser.add_argument("--output", type=str, default="docs/assets", help="Output directory")
    args = parser.parse_args()

    _app = QApplication(sys.argv)

    os.makedirs(args.output, exist_ok=True)

    renders = [
        ("pill-idle.png", render_dormant),
        ("pill-hover.png", render_hover),
        ("pill-recording.png", render_recording),
    ]

    for filename, render_fn in renders:
        pix = render_fn(args.scale)
        path = os.path.join(args.output, filename)
        pix.save(path, "PNG")
        print(f"  {filename:24s}  {pix.width()}x{pix.height()} px  ({args.scale}x scale)  -> {path}")

    print(f"\nDone. {len(renders)} images saved to {args.output}/")


if __name__ == "__main__":
    main()
