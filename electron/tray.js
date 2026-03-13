const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

let tray = null;

// ---------------------------------------------------------------------------
// PNG helpers
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(pixels, size) {
  // Build RGBA scanlines with filter byte 0 (None) per row
  const rawData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowOut = y * (size * 4 + 1);
    rawData[rowOut] = 0; // filter: None
    pixels.copy(rawData, rowOut + 1, y * size * 4, (y + 1) * size * 4);
  }
  const compressed = zlib.deflateSync(rawData);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Decode source icon → raw RGBA pixels, downscaled to tray size
// ---------------------------------------------------------------------------

let _sourcePixels = null; // cached decoded RGBA at tray size
const TRAY_SIZE = 32;

function loadSourcePixels() {
  if (_sourcePixels) return _sourcePixels;

  const iconPath = path.join(__dirname, '../icons/icon.png');
  let pngBuf;
  try { pngBuf = fs.readFileSync(iconPath); } catch { return null; }

  // Read IHDR
  const srcW = pngBuf.readUInt32BE(16);
  const srcH = pngBuf.readUInt32BE(20);
  const colorType = pngBuf[25]; // 6 = RGBA
  const bpp = colorType === 6 ? 4 : 3;
  const srcRowBytes = srcW * bpp;

  // Collect IDAT chunks and decompress
  let offset = 8;
  const idatBufs = [];
  while (offset < pngBuf.length) {
    const len = pngBuf.readUInt32BE(offset);
    const type = pngBuf.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idatBufs.push(pngBuf.slice(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }
  const rawData = zlib.inflateSync(Buffer.concat(idatBufs));

  // Unfilter rows
  const pixels = Buffer.alloc(srcH * srcRowBytes);
  let prevRow = Buffer.alloc(srcRowBytes);
  for (let y = 0; y < srcH; y++) {
    const rowStart = y * (srcRowBytes + 1);
    const filter = rawData[rowStart];
    const row = rawData.slice(rowStart + 1, rowStart + 1 + srcRowBytes);
    const out = Buffer.alloc(srcRowBytes);
    for (let i = 0; i < srcRowBytes; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      switch (filter) {
        case 0: out[i] = row[i]; break;
        case 1: out[i] = (row[i] + a) & 0xFF; break;
        case 2: out[i] = (row[i] + b) & 0xFF; break;
        case 3: out[i] = (row[i] + Math.floor((a + b) / 2)) & 0xFF; break;
        case 4: { // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          out[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
      }
    }
    out.copy(pixels, y * srcRowBytes);
    prevRow = out;
  }

  // Downscale to TRAY_SIZE x TRAY_SIZE (nearest neighbor)
  const dst = Buffer.alloc(TRAY_SIZE * TRAY_SIZE * 4);
  const scale = srcW / TRAY_SIZE;
  for (let y = 0; y < TRAY_SIZE; y++) {
    const srcY = Math.min(Math.floor(y * scale), srcH - 1);
    for (let x = 0; x < TRAY_SIZE; x++) {
      const srcX = Math.min(Math.floor(x * scale), srcW - 1);
      const srcOff = srcY * srcRowBytes + srcX * bpp;
      const dstOff = (y * TRAY_SIZE + x) * 4;
      dst[dstOff] = pixels[srcOff];         // R
      dst[dstOff + 1] = pixels[srcOff + 1]; // G
      dst[dstOff + 2] = pixels[srcOff + 2]; // B
      dst[dstOff + 3] = bpp === 4 ? pixels[srcOff + 3] : 255; // A
    }
  }

  _sourcePixels = dst;
  return dst;
}

// ---------------------------------------------------------------------------
// Tint source pixels to a target color, preserving alpha
// ---------------------------------------------------------------------------

const _tintCache = {}; // color → nativeImage

function getTintedIcon(color) {
  if (_tintCache[color]) return _tintCache[color];

  const src = loadSourcePixels();
  if (!src) return null;

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  const tinted = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3];
    if (alpha > 0) {
      tinted[i] = r;
      tinted[i + 1] = g;
      tinted[i + 2] = b;
      tinted[i + 3] = alpha;
    }
  }

  const png = encodePng(tinted, TRAY_SIZE);
  const img = nativeImage.createFromBuffer(png);
  _tintCache[color] = img;
  return img;
}

// ---------------------------------------------------------------------------
// Fallback: colored circle (used if icon.png can't be loaded)
// ---------------------------------------------------------------------------

function generateFallbackIcon(color = '#CF9673', size = 16) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, radius = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      if (dist <= radius + 0.5) {
        const aa = Math.max(0, Math.min(1, radius - dist + 0.5));
        pixels[px] = r;
        pixels[px + 1] = g;
        pixels[px + 2] = b;
        pixels[px + 3] = Math.round(aa * 255);
      }
    }
  }
  return nativeImage.createFromBuffer(encodePng(pixels, size));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const STATE_COLORS = {
  dormant: '#CF9673',
  recording: '#DC6450',
  processing: '#CF9673',
  success: '#A3B18A',
  error: '#DC6450',
};

