"""
WhisperClick floating pill widget — Qt-based for pixel-perfect control.
Design: tiny dormant capsule → hover expands with mini bars → click to record.
Color palette: Claude-inspired matte warm tones — soft terracotta + stone grays.
"""

import sys
import math
import random
from PySide6.QtWidgets import QWidget, QApplication, QMenu, QLabel
from PySide6.QtCore import Qt, QTimer, QRectF, QPoint, Signal, QPointF
from PySide6.QtGui import QPainter, QPen, QBrush, QColor, QCursor, QPainterPath


# ---------------------------------------------------------------------------
# Menu stylesheet — shared by main menu and submenus
# ---------------------------------------------------------------------------
_MENU_STYLE = """
    QMenu {
        background: #FAFAF9;
        border: 1px solid #E7E5E4;
        border-radius: 10px;
        padding: 6px 0;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
    }
    QMenu::item {
        padding: 8px 16px;
        color: #292524;
    }
    QMenu::item:selected {
        background: #F5F5F4;
    }
    QMenu::item:disabled {
        color: #A8A29E;
    }
    QMenu::separator {
        height: 1px;
        background: #E7E5E4;
        margin: 4px 0;
    }
    QMenu::indicator {
        width: 14px;
        height: 14px;
        margin-left: 8px;
    }
"""


# ---------------------------------------------------------------------------
# Colour palette — Claude matte pastels
# ---------------------------------------------------------------------------
COL_BG          = QColor(41, 37, 36)         # stone-800 warm dark
COL_BORDER      = QColor(255, 255, 255, 18)
COL_BORDER_HV   = QColor(255, 255, 255, 40)
COL_MINIBAR     = QColor(255, 255, 255, 35)  # dormant mini-bars dim
COL_MINIBAR_HV  = QColor(207, 150, 115)      # soft terracotta on hover
COL_BAR         = QColor(207, 150, 115)      # warm terracotta — voice bars
COL_BAR_PROC    = QColor(207, 150, 115, 180) # processing pulse
COL_X_BG        = QColor(255, 255, 255, 20)
COL_X_BG_HV     = QColor(255, 255, 255, 45)
COL_X_FG        = QColor(168, 162, 158)      # stone-400
COL_X_FG_HV     = QColor(231, 229, 228)      # stone-200
COL_STOP_BG     = QColor(220, 100, 80)       # muted warm red
COL_STOP_BG_HV  = QColor(235, 120, 100)
COL_STOP_FG     = QColor(255, 255, 255)
COL_SUCCESS     = QColor(207, 150, 115)      # terracotta flash
COL_ERROR       = QColor(220, 100, 80)       # muted red flash

# ---------------------------------------------------------------------------
# Sizes
# ---------------------------------------------------------------------------
DORMANT_W, DORMANT_H = 72, 14
HOVER_W, HOVER_H     = 88, 18         # slight expand on hover
RECORDING_W, RECORDING_H = 200, 40    # taller for bigger bars
DORMANT_BARS  = 14                     # mini bars in dormant state
DORMANT_BAR_W = 1.5
DORMANT_BAR_GAP = 1.5
NUM_BARS      = 22                     # recording voice bars
BAR_W         = 3                      # wider bars
BAR_GAP       = 2


