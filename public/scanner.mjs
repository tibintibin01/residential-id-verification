const TOKEN = /^[a-f0-9]{64}$/;

export function verificationTokenFromQr(value, expectedOrigin) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const link = new URL(value.trim());
    const loopbackPreview = link.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(link.hostname);
    if ((link.protocol !== 'https:' && !loopbackPreview) || link.origin !== expectedOrigin || link.username || link.password ||
        !['/verify', '/verify/'].includes(link.pathname) || link.search || !TOKEN.test(link.hash.slice(1))) return '';
    return link.hash.slice(1);
  } catch { return ''; }
}

export function stopTracks(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

export async function acquireCamera(mediaDevices, isCurrent) {
  const stream = await mediaDevices.getUserMedia({ audio: false, video: {
    facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 },
  } });
  if (!isCurrent()) { stopTracks(stream); return null; }
  return stream;
}

export function cameraErrorMessage(error) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'Camera access was not allowed. Choose a QR photo, or close this window and use your phone’s Camera app.';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return 'No camera was found. You can choose a photo of the card’s QR instead.';
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return 'The camera is busy or unavailable. Close other camera apps and try again, or choose a QR photo.';
  return 'The camera could not start. Try again, choose a QR photo, or use your phone’s Camera app.';
}

let decoderPromise;
async function loadSoftwareDecoder() {
  if (!decoderPromise) decoderPromise = import('./vendor/jsQR.js').then(() => {
    if (typeof globalThis.jsQR !== 'function') throw new Error('decoder unavailable');
    return globalThis.jsQR;
  }).catch(error => { decoderPromise = undefined; throw error; });
  return decoderPromise;
}

export function setupScanner({ onScan }) {
  const $ = id => document.getElementById(id);
  const dialog = $('scanner-dialog'), video = $('scanner-video'), preview = $('scanner-preview');
  const status = $('scanner-status'), start = $('scanner-start'), photo = $('scanner-photo'), fileInput = $('scanner-file');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let generation = 0, stream, frameTimer, idleTimer, nativeDetector, softwareDecoder;
  const current = id => id === generation && dialog.open;
  const message = text => { if (status.textContent !== text) status.textContent = text; };

  function stop() {
    generation++;
    clearTimeout(frameTimer); clearTimeout(idleTimer);
    stopTracks(stream); stream = undefined;
    video.pause(); video.srcObject = null;
    canvas.width = 0; canvas.height = 0;
    preview.hidden = true; start.disabled = false; photo.disabled = false;
  }

  async function prepareDecoder() {
    if (nativeDetector || softwareDecoder) return;
    if (globalThis.BarcodeDetector) {
      try {
        const formats = await globalThis.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) nativeDetector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      } catch { /* Use the same-origin software decoder when the native API is unavailable. */ }
    }
    if (!nativeDetector) softwareDecoder = await loadSoftwareDecoder();
  }

  async function decode(source, width, height, maximum) {
    if (nativeDetector) {
      try { return (await nativeDetector.detect(source)).map(result => result.rawValue); }
      catch { nativeDetector = undefined; softwareDecoder = await loadSoftwareDecoder(); }
    }
    if (!context || !width || !height) return [];
    const ratio = Math.min(1, maximum / Math.max(width, height));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = softwareDecoder(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    return result?.data ? [result.data] : [];
  }

  function accept(values, id) {
    if (!current(id)) return false;
    for (const value of values) {
      const token = verificationTokenFromQr(value, location.origin);
      if (token) { stop(); dialog.close(); onScan(token); return true; }
    }
    if (values.length) message('This is not a supported ID verification link. Scan a Dipaculao card with a website QR. Older cards may need a reprint.');
    return false;
  }

  async function tick(id) {
    if (!current(id)) return;
    try {
      if (video.readyState >= 2 && accept(await decode(video, video.videoWidth, video.videoHeight, 720), id)) return;
    } catch {
      if (current(id)) { stop(); message('The QR scanner could not continue. Choose a QR photo, or use your phone’s Camera app.'); }
      return;
    }
    if (current(id)) frameTimer = setTimeout(() => tick(id), 200);
  }

  async function startCamera() {
    stop(); const id = generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      message('This browser cannot open a camera here. Choose a QR photo, or use your phone’s Camera app.'); return;
    }
    start.disabled = true; message('Opening the camera. Allow camera access if your browser asks.');
    try {
      await prepareDecoder(); if (!current(id)) return;
      const captured = await acquireCamera(navigator.mediaDevices, () => current(id));
      if (!captured) return;
      stream = captured; video.srcObject = stream; preview.hidden = false;
      await video.play(); if (!current(id)) return;
      start.disabled = false; start.textContent = 'Restart camera';
      message('Keep the card’s QR inside the frame. It will open automatically.');
      idleTimer = setTimeout(() => { if (current(id)) { stop(); message('The camera has stopped after one minute. Tap Start camera to scan again.'); start.textContent = 'Start camera'; } }, 60000);
      tick(id);
    } catch (error) {
      if (current(id)) { stop(); message(cameraErrorMessage(error)); start.textContent = 'Try camera again'; }
    }
  }

  async function readPhoto(file) {
    stop(); const id = generation;
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) { message('Choose an image of the QR smaller than 15 MB.'); return; }
    photo.disabled = true; message('Reading the QR photo on this device…');
    let imageUrl;
    try {
      await prepareDecoder(); if (!current(id)) return;
      imageUrl = URL.createObjectURL(file);
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = imageUrl; });
      if (!current(id)) return;
      const values = await decode(image, image.naturalWidth, image.naturalHeight, 1800);
      if (!accept(values, id) && current(id) && !values.length) message('No readable QR was found. Choose a clear, close photo of the QR, or try the camera.');
    } catch { if (current(id)) message('This photo could not be read. Choose another QR image, or use your phone’s Camera app.'); }
    finally { if (imageUrl) URL.revokeObjectURL(imageUrl); if (current(id)) photo.disabled = false; fileInput.value = ''; }
  }

  $('scan-another').addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal(); startCamera();
  });
  $('scanner-close').addEventListener('click', () => { stop(); dialog.close(); });
  dialog.addEventListener('close', stop);
  start.addEventListener('click', startCamera);
  photo.addEventListener('click', () => { stop(); fileInput.click(); });
  fileInput.addEventListener('change', () => readPhoto(fileInput.files?.[0]));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && dialog.open) { stop(); message('Camera paused while this page was hidden. Tap Start camera to resume.'); start.textContent = 'Start camera'; }
  });
  addEventListener('pagehide', stop);
}