function createTray({ onShow, onBuildMenu, onToggleRecording, onCancelRecording, getIsRecordingActive, onBalloonClick, getTrayClickAction, onCaptureTarget, isDev = false }) {
  const defaultColor = isDev ? '#60A5FA' : '#CF9673';
  const icon = getTintedIcon(defaultColor) || generateFallbackIcon(defaultColor);
  tray = new Tray(icon);
  tray.setToolTip(isDev ? 'WhisperClick [DEV]' : 'WhisperClick');

  // Dynamic menu: rebuild on every right-click so state is always fresh
  tray.on('right-click', async () => {
    const template = await onBuildMenu();
    const menu = Menu.buildFromTemplate(template);
    tray.popUpContextMenu(menu);
  });

  // Click behavior: 'show' mode opens window; 'record' mode toggles recording
  // In 'record' mode, double-click opens window instead.
  // On Windows, Electron fires 'double-click' natively — the second click never
  // reaches the 'click' handler, so we must listen for both events.
  let clickTimeout = null;

  tray.on('click', () => {
    const mode = getTrayClickAction ? getTrayClickAction() : 'show';

    if (mode === 'record') {
      // Capture the user's foreground window IMMEDIATELY — before the 300ms
      // double-click delay, and before Windows shifts focus to the tray area.
      // This lets auto-paste restore focus to the correct text field.
      if (onCaptureTarget) onCaptureTarget();

      // Delay single-click action to let double-click cancel it
      if (clickTimeout) return; // Already waiting
      clickTimeout = setTimeout(() => {
        clickTimeout = null;
        if (onToggleRecording) onToggleRecording();
      }, 300);
    } else {
      onShow();
    }
  });

  tray.on('double-click', () => {
    const mode = getTrayClickAction ? getTrayClickAction() : 'show';

    if (mode === 'record') {
      // Cancel the pending single-click toggle
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }
      const isActive = getIsRecordingActive ? getIsRecordingActive() : false;
      if (isActive) {
        // Mid-recording: cancel without opening window (stay in tray mode)
        if (onCancelRecording) onCancelRecording();
      } else {
        // Dormant: open window
        onShow();
      }
    } else {
      onShow();
    }
  });

  // Balloon click opens settings
  tray.on('balloon-click', () => {
    if (onBalloonClick) onBalloonClick();
  });

  return tray;
}

function updateTrayIcon(state) {
  if (!tray) return;
  const color = STATE_COLORS[state] || '#CF9673';
  const icon = getTintedIcon(color) || generateFallbackIcon(color);
  tray.setImage(icon);
}

function updateTrayTooltip(text) {
  if (tray) tray.setToolTip(text);
}

function showTrayBalloon(title, content) {
  if (!tray) return;
  tray.displayBalloon({ iconType: 'error', title, content, noSound: false });
}

let _flashTimer = null;
function flashTrayError(tooltipOverride) {
  if (!tray) return;
  const errorIcon = getTintedIcon('#DC6450') || generateFallbackIcon('#DC6450');
  tray.setImage(errorIcon);
  if (tooltipOverride) tray.setToolTip(tooltipOverride);

  clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => {
    const dormantIcon = getTintedIcon('#CF9673') || generateFallbackIcon('#CF9673');
    tray.setImage(dormantIcon);
    tray.setToolTip('WhisperClick');
    _flashTimer = null;
  }, 2000);
}

module.exports = { createTray, updateTrayIcon, updateTrayTooltip, showTrayBalloon, flashTrayError };
