/* WhisperClick service worker — minimal.
 * Its only job is to make the app installable (Add to Home Screen) and open
 * standalone. Transcription always needs the live backend, so we deliberately
 * do NOT cache app HTML/JS (stale shells would break the engine bridge).
 * A pass-through fetch handler is enough to satisfy the install criteria.
 */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => { /* network pass-through */ });