class TooltipBubble(QWidget):
    """Custom tooltip bubble with dark background — separate window."""

    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
            | Qt.WindowType.BypassWindowManagerHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)

        self._text_main = "Click or hold "
        self._text_key = "Ctrl+Shift+R"
        self._text_end = " to start dictating"
        self._padding_h = 16
        self._padding_v = 10
        self._radius = 10

        # Measure text size
        from PySide6.QtGui import QFontMetrics, QFont
        font = QFont("Segoe UI", 11)
        font.setWeight(QFont.Weight.Normal)
        fm = QFontMetrics(font)
        self._font = font

        font_bold = QFont("Segoe UI", 11)
        font_bold.setWeight(QFont.Weight.DemiBold)
        self._font_bold = font_bold
        fm_bold = QFontMetrics(font_bold)

        text_w = fm.horizontalAdvance(self._text_main) + fm_bold.horizontalAdvance(self._text_key) + fm.horizontalAdvance(self._text_end)
        text_h = fm.height()
        self._text_h = text_h

        self.setFixedSize(int(text_w + self._padding_h * 2), int(text_h + self._padding_v * 2))

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        w, h = self.width(), self.height()

        # Background bubble
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, w, h), self._radius, self._radius)
        p.fillPath(path, QBrush(QColor(28, 25, 23, 240)))

        # Border
        p.setPen(QPen(QColor(255, 255, 255, 15), 1))
        p.drawRoundedRect(QRectF(0.5, 0.5, w - 1, h - 1), self._radius, self._radius)

        # Text
        y = self._padding_v + self._text_h - 3
        x = float(self._padding_h)

        p.setFont(self._font)
        p.setPen(QColor(214, 211, 209))  # stone-300
        p.drawText(QPointF(x, y), self._text_main)

        from PySide6.QtGui import QFontMetrics
        x += QFontMetrics(self._font).horizontalAdvance(self._text_main)

        p.setFont(self._font_bold)
        p.setPen(QColor(207, 150, 115))  # terracotta for shortcut
        p.drawText(QPointF(x, y), self._text_key)

        x += QFontMetrics(self._font_bold).horizontalAdvance(self._text_key)

        p.setFont(self._font)
        p.setPen(QColor(214, 211, 209))
        p.drawText(QPointF(x, y), self._text_end)

        p.end()

    def show_above(self, pill_widget):
        pill_pos = pill_widget.mapToGlobal(QPoint(0, 0))
        x = pill_pos.x() + (pill_widget.width() - self.width()) // 2
        y = pill_pos.y() - self.height() - 8
        self.move(x, y)
        self.show()


