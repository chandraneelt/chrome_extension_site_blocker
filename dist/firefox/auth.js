// Authentication helpers: PBKDF2 hashing and verification

async function generateSalt(byteLength = 16) {
  const salt = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...salt));
}

async function pbkdf2Hash(password, saltB64, iterations = 100000, hash = "SHA-256") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash }, key, 256);
  const bytes = new Uint8Array(bits);
  // Return hex string
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 || await generateSalt();
  const digestHex = await pbkdf2Hash(password, salt);
  return { salt, digestHex };
}

async function verifyPassword(password, saltB64, expectedHex) {
  const hex = await pbkdf2Hash(password, saltB64);
  // Constant-time-ish compare
  if (hex.length !== expectedHex.length) return false;
  let ok = 0;
  for (let i = 0; i < hex.length; i++) ok |= hex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return ok === 0;
}

// Expose globally
// eslint-disable-next-line no-undef
self.generateSalt = generateSalt;
// eslint-disable-next-line no-undef
self.hashPassword = hashPassword;
// eslint-disable-next-line no-undef
self.verifyPassword = verifyPassword;


