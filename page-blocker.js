// This script runs in the PAGE'S world (not the extension's isolated world).
// Declared with "world": "MAIN" in manifest.json, it bypasses CSP restrictions.
//
// It blocks all keyboard events while the overlay is open, and handles
// Escape by directly removing the overlay from the DOM.

(function () {
  'use strict';

  function block(e) {
    var overlay = document.getElementById('dblctrl-overlay');
    var marker = document.getElementById('dblctrl-key-block');

    if (!overlay && !marker) return;

    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();

    if (e.type === 'keydown' && e.key === 'Escape' && overlay) {
      overlay.remove();
      document.body.style.overflow = '';

      var m = document.createElement('div');
      m.id = 'dblctrl-key-block';
      m.style.display = 'none';
      document.body.appendChild(m);
      setTimeout(function () { m.remove(); }, 200);
    }
  }

  // Use window, not document. Capture phase on window is the very first
  // opportunity to intercept — before any document-level listeners.
  window.addEventListener('keydown', block, true);
  window.addEventListener('keyup', block, true);
  window.addEventListener('keypress', block, true);
})();