class PillWidget(QWidget):
    """Floating pill overlay widget."""

    # Signals — core
    record_requested = Signal()
    stop_requested = Signal()
    cancel_requested = Signal()
    show_main_requested = Signal()
    open_settings_requested = Signal()
    hide_requested = Signal()
    paste_last_requested = Signal()

    # Signals — enhanced menu
    sound_toggled = Signal(bool)
    mode_toggled = Signal(str)
    mic_selected = Signal(int)
    copy_requested = Signal(str)

    def __init__(self):
        super().__init__()

        self._state = "dormant"
        self._hovered = False
        self._hover_x = False
        self._hover_stop = False
        self._audio_level = 0.0
        self._bar_heights = [3.0] * NUM_BARS
        self._proc_phase = 0.0
        self._border_flash_alpha = 0

        # Dormant mini-bar heights (static, slightly varied)
        random.seed(42)
        max_bar = DORMANT_H - 4
        self._dormant_bar_h = [random.uniform(2, max_bar) for _ in range(DORMANT_BARS)]
        random.seed()

        # Current animated size
        self._w = float(DORMANT_W)
        self._h = float(DORMANT_H)

        # Window flags
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setMouseTracking(True)
        self.setFixedSize(DORMANT_W, DORMANT_H)

        # Tooltip
        self._tooltip = TooltipBubble()

        # Position
        self._reposition()

        # Timers
        self._paint_timer = QTimer(self)
        self._paint_timer.timeout.connect(self._tick)
        self._paint_timer.start(50)

        self._flash_timer = QTimer(self)
        self._flash_timer.timeout.connect(self._flash_tick)

        self._size_anim_timer = QTimer(self)
        self._size_anim_timer.timeout.connect(self._size_anim_step)
        self._target_w = float(DORMANT_W)
        self._target_h = float(DORMANT_H)

        # Track the foreground window so we can paste back into it
        self._prev_foreground = None

        # Context menu
        self._menu_provider = None
        self._build_context_menu()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_state(self) -> str:
        return self._state

    def set_audio_level(self, level: float):
        self._audio_level = max(0.0, min(1.0, level))

    def set_state(self, state: str):
        self._state = state
        if state == "recording":
            self._tooltip.hide()
            self._animate_to(RECORDING_W, RECORDING_H)
            self._paint_timer.setInterval(16)
        elif state == "processing":
            self._proc_phase = 0.0
            self._paint_timer.setInterval(30)
        elif state in ("success", "error"):
            self._border_flash_alpha = 255
            self._flash_timer.start(30)
            self._animate_to(DORMANT_W, DORMANT_H)
            self._paint_timer.setInterval(50)
            QTimer.singleShot(2000, self._go_dormant)
        elif state == "dormant":
            self._animate_to(DORMANT_W, DORMANT_H)
            self._paint_timer.setInterval(50)

    def _go_dormant(self):
        if self._state in ("success", "error"):
            self._state = "dormant"
            self._flash_timer.stop()
            self._border_flash_alpha = 0
            self.update()

    # ------------------------------------------------------------------
    # Size animation
    # ------------------------------------------------------------------

    def _animate_to(self, w, h):
        self._target_w = float(w)
        self._target_h = float(h)
        if not self._size_anim_timer.isActive():
            self._size_anim_timer.start(16)

    def _size_anim_step(self):
        speed = 0.25
        self._w += (self._target_w - self._w) * speed
        self._h += (self._target_h - self._h) * speed
        if abs(self._w - self._target_w) < 1 and abs(self._h - self._target_h) < 1:
            self._w = self._target_w
            self._h = self._target_h
            self._size_anim_timer.stop()
        self.setFixedSize(int(self._w), int(self._h))
        self._reposition()

    def _reposition(self):
        screen = QApplication.primaryScreen()
        if screen:
            geo = screen.availableGeometry()
            x = geo.x() + (geo.width() - self.width()) // 2
            y = geo.y() + geo.height() - self.height() - 10
            self.move(x, y)

    # ------------------------------------------------------------------
    # Timers
    # ------------------------------------------------------------------

    def _tick(self):
        if self._state == "recording":
            level = self._audio_level
            max_h = self.height() - 10
            min_h = 3.0
            for i in range(NUM_BARS):
                target = min_h + (max_h - min_h) * level * (0.3 + random.random() * 0.7)
                self._bar_heights[i] += (target - self._bar_heights[i]) * 0.4
        elif self._state == "processing":
            self._proc_phase += 0.08
        self.update()

    def _flash_tick(self):
        self._border_flash_alpha = max(0, self._border_flash_alpha - 6)
        if self._border_flash_alpha <= 0:
            self._flash_timer.stop()
        self.update()

    # ------------------------------------------------------------------
    # Button hit-testing
    # ------------------------------------------------------------------

    def _x_btn_rect(self) -> QRectF:
        h = self.height()
        size = h - 8
        return QRectF(4, 4, size, size)

    def _stop_btn_rect(self) -> QRectF:
        h = self.height()
        w = self.width()
        size = h - 8
        return QRectF(w - size - 4, 4, size, size)

    # ------------------------------------------------------------------
    # Paint
    # ------------------------------------------------------------------

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        w, h = self.width(), self.height()
        radius = h / 2

        # Background capsule
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, w, h), radius, radius)
        p.fillPath(path, QBrush(COL_BG))

        # Border
        border_col = COL_BORDER_HV if self._hovered else COL_BORDER
        if self._state == "success" and self._border_flash_alpha > 0:
            border_col = QColor(COL_SUCCESS)
            border_col.setAlpha(self._border_flash_alpha)
        elif self._state == "error" and self._border_flash_alpha > 0:
            border_col = QColor(COL_ERROR)
            border_col.setAlpha(self._border_flash_alpha)
        p.setPen(QPen(border_col, 1))
        p.drawRoundedRect(QRectF(0.5, 0.5, w - 1, h - 1), radius, radius)

        if self._state == "dormant":
            self._paint_dormant(p, w, h)
        elif self._state == "recording":
            self._paint_recording(p, w, h)
        elif self._state == "processing":
            self._paint_processing(p, w, h)
        elif self._state in ("success", "error"):
            self._paint_dormant(p, w, h)

        p.end()

    def _paint_dormant(self, p: QPainter, w: int, h: int):
        """Draw mini static bars — dim normally, terracotta on hover."""
        col = COL_MINIBAR_HV if self._hovered else COL_MINIBAR
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(col))

        total_bars_w = DORMANT_BARS * DORMANT_BAR_W + (DORMANT_BARS - 1) * DORMANT_BAR_GAP
        sx = (w - total_bars_w) / 2
        cy = h / 2

        for i in range(DORMANT_BARS):
            bh = self._dormant_bar_h[i]
            x = sx + i * (DORMANT_BAR_W + DORMANT_BAR_GAP)
            p.drawRect(QRectF(x, cy - bh / 2, DORMANT_BAR_W, bh))

    def _paint_recording(self, p: QPainter, w: int, h: int):
        """Draw X button, voice bars, stop button — tight layout."""
        # X button
        xr = self._x_btn_rect()
        x_bg = COL_X_BG_HV if self._hover_x else COL_X_BG
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(x_bg))
        p.drawEllipse(xr)
        pen_col = COL_X_FG_HV if self._hover_x else COL_X_FG
        p.setPen(QPen(pen_col, 1.8))
        margin = xr.width() * 0.3
        p.drawLine(
            QPoint(int(xr.x() + margin), int(xr.y() + margin)),
            QPoint(int(xr.right() - margin), int(xr.bottom() - margin)),
        )
        p.drawLine(
            QPoint(int(xr.right() - margin), int(xr.y() + margin)),
            QPoint(int(xr.x() + margin), int(xr.bottom() - margin)),
        )

        # Voice bars — tight to buttons
        bars_left = xr.right() + 4
        bars_right = self._stop_btn_rect().x() - 4
        bars_width = bars_right - bars_left
        total_bars_w = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP
        bx = bars_left + (bars_width - total_bars_w) / 2
        cy = h / 2

        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(COL_BAR))
        for i in range(NUM_BARS):
            bh = max(2, self._bar_heights[i])
            x = bx + i * (BAR_W + BAR_GAP)
            p.drawRect(QRectF(x, cy - bh / 2, BAR_W, bh))

        # Stop button
        sr = self._stop_btn_rect()
        stop_bg = COL_STOP_BG_HV if self._hover_stop else COL_STOP_BG
        p.setBrush(QBrush(stop_bg))
        p.drawEllipse(sr)
        sq_size = sr.width() * 0.35
        sq_x = sr.center().x() - sq_size / 2
        sq_y = sr.center().y() - sq_size / 2
        p.setBrush(QBrush(COL_STOP_FG))
        p.drawRoundedRect(QRectF(sq_x, sq_y, sq_size, sq_size), 1.5, 1.5)

    def _paint_processing(self, p: QPainter, w: int, h: int):
        """Draw X cancel button + pulsing terracotta bars."""
        # X button (cancel processing)
        xr = self._x_btn_rect()
        x_bg = COL_X_BG_HV if self._hover_x else COL_X_BG
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(x_bg))
        p.drawEllipse(xr)
        pen_col = COL_X_FG_HV if self._hover_x else COL_X_FG
        p.setPen(QPen(pen_col, 1.8))
        margin = xr.width() * 0.3
        p.drawLine(
            QPoint(int(xr.x() + margin), int(xr.y() + margin)),
            QPoint(int(xr.right() - margin), int(xr.bottom() - margin)),
        )
        p.drawLine(
            QPoint(int(xr.right() - margin), int(xr.y() + margin)),
            QPoint(int(xr.x() + margin), int(xr.bottom() - margin)),
        )

        # Pulsing bars — shifted right of X button
        bars_left = xr.right() + 4
        bars_width = w - bars_left - 4
        total_bars_w = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP
        bx = bars_left + (bars_width - total_bars_w) / 2
        cy = h / 2
        max_h = h - 10

        p.setPen(Qt.PenStyle.NoPen)
        for i in range(NUM_BARS):
            phase = self._proc_phase + i * 0.3
            t = (math.sin(phase) + 1) / 2
            bh = 4 + (max_h - 4) * t * 0.5
            alpha = int(80 + 175 * t)
            col = QColor(COL_BAR_PROC)
            col.setAlpha(alpha)
            p.setBrush(QBrush(col))
            x = bx + i * (BAR_W + BAR_GAP)
            p.drawRect(QRectF(x, cy - bh / 2, BAR_W, bh))

    # ------------------------------------------------------------------
    # Mouse events
    # ------------------------------------------------------------------

    def enterEvent(self, event):
        # Save the foreground window before the pill steals focus on click
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            # Don't save our own window handle — we need the *other* app's handle
            own_hwnd = int(self.winId())
            if hwnd and hwnd != own_hwnd:
                self._prev_foreground = hwnd
        except Exception:
            pass
        self._hovered = True
        if self._state == "dormant":
            self._animate_to(HOVER_W, HOVER_H)
            self._tooltip.show_above(self)
        self.update()

    def leaveEvent(self, event):
        self._hovered = False
        self._hover_x = False
        self._hover_stop = False
        self._tooltip.hide()
        if self._state == "dormant":
            self._animate_to(DORMANT_W, DORMANT_H)
        self.update()

    def mouseMoveEvent(self, event):
        pos = event.position() if hasattr(event, 'position') else event.localPos()
        if self._state == "recording":
            self._hover_x = self._x_btn_rect().contains(pos)
            self._hover_stop = self._stop_btn_rect().contains(pos)
            if self._hover_x or self._hover_stop:
                self.setCursor(Qt.CursorShape.PointingHandCursor)
            else:
                self.setCursor(Qt.CursorShape.ArrowCursor)
        elif self._state == "processing":
            self._hover_x = self._x_btn_rect().contains(pos)
            self.setCursor(Qt.CursorShape.PointingHandCursor if self._hover_x
                           else Qt.CursorShape.ArrowCursor)
        elif self._state == "dormant":
            self.setCursor(Qt.CursorShape.PointingHandCursor)
        else:
            # success / error — no interactive elements, reset cursor
            self._hover_x = False
            self._hover_stop = False
            self.setCursor(Qt.CursorShape.ArrowCursor)
        self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            pos = event.position() if hasattr(event, 'position') else event.localPos()
            if self._state == "dormant":
                self._tooltip.hide()
                self.record_requested.emit()
            elif self._state == "recording":
                if self._x_btn_rect().contains(pos):
                    self.cancel_requested.emit()
                elif self._stop_btn_rect().contains(pos):
                    self.stop_requested.emit()
            elif self._state == "processing":
                if self._x_btn_rect().contains(pos):
                    self.cancel_requested.emit()
        elif event.button() == Qt.MouseButton.RightButton:
            self._ctx_menu.exec(QCursor.pos())

    # ------------------------------------------------------------------
    # Context menu
    # ------------------------------------------------------------------

    def set_menu_provider(self, provider):
        """Set a callable returning (settings, mics, history, active_mic)."""
        self._menu_provider = provider

    def _build_context_menu(self):
        self._ctx_menu = QMenu(self)
        self._ctx_menu.setStyleSheet(_MENU_STYLE)
        self._ctx_menu.aboutToShow.connect(self._populate_menu)
        # Build static fallback for standalone use
        self._build_static_menu()

    def _populate_menu(self):
        """Rebuild menu with fresh data before showing."""
        if not self._menu_provider:
            return  # keep static menu
        self._ctx_menu.clear()
        data = self._menu_provider()
        if data:
            settings, mics, history, active_mic = data
            self._build_dynamic_menu(settings, mics, history, active_mic)

    def _build_dynamic_menu(self, settings, mics, history, active_mic):
        menu = self._ctx_menu

        # Record / Stop / Processing
        if self._state == "recording":
            act = menu.addAction("Stop Recording")
            act.triggered.connect(self.stop_requested.emit)
        elif self._state == "processing":
            act = menu.addAction("Processing\u2026")
            act.setEnabled(False)
        else:
            act = menu.addAction("Record")
            act.triggered.connect(self.record_requested.emit)

        menu.addSeparator()

        # Microphone submenu
        mic_menu = QMenu("\U0001f3a4  Microphone", menu)
        mic_menu.setStyleSheet(_MENU_STYLE)
        if mics:
            for mic in mics:
                act = mic_menu.addAction(mic["name"])
                act.setCheckable(True)
                act.setChecked(mic["id"] == active_mic)
                mid = mic["id"]
                act.triggered.connect(lambda checked, m=mid: self.mic_selected.emit(m))
        else:
            act = mic_menu.addAction("No microphones found")
            act.setEnabled(False)
        menu.addMenu(mic_menu)

        # Sound Effects toggle
        sound_on = settings.get("sound_enabled", True)
        act_sound = menu.addAction("\U0001f50a  Sound Effects")
        act_sound.setCheckable(True)
        act_sound.setChecked(sound_on)
        act_sound.triggered.connect(lambda checked: self.sound_toggled.emit(checked))

        # Mode toggle
        mode = settings.get("mode", "local")
        label = "Local" if mode == "local" else "API"
        next_mode = "api" if mode == "local" else "local"
        act_mode = menu.addAction(f"\U0001f4dd  Mode: {label}")
        act_mode.triggered.connect(lambda checked, m=next_mode: self.mode_toggled.emit(m))

        menu.addSeparator()

        # Recent Transcriptions submenu
        if history:
            recent_menu = QMenu("Recent Transcriptions", menu)
            recent_menu.setStyleSheet(_MENU_STYLE)
            for entry in history:
                text = entry.get("text", "")
                disp = (text[:40] + "\u2026") if len(text) > 40 else (text or "(empty)")
                act = recent_menu.addAction(disp)
                act.triggered.connect(lambda checked, t=text: self.copy_requested.emit(t))
            menu.addMenu(recent_menu)

        # Paste Last Transcript
        act_paste = menu.addAction("Paste Last Transcript")
        act_paste.triggered.connect(self.paste_last_requested.emit)

        menu.addSeparator()

        # Navigation
        act_show = menu.addAction("Show WhisperClick")
        act_show.triggered.connect(self.show_main_requested.emit)

        act_settings = menu.addAction("Settings")
        act_settings.triggered.connect(self.open_settings_requested.emit)

        menu.addSeparator()

        # Hotkey reminder
        act_hotkey = menu.addAction("Ctrl+Shift+R")
        act_hotkey.setEnabled(False)

        # Hide
        act_hide = menu.addAction("Hide for Now")
        act_hide.triggered.connect(self.hide_requested.emit)

    def _build_static_menu(self):
        """Simple static menu for standalone use (no provider)."""
        menu = self._ctx_menu

        act_show = menu.addAction("Show WhisperClick")
        act_show.triggered.connect(self.show_main_requested.emit)

        act_settings = menu.addAction("Go to settings")
        act_settings.triggered.connect(self.open_settings_requested.emit)

        menu.addSeparator()

        act_paste = menu.addAction("Paste last transcript")
        act_paste.triggered.connect(self.paste_last_requested.emit)

        menu.addSeparator()

        act_hide = menu.addAction("Hide for now")
        act_hide.triggered.connect(self.hide_requested.emit)


