// Simple DOM and common helpers shared across the extension

// DOM helpers
function $(id) { return document.getElementById(id); }
function setHidden(el, hidden) { if (el) el.classList[hidden ? 'add' : 'remove']('hidden'); }
function setText(el, text) { if (el) el.textContent = text; }

// Data helpers
function normalizeLines(text) {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// Export to global scope
// eslint-disable-next-line no-undef
self.$ = $;
// eslint-disable-next-line no-undef
self.setHidden = setHidden;
// eslint-disable-next-line no-undef
self.setText = setText;
// eslint-disable-next-line no-undef
self.normalizeLines = normalizeLines;


