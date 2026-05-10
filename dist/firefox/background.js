// Load browser compatibility shim
try { importScripts('browser-compat.js'); } catch(e) {}

// background.js
// Load shared config into the service worker
// Using Firebase REST only for Firestore writes (no SDK loaded)
const MAX_LOGS = 10000;
// Load CONFIG if available (from config.js)
const HEARTBEAT_MINUTES = (self.CONFIG && self.CONFIG.HEARTBEAT_MINUTES) || 1;
const BACKEND_BASE = (self.CONFIG && self.CONFIG.BACKEND_BASE) || "";

function isPlaceholderValue(value) {
  return !value || /your-backend\.com|G-XXXXXXXXXX|ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(String(value));
}

function getConfiguredBackendBase() {
  return isPlaceholderValue(BACKEND_BASE) ? "" : BACKEND_BASE;
}

function withRequiredRules(lines = []) {
  const normalized = Array.isArray(lines)
    ? lines.map(line => String(line || '').trim()).filter(Boolean)
    : [];

  if (self.CONFIG && Array.isArray(self.CONFIG.REQUIRED_RULES)) {
    const set = new Set(normalized);
    self.CONFIG.REQUIRED_RULES.forEach(rule => set.add(rule));
    return Array.from(set);
  }

  return Array.from(new Set(normalized));
}

// Generate or fetch persistent device ID
async function getOrCreateDeviceId() {
  const { deviceId } = await browser.storage.local.get("deviceId");
  if (deviceId) return deviceId;

  const newId = crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  await browser.storage.local.set({ deviceId: newId });
  return newId;
}

/**
 * Send event to GA4 via Measurement Protocol
 * - Requires CONFIG.GA4.measurement_id and CONFIG.GA4.api_secret
 * - Uses deviceId as client_id to identify the device in GA
 */
async function sendToGA(eventName, eventParams = {}) {
  try {
    if (!self.CONFIG || !self.CONFIG.GA4) return false;
    const { measurement_id, api_secret } = self.CONFIG.GA4;
    if (isPlaceholderValue(measurement_id) || isPlaceholderValue(api_secret)) return false;

    // client_id: use deviceId (persistent) or generate fallback
    const deviceId = await getOrCreateDeviceId(); // you already have this helper
    const client_id = deviceId || `${Math.floor(Math.random() * 1e10)}`;

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurement_id)}&api_secret=${encodeURIComponent(api_secret)}`;

    const body = {
      client_id,
      events: [{
        name: eventName,
        params: eventParams
      }]
    };

    // fetch with keepalive so the service worker can send it even when unloading
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    return true;
  } catch (err) {
    console.warn('[LabPolicy] sendToGA failed', err);
    return false;
  }
}



// ==== Firebase direct REST helpers (anonymous auth + write to Firestore) ====
// We obtain an access_token suitable for Firestore by first doing anonymous
// sign-in to get a refresh_token, then exchanging it via STS to an access token.
async function getFirebaseAccessToken() {
  const now = Date.now();
  const { fbToken = null } = await browser.storage.local.get('fbToken');
  if (fbToken && fbToken.access && fbToken.access.expiresAt - 60_000 > now) {
    return fbToken.access.token;
  }
  if (!self.CONFIG || !self.CONFIG.FIREBASE) return null;
  const apiKey = self.CONFIG.FIREBASE.apiKey;
  try {
    let refreshToken = fbToken?.refreshToken;
    if (!refreshToken) {
      // Anonymous sign-in for a fresh refresh token
      const res = await fetch(`${self.CONFIG.FIREBASE.rest.identityToolkit}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      });
      if (!res.ok) return null;
      const json = await res.json();
      refreshToken = json.refreshToken;
    }

    // Exchange refresh token for Google OAuth access token
    const tokenRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });
    if (!tokenRes.ok) return null;
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    const expiresInMs = parseInt(tokenJson.expires_in || '3600', 10) * 1000;
    const record = { refreshToken, access: { token: accessToken, expiresAt: now + expiresInMs } };
    await browser.storage.local.set({ fbToken: record });
    return accessToken;
  } catch (e) {
    return null;
  }
}

async function writeLogToFirestore(payload) {
  if (!self.CONFIG || !self.CONFIG.FIREBASE) return;
  const accessToken = await getFirebaseAccessToken();
  if (!accessToken) return;
  const projectId = self.CONFIG.FIREBASE.projectId;
  const endpoint = `${self.CONFIG.FIREBASE.rest.firestoreBase}/projects/${projectId}/databases/(default)/documents/logs`;
  const doc = {
    fields: {
      url: { stringValue: String(payload.url || '') },
      title: { stringValue: String(payload.title || '') },
      allowed: { booleanValue: !!payload.allowed },
      classCode: { stringValue: String(payload.classCode || '') },
      rollNumber: { stringValue: String(payload.rollNumber || '') },
      pcCode: { stringValue: String(payload.pcCode || '') },
      deviceId: { stringValue: String(payload.deviceId || '') },
      prompt: { stringValue: String(payload.prompt || '') },
      ts: { timestampValue: new Date(payload.ts || Date.now()).toISOString() }
    }
  };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(doc)
    });
    if (!res.ok) {
      console.warn('Firestore write failed', res.status, await res.text());
    }
  } catch (e) {}
}

