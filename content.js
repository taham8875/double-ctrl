(function () {
  'use strict';

  // Prevent double-injection
  if (window.__dblctrl_loaded) return;
  window.__dblctrl_loaded = true;

  // ── State ──────────────────────────────────────────────────────────────

  const DOUBLE_CTRL_THRESHOLD = 400; // ms between two Ctrl presses
  const MIN_IMAGE_SIZE = 20; // px - skip tiny images
  const ZOOM_LEVELS = [0.5, 1, 2, 4, 8];

  let lastCtrlTime = 0;
  let mouseX = 0;
  let mouseY = 0;

  let overlayEl = null;
  let currentImageUrl = null;
  let currentZoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;

  // ── (A) Double-Ctrl Detection ─────────────────────────────────────────

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  document.addEventListener('keydown', (e) => {
    // Close overlay on Escape
    if (e.key === 'Escape' && overlayEl) {
      closeOverlay();
      return;
    }

    if (e.key !== 'Control' || e.repeat) return;

    const now = Date.now();
    if (now - lastCtrlTime < DOUBLE_CTRL_THRESHOLD) {
      lastCtrlTime = 0;
      handleDoubleCtrl();
    } else {
      lastCtrlTime = now;
    }
  });

  // ── (B) Image Element Resolution ──────────────────────────────────────

  function handleDoubleCtrl() {
    if (overlayEl) return; // Already open

    const imageUrl = resolveImageFromPoint(mouseX, mouseY);
    if (!imageUrl) return;

    openOverlay(imageUrl);
  }

  function resolveImageFromPoint(x, y) {
    // elementsFromPoint returns ALL elements at the coordinate,
    // from topmost to bottommost. This catches images hidden under
    // overlay divs (e.g. Telegram profile photos, WhatsApp image viewers).
    const elements = document.elementsFromPoint(x, y);

    // Collect ALL candidate images from the entire element stack,
    // then pick the best one. This is critical for apps like WhatsApp
    // that nest images very deep and overlay them with control divs.
    const candidates = []; // { url, score, el }
    const seen = new Set();

    for (const el of elements) {
      collectCandidates(el, candidates, seen);
    }

    if (candidates.length === 0) return null;

    // Sort by score descending - highest score wins
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].url;
  }

  function collectCandidates(el, candidates, seen) {
    // 1. Check the element itself
    addCandidate(el, candidates, seen);

    // 2. Check CSS background-image on this element
    addBgCandidate(el, candidates, seen);

    // 3. Search ALL descendant images (handles deep nesting)
    const imgs = el.querySelectorAll('img, picture, svg');
    for (const child of imgs) {
      addCandidate(child, candidates, seen);
    }
  }

  function addCandidate(el, candidates, seen) {
    const url = extractUrl(el);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const naturalArea = (el.naturalWidth || 0) * (el.naturalHeight || 0);

    // Score: prefer blob URLs (full-res) > http > data (previews)
    // Also factor in display size and natural size
    let score = 0;

    // URL type scoring - blob URLs are almost always the full-res image
    if (url.startsWith('blob:')) score += 10000;
    else if (url.startsWith('http')) score += 5000;
    else if (url.startsWith('data:')) score += 1000;

    // Natural image dimensions (if available) - bigger = better
    score += Math.min(naturalArea / 100, 5000);

    // Display area - bigger displayed images are more likely the target
    score += Math.min(area / 10, 3000);

    candidates.push({ url, score, el });
  }

  function addBgCandidate(el, candidates, seen) {
    // Check CSS background-image
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return;

    const match = bg.match(/url\(["']?(.+?)["']?\)/);
    if (!match) return;

    const url = match[1];
    if (seen.has(url)) return;
    seen.add(url);

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_IMAGE_SIZE || rect.height < MIN_IMAGE_SIZE) return;

    const area = rect.width * rect.height;
    let score = 0;

    if (url.startsWith('blob:')) score += 10000;
    else if (url.startsWith('http')) score += 5000;
    else if (url.startsWith('data:')) score += 1000;

    score += Math.min(area / 10, 3000);

    candidates.push({ url, score, el });
  }

  function extractUrl(el) {
    const tag = el.tagName;

    if (tag === 'IMG') {
      if (isImageTooSmall(el)) return null;
      return getBestSrcFromImg(el) || el.src || el.dataset.src || el.dataset.lazySrc || el.dataset.original || null;
    }

    if (tag === 'PICTURE') {
      return getBestSrcFromPicture(el);
    }

    if (tag === 'SOURCE') {
      return parseSrcset(el.srcset) || el.src || null;
    }

    if (tag === 'svg' || el instanceof SVGElement) {
      if (isImageTooSmall(el)) return null;
      return svgToDataUrl(el.closest('svg') || el);
    }

    return null;
  }

  function isImageTooSmall(el) {
    const rect = el.getBoundingClientRect();
    return rect.width < MIN_IMAGE_SIZE || rect.height < MIN_IMAGE_SIZE;
  }

  function parseSrcset(srcset) {
    if (!srcset) return null;

    const candidates = srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      const url = parts[0];
      const descriptor = parts[1] || '1x';
      const value = parseFloat(descriptor);
      return { url, value: isNaN(value) ? 1 : value };
    });

    candidates.sort((a, b) => b.value - a.value);
    return candidates[0]?.url || null;
  }

  function getBestSrcFromImg(img) {
    return parseSrcset(img.srcset);
  }

  function getBestSrcFromPicture(picture) {
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      const url = parseSrcset(source.srcset) || source.src;
      if (url) return url;
    }
    const img = picture.querySelector('img');
    if (img) {
      if (isImageTooSmall(img)) return null;
      return getBestSrcFromImg(img) || img.src || img.dataset.src;
    }
    return null;
  }

  function svgToDataUrl(svgEl) {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  }

  // ── (C) Overlay Manager ───────────────────────────────────────────────

  function openOverlay(imageUrl) {
    if (overlayEl) return;

    currentImageUrl = imageUrl;
    currentZoom = 1;
    panX = 0;
    panY = 0;

    overlayEl = buildOverlayDOM(imageUrl);
    document.body.appendChild(overlayEl);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Trigger entrance animation
    requestAnimationFrame(() => {
      overlayEl.classList.add('dblctrl-visible');
    });
  }

  function closeOverlay() {
    if (!overlayEl) return;

    const el = overlayEl;
    el.classList.remove('dblctrl-visible');

    el.addEventListener('transitionend', () => {
      el.remove();
    }, { once: true });

    // Fallback if transitionend doesn't fire
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 300);

    overlayEl = null;
    currentImageUrl = null;
    document.body.style.overflow = '';
  }

  function buildOverlayDOM(imageUrl) {
    const overlay = document.createElement('div');
    overlay.id = 'dblctrl-overlay';

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'dblctrl-backdrop';
    backdrop.addEventListener('click', closeOverlay);
    overlay.appendChild(backdrop);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.id = 'dblctrl-toolbar';

    // Zoom controls
    const zoomControls = document.createElement('div');
    zoomControls.id = 'dblctrl-zoom-controls';

    const zoomOut = document.createElement('button');
    zoomOut.id = 'dblctrl-zoom-out';
    zoomOut.title = 'Zoom out';
    zoomOut.textContent = '\u2212'; // minus sign
    zoomOut.addEventListener('click', () => stepZoom(-1));

    const zoomLevel = document.createElement('span');
    zoomLevel.id = 'dblctrl-zoom-level';
    zoomLevel.textContent = '1.0x';

    const zoomIn = document.createElement('button');
    zoomIn.id = 'dblctrl-zoom-in';
    zoomIn.title = 'Zoom in';
    zoomIn.textContent = '+';
    zoomIn.addEventListener('click', () => stepZoom(1));

    zoomControls.append(zoomOut, zoomLevel, zoomIn);

    // Separator
    const sep = document.createElement('div');
    sep.className = 'dblctrl-separator';

    // Action buttons
    const actions = document.createElement('div');
    actions.id = 'dblctrl-actions';

    const copyBtn = document.createElement('button');
    copyBtn.id = 'dblctrl-copy';
    copyBtn.title = 'Copy image';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.addEventListener('click', () => copyImageToClipboard(currentImageUrl));

    const saveBtn = document.createElement('button');
    saveBtn.id = 'dblctrl-save';
    saveBtn.title = 'Save image';
    saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
    saveBtn.addEventListener('click', () => saveImage(currentImageUrl));

    const closeBtn = document.createElement('button');
    closeBtn.id = 'dblctrl-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('click', closeOverlay);

    actions.append(copyBtn, saveBtn, closeBtn);

    toolbar.append(zoomControls, sep, actions);
    overlay.appendChild(toolbar);

    // Image wrapper
    const wrapper = document.createElement('div');
    wrapper.id = 'dblctrl-image-wrapper';

    const img = document.createElement('img');
    img.id = 'dblctrl-image';
    img.src = imageUrl;
    img.draggable = false;
    img.alt = 'Magnified image';

    // Pan via drag
    img.addEventListener('mousedown', onPanStart);

    wrapper.appendChild(img);

    // Wheel zoom on wrapper
    wrapper.addEventListener('wheel', onWheelZoom, { passive: false });

    overlay.appendChild(wrapper);

    return overlay;
  }

  // ── (D) Zoom / Pan Controller ─────────────────────────────────────────

  function stepZoom(direction) {
    const currentIndex = ZOOM_LEVELS.findIndex((z) => z >= currentZoom);
    let nextIndex;
    if (direction > 0) {
      nextIndex = currentIndex === -1
        ? ZOOM_LEVELS.length - 1
        : Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1);
    } else {
      const idx = currentIndex <= 0 ? 1 : currentIndex;
      nextIndex = idx - 1;
    }
    zoomTo(ZOOM_LEVELS[nextIndex]);
  }

  function zoomTo(newZoom) {
    currentZoom = Math.max(0.5, Math.min(8, newZoom));

    if (currentZoom <= 1) {
      panX = 0;
      panY = 0;
    }

    applyTransform();
    updateZoomLabel();
  }

  function onWheelZoom(e) {
    e.preventDefault();

    const delta = -e.deltaY;
    const zoomFactor = 1 + delta * 0.002;
    const newZoom = currentZoom * zoomFactor;

    // Zoom toward cursor position
    const wrapper = overlayEl.querySelector('#dblctrl-image-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;

    const scaleChange = Math.max(0.5, Math.min(8, newZoom)) / currentZoom;
    panX = cursorX - scaleChange * (cursorX - panX);
    panY = cursorY - scaleChange * (cursorY - panY);

    zoomTo(newZoom);
  }

  function onPanStart(e) {
    if (currentZoom <= 1) return;
    e.preventDefault();

    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;

    const img = overlayEl.querySelector('#dblctrl-image');
    img.style.cursor = 'grabbing';
    img.classList.add('dblctrl-panning');

    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanEnd);
  }

  function onPanMove(e) {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
  }

  function onPanEnd() {
    if (!isPanning) return;
    isPanning = false;

    if (overlayEl) {
      const img = overlayEl.querySelector('#dblctrl-image');
      if (img) {
        img.style.cursor = currentZoom > 1 ? 'grab' : 'default';
        img.classList.remove('dblctrl-panning');
      }
    }

    document.removeEventListener('mousemove', onPanMove);
    document.removeEventListener('mouseup', onPanEnd);
  }

  function applyTransform() {
    if (!overlayEl) return;
    const img = overlayEl.querySelector('#dblctrl-image');
    if (img) {
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
      img.style.cursor = currentZoom > 1 ? 'grab' : 'default';
    }
  }

  function updateZoomLabel() {
    if (!overlayEl) return;
    const label = overlayEl.querySelector('#dblctrl-zoom-level');
    if (label) {
      label.textContent = currentZoom.toFixed(1) + 'x';
    }
  }

  // ── (E) Copy & Save Actions ───────────────────────────────────────────

  async function copyImageToClipboard(imageUrl) {
    try {
      // First try: use the already-loaded image in the overlay.
      // This works for blob: URLs and CORS-blocked images because
      // the <img> in our overlay has already rendered the pixels.
      const pngBlob = await captureOverlayImage();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]);
      showToast('Copied to clipboard');
    } catch (err1) {
      // Second try: fetch the image directly (works for same-origin)
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const pngBlob = blob.type === 'image/png' ? blob : await blobToPng(blob);
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ]);
        showToast('Copied to clipboard');
      } catch (err2) {
        showToast('Cannot copy \u2014 image blocked by CORS');
      }
    }
  }

  function captureOverlayImage() {
    // Draw the overlay's <img> to a canvas to get a PNG blob.
    // This works even for blob: URLs and cross-origin images
    // because the browser has already decoded the pixels for rendering.
    return new Promise((resolve, reject) => {
      const imgEl = overlayEl?.querySelector('#dblctrl-image');
      if (!imgEl || !imgEl.naturalWidth) {
        reject(new Error('Image not loaded'));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext('2d');

      try {
        ctx.drawImage(imgEl, 0, 0);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('toBlob failed'));
        }, 'image/png');
      } catch (e) {
        // Tainted canvas (CORS) - can't read pixels
        reject(e);
      }
    });
  }

  function blobToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('toBlob failed'));
        }, 'image/png');
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = URL.createObjectURL(blob);
    });
  }

  async function saveImage(imageUrl) {
    if (!imageUrl) return;

    let filename = 'image.png';
    try {
      const urlObj = new URL(imageUrl, window.location.href);
      const pathParts = urlObj.pathname.split('/');
      const last = pathParts[pathParts.length - 1];
      if (last && last.includes('.')) filename = last;
    } catch (e) {
      // keep default
    }

    // blob: URLs can't be downloaded by the background service worker
    // (they belong to the page's JS context). Convert to data URL first.
    if (imageUrl.startsWith('blob:')) {
      try {
        const pngBlob = await captureOverlayImage();
        const dataUrl = await blobToDataUrl(pngBlob);
        filename = filename.replace(/\.[^.]+$/, '.png') || 'image.png';
        chrome.runtime.sendMessage({ action: 'download', url: dataUrl, filename });
        showToast('Downloading\u2026');
      } catch (e) {
        showToast('Cannot save \u2014 image blocked by CORS');
      }
      return;
    }

    const absoluteUrl = imageUrl.startsWith('data:')
      ? imageUrl
      : new URL(imageUrl, window.location.href).href;

    chrome.runtime.sendMessage({
      action: 'download',
      url: absoluteUrl,
      filename: filename
    });

    showToast('Downloading\u2026');
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ── (F) Toast Notification ────────────────────────────────────────────

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'dblctrl-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('dblctrl-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('dblctrl-toast-visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      // Fallback removal
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 300);
    }, 2000);
  }

})();