# ---------------------------------------------------------------------------
# Standalone test — with sound
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    from src.backend.tones import play_start_tone, play_stop_tone, play_success_tone, play_error_tone

    app = QApplication(sys.argv)
    pill = PillWidget()
    pill.show()

    level_timer = QTimer()

    def on_record():
        play_start_tone()
        pill.set_state("recording")
        def update_level():
            pill.set_audio_level(random.random() * 0.8 + 0.1)
        level_timer.timeout.connect(update_level)
        level_timer.start(80)

    def on_stop():
        play_stop_tone()
        level_timer.stop()
        try: level_timer.timeout.disconnect()
        except RuntimeError: pass
        pill.set_state("processing")

        def on_done():
            play_success_tone()
            pill.set_state("success")
        QTimer.singleShot(2000, on_done)

    def on_cancel():
        level_timer.stop()
        try: level_timer.timeout.disconnect()
        except RuntimeError: pass
        pill.set_state("dormant")

    def on_hide():
        pill.hide()
        QTimer.singleShot(2000, pill.show)

    pill.record_requested.connect(on_record)
    pill.stop_requested.connect(on_stop)
    pill.cancel_requested.connect(on_cancel)
    pill.show_main_requested.connect(lambda: print("[ctx] Show WhisperClick"))
    pill.open_settings_requested.connect(lambda: print("[ctx] Go to settings"))
    pill.paste_last_requested.connect(lambda: print("[ctx] Paste last transcript"))
    pill.hide_requested.connect(on_hide)

    sys.exit(app.exec())
