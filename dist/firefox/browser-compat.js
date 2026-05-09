/**
 * browser-compat.js
 * Cross-browser compatibility shim.
 * Makes `chrome.*` APIs work in Firefox (which uses `browser.*`)
 * and ensures `browser.*` works in Chrome (which uses `chrome.*`).
 *
 * Include this as the FIRST script in background and content scripts.
 */

(function () {
  // If running in Firefox, `browser` is defined but `chrome` may not be.
  // If running in Chrome, `chrome` is defined but `browser` may not be.
  if (typeof globalThis !== 'undefined') {
    if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
      // Chrome: expose `browser` as an alias for `chrome`
      globalThis.browser = globalThis.chrome;
    } else if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
      // Firefox: expose `chrome` as an alias for `browser`
      globalThis.chrome = globalThis.browser;
    }
  } else {
    // Service worker / older environments
    if (typeof self !== 'undefined') {
      if (typeof self.browser === 'undefined' && typeof self.chrome !== 'undefined') {
        self.browser = self.chrome;
      } else if (typeof self.chrome === 'undefined' && typeof self.browser !== 'undefined') {
        self.chrome = self.browser;
      }
    }
  }
})();
