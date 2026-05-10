/**
 * build-firefox.js
 * Builds a Firefox-compatible version of the extension into dist/firefox/
 *
 * Run with: node scripts/build-firefox.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'firefox');

// Files to copy as-is
const FILES_TO_COPY = [
  'background.js',
  'browser-compat.js',
  'blocked.html',
  'blocked.js',
  'content.js',
  'content.css',
  'options.html',
  'options.js',
  'auth.js',
  'utils.js',
  'config.js',
];

// Directories to copy recursively
const DIRS_TO_COPY = ['icons', 'vendor'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`  Copied: ${path.relative(ROOT, dest)}`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

console.log('Building Firefox extension...\n');
ensureDir(DIST);

// Copy files
for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(DIST, file));
  } else {
    console.warn(`  WARNING: ${file} not found, skipping`);
  }
}

// Copy directories
for (const dir of DIRS_TO_COPY) {
  copyDir(path.join(ROOT, dir), path.join(DIST, dir));
}

// Use Firefox manifest
copyFile(path.join(ROOT, 'manifest.firefox.json'), path.join(DIST, 'manifest.json'));

// Patch background.js for Firefox:
// 1. Remove importScripts('config.js') — config.js is listed in manifest scripts array
// 2. Replace chrome:// URLs with about: equivalents
// 3. Remove keepalive:true from fetch calls (not supported in Firefox)
const bgPath = path.join(DIST, 'background.js');
let bg = fs.readFileSync(bgPath, 'utf8');

// Remove importScripts line (config is loaded via manifest scripts array in FF)
bg = bg.replace(/try\s*\{\s*importScripts\('config\.js'\);\s*\}\s*catch\s*\(e\)\s*\{\s*\}\s*\n?/g, '');

// Remove keepalive: true from fetch options (Firefox doesn't support it in background)
bg = bg.replace(/,?\s*keepalive:\s*true/g, '');

// Replace chrome:// URLs with about: equivalents
bg = bg.replace(/chrome:\/\/new-tab-page-third-party\//g, 'about:newtab');

// Replace all chrome. API calls with browser. in background.js
bg = bg.replace(/\bchrome\.(storage|runtime|tabs|alarms|webNavigation)\b/g, 'browser.$1');

// Add browser-compat shim import at top
bg = `// Load browser compatibility shim\ntry { importScripts('browser-compat.js'); } catch(e) {}\n\n` + bg;

fs.writeFileSync(bgPath, bg);
console.log('  Patched: background.js (Firefox compatibility)');

// Patch options.js for Firefox: replace chrome. with browser. API calls
const optionsPath = path.join(DIST, 'options.js');
let optionsJs = fs.readFileSync(optionsPath, 'utf8');
optionsJs = optionsJs.replace(/\bchrome\.(storage|runtime|tabs|alarms|webNavigation)\b/g, 'browser.$1');
fs.writeFileSync(optionsPath, optionsJs);
console.log('  Patched: options.js (replaced chrome. with browser.)');

// Patch content.js for Firefox
const contentPath = path.join(DIST, 'content.js');
let content = fs.readFileSync(contentPath, 'utf8');
content = content.replace(/chrome:\/\//g, 'about:');
content = content.replace(/\bchrome\.(storage|runtime|tabs)\b/g, 'browser.$1');
fs.writeFileSync(contentPath, content);
console.log('  Patched: content.js (Firefox compatibility)');

console.log(`\nFirefox extension built successfully at: dist/firefox/`);
console.log('\nTo load in Firefox:');
console.log('  1. Open about:debugging');
console.log('  2. Click "This Firefox"');
console.log('  3. Click "Load Temporary Add-on"');
console.log('  4. Select dist/firefox/manifest.json');
console.log('\nTo load in Firefox Android:');
console.log('  1. Enable USB debugging on your phone');
console.log('  2. Open about:debugging on desktop Firefox');
console.log('  3. Connect your Android device');
console.log('  4. Click your device name and load the add-on');