/**
 * Fetch wishlist from Firestore based on class code
 * Returns array of allowed sites for the class
 */
async function fetchClassWishlist(classCode) {
  if (!classCode) return [];
  
  const accessToken = await getFirebaseAccessToken();
  if (!accessToken || !self.CONFIG || !self.CONFIG.FIREBASE) return [];
  
  try {
    const projectId = self.CONFIG.FIREBASE.projectId;
    // Query the classes collection for the document with the matching code field
    const endpoint = `${self.CONFIG.FIREBASE.rest.firestoreBase}/projects/${projectId}/databases/(default)/documents:runQuery`;

    const queryPayload = {
      structuredQuery: {
        from: [{ collectionId: "classes" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "code" },
            op: "EQUAL",
            value: { stringValue: classCode }
          }
        }
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(queryPayload)
    });

    if (!res.ok) {
      console.warn('[fetchClassWishlist] Firestore query failed', res.status);
      return [];
    }

    const data = await res.json();

    if (data && Array.isArray(data) && data.length > 0) {
      const doc = data[0].document;
      const wishlistField = doc.fields?.wishlist?.arrayValue?.values;
      if (wishlistField && Array.isArray(wishlistField)) {
        const wishlist = wishlistField.map(item => item.stringValue).filter(Boolean);
        console.log('[fetchClassWishlist] Found wishlist for class', classCode, wishlist);
        return wishlist;
      }
    }

    console.log('[fetchClassWishlist] No wishlist found for class', classCode);
    return [];
  } catch (err) {
    console.warn('[fetchClassWishlist] error', err);
    return [];
  }
}

/**
 * Get combined whitelist: local admin whitelist + student's class wishlist from Firestore
 */
async function getCombinedWhitelist() {
  // Get local admin whitelist
  const { whitelist = [] } = await browser.storage.local.get('whitelist');
  let combined = [...whitelist];
  
  // Add required rules
  if (self.CONFIG && Array.isArray(self.CONFIG.REQUIRED_RULES)) {
    combined = [...combined, ...self.CONFIG.REQUIRED_RULES];
  }
  
  // Get student's class code and fetch their class wishlist
  const { studentInfo = {} } = await browser.storage.local.get('studentInfo');
  if (studentInfo.classCode) {
    // Check cache first (valid for 5 minutes)
    const { classWishlistCache } = await browser.storage.local.get('classWishlistCache');
    const now = Date.now();
    
    if (classWishlistCache && 
        classWishlistCache.classCode === studentInfo.classCode && 
        classWishlistCache.timestamp > now - 5 * 60 * 1000) {
      // Use cached wishlist
      console.log('[getCombinedWhitelist] Using cached wishlist');
      combined = [...combined, ...classWishlistCache.wishlist];
    } else {
      // Fetch fresh wishlist from Firestore
      console.log('[getCombinedWhitelist] Fetching wishlist for class:', studentInfo.classCode);
      const classWishlist = await fetchClassWishlist(studentInfo.classCode);
      combined = [...combined, ...classWishlist];
      
      // Cache the result
      await browser.storage.local.set({
        classWishlistCache: {
          classCode: studentInfo.classCode,
          wishlist: classWishlist,
          timestamp: now
        }
      });
    }
  }

  return Array.from(new Set(combined));
}

