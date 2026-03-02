const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const zlib = require('zlib');

let tray = null;

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

function generateTrayIcon(color = '#CF9673', size = 16) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // Build RGBA scanlines (each row prefixed with filter byte 0 = None)
  const rawData = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, cy = size / 2, radius = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    rawData[row] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = row + 1 + x * 4;
      const dist = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      if (dist <= radius + 0.5) {
        const aa = Math.max(0, Math.min(1, radius - dist + 0.5));
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
        rawData[px + 3] = Math.round(aa * 255);
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit depth 8, color type 6 (RGBA)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

function createTray({ onShow, onBuildMenu, isDev = false }) {
  const iconPath = path.join(__dirname, '../icons/icon.ico');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = generateTrayIcon(isDev ? '#60A5FA' : '#CF9673');
  } catch {
    icon = generateTrayIcon(isDev ? '#60A5FA' : '#CF9673');
  }
  tray = new Tray(icon);
  tray.setToolTip(isDev ? 'WhisperClick [DEV]' : 'WhisperClick');

  // Dynamic menu: rebuild on every right-click so state is always fresh
  tray.on('right-click', async () => {
    const template = await onBuildMenu();
    const menu = Menu.buildFromTemplate(template);
    tray.popUpContextMenu(menu);
  });
  tray.on('click', onShow);

  return tray;
}

function updateTrayIcon(state) {
  if (!tray) return;
  const colors = {
    dormant: '#CF9673',
    recording: '#DC6450',
    processing: '#CF9673',
    success: '#A3B18A',
    error: '#DC6450',
  };
  tray.setImage(generateTrayIcon(colors[state] || '#CF9673'));
}

module.exports = { createTray, updateTrayIcon };
