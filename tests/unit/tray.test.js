const zlib = require('zlib');
const { nativeImage, Tray, Menu } = require('electron');

/**
 * Helper: get a fresh tray module (resets module-level `let tray = null`).
 * We delete only the tray module from cache, keeping the electron mock intact.
 */
function loadTray() {
  const trayPath = require.resolve('../../electron/tray');
  delete require.cache[trayPath];
  return require('../../electron/tray');
}

/** Helper: capture the PNG buffer passed to nativeImage.createFromBuffer */
function captureIcon(fn) {
  let capturedBuf = null;
  const original = nativeImage.createFromBuffer;
  nativeImage.createFromBuffer = jest.fn((buf) => {
    capturedBuf = buf;
    return { _buffer: buf, toPNG: () => buf, getSize: () => ({ width: 16, height: 16 }) };
  });
  fn();
  nativeImage.createFromBuffer = original;
  return capturedBuf;
}

/** Helper: extract the first opaque pixel's RGB from a 16x16 RGBA PNG buffer */
function extractFirstPixelColor(pngBuf) {
  // Find IDAT chunk
  let offset = 8; // skip PNG signature
  while (offset < pngBuf.length) {
    const len = pngBuf.readUInt32BE(offset);
    const type = pngBuf.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') {
      const compressed = pngBuf.slice(offset + 8, offset + 8 + len);
      const raw = zlib.inflateSync(compressed);
      const rowStride = 16 * 4 + 1; // 16 pixels * 4 channels + 1 filter byte
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const px = y * rowStride + 1 + x * 4;
          if (raw[px + 3] > 0) {
            const r = raw[px].toString(16).padStart(2, '0');
            const g = raw[px + 1].toString(16).padStart(2, '0');
            const b = raw[px + 2].toString(16).padStart(2, '0');
            return `#${r}${g}${b}`.toUpperCase();
          }
        }
      }
      break;
    }
    offset += 12 + len;
  }
  return null;
}

/** Independent CRC32 implementation for verification */
function computeCRC32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG structure ───────────────────────────────────────────────────────

describe('PNG structure', () => {
  test('valid PNG signature (89504E47)', () => {
    const { createTray } = loadTray();
    const buf = captureIcon(() => {
      createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    });
    expect(buf).not.toBeNull();
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80);
    expect(buf[2]).toBe(78);
    expect(buf[3]).toBe(71);
  });

  test('IHDR chunk has 16x16 dimensions', () => {
    const { createTray } = loadTray();
    const buf = captureIcon(() => {
      createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    });
    // After 8-byte signature: 4 length + 4 "IHDR" = data starts at offset 16
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(16);
    expect(height).toBe(16);
  });

  test('IDAT chunk exists', () => {
    const { createTray } = loadTray();
    const buf = captureIcon(() => {
      createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    });
    expect(buf.toString('binary')).toContain('IDAT');
  });

  test('IEND chunk exists', () => {
    const { createTray } = loadTray();
    const buf = captureIcon(() => {
      createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    });
    expect(buf.toString('binary')).toContain('IEND');
  });
});

// ── CRC32 ───────────────────────────────────────────────────────────────

describe('CRC32', () => {
  test('IHDR CRC matches independently computed CRC32', () => {
    const { createTray } = loadTray();
    const buf = captureIcon(() => {
      createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    });

    const ihdrLen = buf.readUInt32BE(8);
    expect(ihdrLen).toBe(13);
    const ihdrTypeAndData = buf.slice(12, 12 + 4 + ihdrLen);
    const ihdrCrcStored = buf.readUInt32BE(12 + 4 + ihdrLen);
    expect(ihdrCrcStored).toBe(computeCRC32(ihdrTypeAndData));
  });
});

// ── State-to-color mapping ──────────────────────────────────────────────

describe('state-to-color mapping', () => {
  function getColorForState(state) {
    const { createTray, updateTrayIcon } = loadTray();
    // Create tray first to set the module-level `tray` variable
    createTray({ onShow: () => {}, onStartStop: () => {}, onSettings: () => {}, onQuit: () => {} });
    // Now capture the icon generated for updateTrayIcon
    const buf = captureIcon(() => updateTrayIcon(state));
    if (!buf) return null;
    return extractFirstPixelColor(buf);
  }

  test('dormant → #CF9673', () => {
    expect(getColorForState('dormant')).toBe('#CF9673');
  });

  test('recording → #DC6450', () => {
    expect(getColorForState('recording')).toBe('#DC6450');
  });

  test('processing → #CF9673', () => {
    expect(getColorForState('processing')).toBe('#CF9673');
  });

  test('success → #A3B18A', () => {
    expect(getColorForState('success')).toBe('#A3B18A');
  });

  test('error → #DC6450', () => {
    expect(getColorForState('error')).toBe('#DC6450');
  });
});

// ── createTray ──────────────────────────────────────────────────────────

describe('createTray', () => {
  test('creates a Tray-like object with icon', () => {
    const { createTray } = loadTray();
    const result = createTray({
      onShow: () => {},
      onStartStop: () => {},
      onSettings: () => {},
      onQuit: () => {},
    });
    // Duck-type check — tray.js constructs `new Tray(icon)` from electron
    expect(result).toBeDefined();
    expect(result.toolTip).toBeDefined();
    expect(typeof result.setImage).toBe('function');
  });

  test('sets context menu with expected items', () => {
    const { createTray } = loadTray();
    const result = createTray({
      onShow: () => {},
      onStartStop: () => {},
      onSettings: () => {},
      onQuit: () => {},
    });
    expect(result.contextMenu).toBeDefined();
    expect(result.contextMenu._template).toBeDefined();
    // Should have Show, separator, Start Recording, separator, Settings, Quit
    const labels = result.contextMenu._template
      .filter(item => item.label)
      .map(item => item.label);
    expect(labels).toContain('Show WhisperClick');
    expect(labels).toContain('Quit');
  });
});
