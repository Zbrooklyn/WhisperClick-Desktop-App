const zlib = require('zlib');
const { nativeImage, Tray, Menu } = require('electron');

/**
 * Helper: get a fresh tray module (resets module-level state).
 */
function loadTray() {
  const trayPath = require.resolve('../../electron/tray');
  delete require.cache[trayPath];
  return require('../../electron/tray');
}

/** Helper: capture ALL buffers passed to nativeImage.createFromBuffer */
function withBufferCapture(fn) {
  const captured = [];
  const original = nativeImage.createFromBuffer;
  nativeImage.createFromBuffer = jest.fn((buf) => {
    captured.push(buf);
    return { _buffer: buf, toPNG: () => buf, getSize: () => ({ width: 32, height: 32 }), isEmpty: () => false };
  });
  fn();
  nativeImage.createFromBuffer = original;
  return captured;
}

/** Helper: extract the first opaque pixel's RGB from a RGBA PNG buffer */
function extractFirstPixelColor(pngBuf) {
  let offset = 8;
  const width = pngBuf.readUInt32BE(16);
  while (offset < pngBuf.length) {
    const len = pngBuf.readUInt32BE(offset);
    const type = pngBuf.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') {
      const compressed = pngBuf.slice(offset + 8, offset + 8 + len);
      const raw = zlib.inflateSync(compressed);
      const rowStride = width * 4 + 1;
      for (let y = 0; y < width; y++) {
        for (let x = 0; x < width; x++) {
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
  test('tray icon is a valid PNG with correct structure', () => {
    const { createTray } = loadTray();
    const bufs = withBufferCapture(() => {
      createTray({ onShow: () => {}, onBuildMenu: async () => [] });
    });
    expect(bufs.length).toBeGreaterThan(0);
    const buf = bufs[0];

    // Valid PNG signature
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80);
    expect(buf[2]).toBe(78);
    expect(buf[3]).toBe(71);

    // Square dimensions
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(16);
    expect(width).toBe(height);

    // Has IDAT and IEND chunks
    const binary = buf.toString('binary');
    expect(binary).toContain('IDAT');
    expect(binary).toContain('IEND');

    // IHDR CRC is correct
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
    withBufferCapture(() => {
      createTray({ onShow: () => {}, onBuildMenu: async () => [] });
    });
    updateTrayIcon(state);
    // Get the buffer from the tray's setImage call (the nativeImage has _buffer)
    const trayInst = Tray._instances[Tray._instances.length - 1];
    const img = trayInst.icon;
    if (!img || !img._buffer) return null;
    return extractFirstPixelColor(img._buffer);
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
      onBuildMenu: async () => [],
    });
    expect(result).toBeDefined();
    expect(result.toolTip).toBeDefined();
    expect(typeof result.setImage).toBe('function');
  });

  test('registers right-click handler for dynamic menu', async () => {
    const { createTray } = loadTray();
    const mockTemplate = [
      { label: 'Show WhisperClick' },
      { type: 'separator' },
      { label: 'Quit' },
    ];
    const result = createTray({
      onShow: () => {},
      onBuildMenu: async () => mockTemplate,
    });
    expect(result._listeners['right-click']).toBeDefined();
    await result.emit('right-click');
    expect(result.lastPopupMenu).toBeDefined();
    expect(result.lastPopupMenu._template).toBeDefined();
    const labels = result.lastPopupMenu._template
      .filter(item => item.label)
      .map(item => item.label);
    expect(labels).toContain('Show WhisperClick');
    expect(labels).toContain('Quit');
  });
});