async function postJSON(path, data) {
  const backendBase = getConfiguredBackendBase();
  if (!backendBase) return false;
  try {
    const res = await fetch(`${backendBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (e) {
    // Swallow network errors; will retry on next alarm
    return false;
  }
}

// On install: register device, set uninstall URL, and start heartbeat alarm
browser.runtime.onInstalled.addListener(async () => {
  console.log('[LabPolicy] service worker installed');
  const id = await getOrCreateDeviceId();
  const backendBase = getConfiguredBackendBase();
  if (backendBase) {
    await postJSON("/install", { id, ts: Date.now() });
  }

  // Set uninstall callback URL
  try {
    if (backendBase) {
      browser.runtime.setUninstallURL(`${backendBase}/uninstalled?id=${encodeURIComponent(id)}`);
    }
  } catch (e) {}

  // Create repeating heartbeat alarm
  browser.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_MINUTES });
});

// On browser startup
browser.runtime.onStartup.addListener(() => {
  console.log('[LabPolicy] service worker startup');
});

// Heartbeat on alarm
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "heartbeat") return;
  const id = await getOrCreateDeviceId();
  const ts = Date.now();
  const ok = await postJSON(`/heartbeat`, { id, ts });
  await browser.storage.local.set({ lastHeartbeat: { ts, ok } });
});

// Message API for options page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message && message.type === "getDeviceStatus") {
      const id = await getOrCreateDeviceId();
      const { lastHeartbeat = null } = await browser.storage.local.get("lastHeartbeat");
      sendResponse({ id, lastHeartbeat });
    } else if (message && message.type === "heartbeatNow") {
      const id = await getOrCreateDeviceId();
      const ts = Date.now();
      const ok = await postJSON(`/heartbeat`, { id, ts });
      await browser.storage.local.set({ lastHeartbeat: { ts, ok } });
      sendResponse({ ok, ts });
    } else if (message && message.type === "refreshWishlist") {
      // Clear cache to force refresh
      await browser.storage.local.remove('classWishlistCache');
      const requestedClassCode = String(message.classCode || '').trim();
      const { studentInfo = {} } = await browser.storage.local.get('studentInfo');
      const classCode = requestedClassCode || studentInfo.classCode || '';

      if (classCode) {
        const wishlist = await fetchClassWishlist(classCode);
        if (!wishlist.length) {
          sendResponse({
            success: false,
            message: `Class code "${classCode}" was not found in Firestore.`,
            classCode
          });
          return;
        }

        await browser.storage.local.set({
          whitelist: withRequiredRules(wishlist),
          classWishlistCache: {
            classCode,
            wishlist,
            timestamp: Date.now()
          }
        });
        sendResponse({ success: true, wishlist, classCode });
      } else {
        sendResponse({ success: false, message: 'No class code set' });
      }
    } else if (message && message.type === "logChatGptPrompt") {
      // Legacy handler — kept for backward compatibility, delegates to logAiPrompt logic
      const prompt = String(message.prompt || '').trim();
      if (!prompt) {
        console.log('[site-blocker] logChatGptPrompt skipped: empty prompt');
        sendResponse({ success: false, message: 'No prompt provided' });
        return;
      }

      console.log('[site-blocker] logChatGptPrompt received', { prompt });
      const deviceId = await getOrCreateDeviceId();
      const { pcCode = '' } = await browser.storage.local.get('pcCode');
      const { studentInfo = {} } = await browser.storage.local.get('studentInfo');

      await writeLogToFirestore({
        url: 'https://chatgpt.com/',
        title: 'ChatGPT Prompt',
        allowed: true,
        classCode: studentInfo.classCode || '',
        rollNumber: studentInfo.rollNumber || '',
        pcCode,
        deviceId,
        prompt,
        ts: Date.now()
      });

      console.log('[site-blocker] logChatGptPrompt Firestore write requested');
      sendResponse({ success: true });
    } else if (message && message.type === "logAiPrompt") {
      // Unified handler for ChatGPT, Microsoft Copilot, Google Gemini
      const prompt = String(message.prompt || '').trim();
      const siteName = String(message.siteName || 'AI Tool').trim();
      const siteUrl = String(message.siteUrl || '').trim();

      if (!prompt) {
        console.log(`[site-blocker] logAiPrompt skipped: empty prompt (${siteName})`);
        sendResponse({ success: false, message: 'No prompt provided' });
        return;
      }

      console.log(`[site-blocker] logAiPrompt received from ${siteName}`, { prompt });
      const deviceId = await getOrCreateDeviceId();
      const { pcCode = '' } = await browser.storage.local.get('pcCode');
      const { studentInfo = {} } = await browser.storage.local.get('studentInfo');

      await writeLogToFirestore({
        url: siteUrl,
        title: `${siteName} Prompt`,
        allowed: true,
        classCode: studentInfo.classCode || '',
        rollNumber: studentInfo.rollNumber || '',
        pcCode,
        deviceId,
        prompt,
        ts: Date.now()
      });

      console.log(`[site-blocker] logAiPrompt Firestore write requested for ${siteName}`);
      sendResponse({ success: true });
    } else {
      sendResponse(undefined);
    }
  })();
  return true; // keep channel open for async reply
});

/**
 * Convert a whitelist pattern into a RegExp for URL matching.
 *
 * Supported pattern forms (in priority order):
 *  1. Subdomain wildcard  *.example.com          — matches example.com and any subdomain
 *  2. URL path wildcard   https://site.com/path/* — * matches any suffix in the path/query
 *  3. Exact domain        example.com             — hostname-only match
 *  4. Plain prefix        https://site.com/page   — URL must start with this string
 *  5. Hostname contains   partial                 — hostname contains the string (legacy fallback)
 */
function patternToRegex(pattern) {
  // Subdomain wildcard: *.example.com
  if (pattern.startsWith("*.")) {
    const base = escapeRegex(pattern.slice(2));
    // Matches the base domain or any subdomain
    return new RegExp(`^https?://([^/]+\\.)?${base}(/|$)`, "i");
  }

  // URL with wildcard(s) in path/query: must contain a protocol and a *
  if (/^https?:\/\//.test(pattern) && pattern.includes("*")) {
    // Split on * and escape each segment, then join with .*
    const regexStr = pattern
      .split("*")
      .map(escapeRegex)
      .join(".*");
    return new RegExp(`^${regexStr}`, "i");
  }

  // Exact domain (no slashes, no protocol)
  if (!pattern.includes("/") && !pattern.includes(":")) {
    const escaped = escapeRegex(pattern);
    return new RegExp(`^https?://(([^/]+\\.)?${escaped})(/|$)`, "i");
  }

  // Plain prefix (full URL starts with pattern)
  return new RegExp(`^${escapeRegex(pattern)}`, "i");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match URL against whitelist patterns
function isAllowed(url, whitelist) {
  try {
    const u = new URL(url);
    for (const rule of whitelist) {
      const pattern = rule.trim();
      if (!pattern) continue;

      try {
        const regex = patternToRegex(pattern);
        if (regex.test(url)) return true;
      } catch (regexErr) {
        // Fallback: legacy plain-string checks
        if (u.hostname === pattern) return true;
        if (url.startsWith(pattern)) return true;
        if (u.hostname.includes(pattern)) return true;
      }
    }
  } catch (e) {
    console.warn("Bad URL:", url);
  }
  return false;
}

// Log visit
async function logVisit(url, title, tabId, allowed) {
  const timestamp = new Date().toISOString();

  try {
    const deviceId = await getOrCreateDeviceId();

    // Read data safely
    const { pcCode = '' } = await browser.storage.local.get('pcCode');
    const { studentInfo = {} } = await browser.storage.local.get('studentInfo');

    // Write to Firestore (existing behavior)
    await writeLogToFirestore({
      url,
      title,
      allowed,
      classCode: studentInfo.classCode || '',
      rollNumber: studentInfo.rollNumber || '',
      pcCode,
      deviceId,
      ts: Date.parse(timestamp)
    });

    // Send to Google Analytics
    await sendToGA('site_visit', {
      page_location: String(url || ''),
      page_title: String(title || ''),
      allowed: Boolean(allowed),
      pc_code: String(pcCode || ''),
      class_code: String(studentInfo.classCode || ''),
      roll_number: String(studentInfo.rollNumber || ''),
      device_id: String(deviceId || ''),
      timestamp
    });

  } catch (e) {
    console.warn('[logVisit] failed', e);
  }
}


// Handle navigation
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // only main-frame

  // Ignore navigation to the extension's own URLs and the new tab page
  if (details.url.startsWith(browser.runtime.getURL('')) || 
      details.url === "about:newtab" ||
      details.url.startsWith("about:") ||
      details.url.startsWith("moz-extension://") ||
      details.url.startsWith("chrome://") ||
      details.url.startsWith("chrome-extension://")) {
    return;
  }

  console.log('[LabPolicy] onBeforeNavigate', details.url);
  const whitelist = await getCombinedWhitelist();
  const allowed = isAllowed(details.url, whitelist);

  if (!allowed) {
    browser.tabs.update(details.tabId, {
      url: browser.runtime.getURL("blocked.html") + "?orig=" + encodeURIComponent(details.url)
    });
  }

  browser.tabs.get(details.tabId, (tab) => {
    const title = tab?.title || "Untitled";
    console.log('[LabPolicy] logging visit', { url: details.url, allowed });
    logVisit(details.url, title, details.tabId, allowed);
  });
});

// Fallback: also listen to tab updates when a page completes loading
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith(browser.runtime.getURL(''))) return;
  if (tab.url.startsWith('chrome://')) return;
  if (tab.url.startsWith('about:')) return;
  if (tab.url.startsWith('moz-extension://')) return;
  try {
    console.log('[LabPolicy] tabs.onUpdated complete', tab.url);
    const whitelist = await getCombinedWhitelist();
    const allowed = isAllowed(tab.url, whitelist);
    if (!allowed) {
      browser.tabs.update(tabId, { url: browser.runtime.getURL('blocked.html') + '?orig=' + encodeURIComponent(tab.url) });
    }
    logVisit(tab.url, tab.title || 'Untitled', tabId, allowed);
  } catch (e) {}
});
