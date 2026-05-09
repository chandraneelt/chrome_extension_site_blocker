// =========================
// Constants
// =========================
// Support both Chrome and Firefox (browser.* vs chrome.*)
if (typeof chrome === 'undefined' && typeof browser !== 'undefined') { var chrome = browser; }
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') { var browser = chrome; }

const ADMIN_DASHBOARD_URL = (typeof CONFIG !== 'undefined' && CONFIG.ADMIN_DASHBOARD_URL) ||
                            (typeof self !== 'undefined' && self.CONFIG && self.CONFIG.ADMIN_DASHBOARD_URL) || "";

// =========================
// DOM Utilities
// =========================
function $(id) { return document.getElementById(id); }
function setHidden(el, hidden) { if (el) el.classList[hidden ? 'add' : 'remove']('hidden'); }
function setText(el, text) { if (el) el.textContent = text; }

// =========================
// Helpers
// =========================
function normalizeLines(text) {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

async function loadWhitelistTextarea() {
  const { whitelist = [], classWishlistCache = null, studentInfo = {} } = await chrome.storage.local.get([
    "whitelist",
    "classWishlistCache",
    "studentInfo"
  ]);

  // Always start with the admin-saved whitelist
  const set = new Set(whitelist);

  // Merge class wishlist on top (don't replace)
  const hasFetchedWishlist = classWishlistCache &&
    classWishlistCache.classCode === studentInfo.classCode &&
    Array.isArray(classWishlistCache.wishlist) &&
    classWishlistCache.wishlist.length > 0;

  if (hasFetchedWishlist) {
    classWishlistCache.wishlist.forEach(r => set.add(r));
  }

  if ((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.REQUIRED_RULES))) {
    CONFIG.REQUIRED_RULES.forEach(r => set.add(r));
  } else if (typeof self !== 'undefined' && self.CONFIG && Array.isArray(self.CONFIG.REQUIRED_RULES)) {
    self.CONFIG.REQUIRED_RULES.forEach(r => set.add(r));
  }

  $("whitelist").value = Array.from(set).join("\n");
}

async function loadPcCodeInput() {
  const { pcCode = "" } = await chrome.storage.local.get("pcCode");
  if ($("adminPcCode")) {
    $("adminPcCode").value = pcCode;
  }
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  await initializePassword();
  // Decide which screen to show
  const { setupComplete } = await chrome.storage.local.get("setupComplete");
  if (setupComplete) {
    setHidden($("setupScreen"), true);
    setHidden($("roleScreen"), false);
    setHidden($("loginScreen"), true);
  } else {
    setHidden($("setupScreen"), false);
    setHidden($("roleScreen"), true);
    setHidden($("loginScreen"), true);
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (!document.getElementById("mainScreen") || $("mainScreen").classList.contains("hidden")) return;

  if (changes.whitelist || changes.classWishlistCache || changes.studentInfo) {
    loadWhitelistTextarea();
  }
});

// Initialize default password if not set
async function initializePassword() {
  const { adminPassword } = await chrome.storage.local.get("adminPassword");
  if (!adminPassword) {
    // Legacy default password is removed; keep for migration if needed
  }
}

// Deprecated: session-based auth removed to force login per load
async function checkAuthentication() {
  showLoginScreen();
}

// Show login screen
function showLoginScreen() {
  setHidden($("loginScreen"), false);
  setHidden($("mainScreen"), true);
  $("loginPassword").focus();
}

// Show main settings screen
async function showMainScreen() {
  setHidden($("loginScreen"), true);
  setHidden($("mainScreen"), false);

  await loadWhitelistTextarea();
  await loadPcCodeInput();
  
  // Always show the password section (no longer hiding it)
  showPasswordChangeSection();

  // Load device status
  refreshDeviceStatus();
}

// Login functionality
$("loginBtn").addEventListener("click", async () => {
  const enteredPassword = $("loginPassword").value;
  const { adminPasswordHash, adminSalt } = await chrome.storage.local.get(["adminPasswordHash", "adminSalt"]);
  const ok = await verifyPassword(enteredPassword, adminSalt, adminPasswordHash);
  if (ok) {
    showMainScreen();
    clearLoginForm();
  } else {
    showLoginError("Invalid password. Please try again.");
  }
});

// Allow Enter key to login
$("loginPassword").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    document.getElementById("loginBtn").click();
  }
});

// Logout functionality
$("logoutBtn").addEventListener("click", async () => {
  showRoleScreen();
  clearLoginForm();
});

// Setup screen handler
$("completeSetup").addEventListener("click", async () => {
  const pcCode = $("setupPcCode").value.trim();
  const pw = $("setupPassword").value;
  const pw2 = $("setupConfirm").value;
  if (pcCode.length < 2) return showSetupMessage("Enter a PC code (min 2 chars).", "error");
  if (pw.length < 4) return showSetupMessage("Password must be at least 4 characters.", "error");
  if (pw !== pw2) return showSetupMessage("Passwords do not match.", "error");

  const { salt, digestHex } = await hashPassword(pw);
  await chrome.storage.local.set({ adminPasswordHash: digestHex, adminSalt: salt, pcCode, setupComplete: true });
  showSetupMessage("Setup complete!", "success");
  // Directly take admin to whitelist/settings for first-time configuration
  setHidden($("setupScreen"), true);
  showMainScreen();
});

// Role selection
$("roleStudent").addEventListener("click", () => {
  setHidden($("roleScreen"), true);
  setHidden($("studentScreen"), false);
});

$("roleAdmin").addEventListener("click", () => {
  setHidden($("roleScreen"), true);
  showLoginScreen();
});

// Student screen actions
$("backToRoles").addEventListener("click", () => {
  setHidden($("studentScreen"), true);
  setHidden($("roleScreen"), false);
});

$("submitClassCode").addEventListener("click", async () => {
  const code = $("classCode").value.trim();
  const roll = $("rollNumber").value.trim();
  if (!code) return showStudentMessage("Enter class code.", "error");
  if (!roll) return showStudentMessage("Enter roll number.", "error");
  const refreshResponse = await chrome.runtime.sendMessage({ type: "refreshWishlist", classCode: code });
  if (!refreshResponse?.success) {
    return showStudentMessage(refreshResponse?.message || "Class code was not found in Firestore.", "error");
  }
  await chrome.storage.local.set({ studentInfo: { classCode: code, rollNumber: roll } });
  await loadWhitelistTextarea();
  showStudentMessage("Submitted.", "success");
});

$("savePcCode").addEventListener("click", async () => {
  const pcCode = $("adminPcCode").value.trim();
  if (pcCode.length < 2) {
    return showPcCodeMessage("Enter a PC code (min 2 chars).", "error");
  }

  await chrome.storage.local.set({ pcCode });
  showPcCodeMessage("PC code updated successfully.", "success");
  await refreshDeviceStatus();
});

// Toggle password form visibility
$("togglePasswordForm").addEventListener("click", () => {
  const passwordForm = $("passwordForm");
  if (passwordForm.classList.contains("hidden")) {
    showPasswordForm();
  } else {
    hidePasswordForm();
  }
});

// Cancel password change
$("cancelPasswordChange").addEventListener("click", () => {
  hidePasswordForm();
  clearPasswordForm();
});

// Device status buttons
$("heartbeatNow").addEventListener("click", async () => {
  setDeviceMessage("Sending heartbeat…", "success");
  const resp = await chrome.runtime.sendMessage({ type: "heartbeatNow" });
  if (resp && resp.ok) {
    setDeviceMessage("Heartbeat sent successfully.", "success");
  } else {
    setDeviceMessage("Heartbeat failed. Will retry automatically.", "error");
  }
  await refreshDeviceStatus();
});

$("copyDeviceId").addEventListener("click", async () => {
  const { id } = await chrome.runtime.sendMessage({ type: "getDeviceStatus" }) || {};
  if (id) {
    await navigator.clipboard.writeText(id);
    setDeviceMessage("Device ID copied to clipboard.", "success");
  }
});

// Open admin dashboard (hosted page you provide)
$("openAdmin").addEventListener("click", async () => {
  const adminUrl = ADMIN_DASHBOARD_URL;
  if (!adminUrl || /your-backend\.com/.test(adminUrl)) {
    showPcCodeMessage("Set CONFIG.ADMIN_DASHBOARD_URL before using the admin dashboard.", "error");
    return;
  }

  const { id } = await chrome.runtime.sendMessage({ type: "getDeviceStatus" }) || {};
  const url = id ? `${adminUrl}?id=${encodeURIComponent(id)}` : adminUrl;
  window.open(url, "_blank");
});

// Change password functionality
$("changePasswordBtn").addEventListener("click", async () => {
  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;

  const { adminPasswordHash, adminSalt } = await chrome.storage.local.get(["adminPasswordHash", "adminSalt"]);
  const ok = await verifyPassword(currentPassword, adminSalt, adminPasswordHash);
  if (!ok) {
    showPasswordMessage("Current password is incorrect.", "error");
    return;
  }
  
  if (newPassword.length < 4) {
    showPasswordMessage("New password must be at least 4 characters long.", "error");
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showPasswordMessage("New passwords do not match.", "error");
    return;
  }
  
  const { salt, digestHex } = await hashPassword(newPassword);
  await chrome.storage.local.set({
    adminPasswordHash: digestHex,
    adminSalt: salt,
    passwordChangedFromDefault: true
  });
  
  showPasswordMessage("Password changed successfully!", "success");
  clearPasswordForm();
  
  // Hide password form after successful change
  hidePasswordForm();
});

// Save whitelist
$("save").addEventListener("click", async () => {
  let lines = normalizeLines($("whitelist").value);
  // Ensure required rules are present
  const requiredRules = (typeof CONFIG !== 'undefined' && CONFIG.REQUIRED_RULES) ||
                        (typeof self !== 'undefined' && self.CONFIG && self.CONFIG.REQUIRED_RULES) || [];
  if (Array.isArray(requiredRules) && requiredRules.length) {
    const set = new Set(lines);
    requiredRules.forEach(r => set.add(r));
    lines = Array.from(set);
  }

  await chrome.storage.local.set({ whitelist: lines });
  await loadWhitelistTextarea();
  
  if (lines.length === 0) {
    showWhitelistMessage("⚠️ Whitelist cleared! All websites will be blocked.", "success");
  } else {
    showWhitelistMessage("✅ Whitelist saved successfully! " + lines.length + " rules added.", "success");
  }
});

// Export logs to CSV
$("export").addEventListener("click", async () => {
  const { logs = [] } = await chrome.storage.local.get("logs");

  let csv = "URL,Title,Timestamp,TabID,Allowed\n";
  logs.forEach(log => {
    csv += `"${log.url}","${log.title}","${log.timestamp}",${log.tabId},${log.allowed}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "lab_policy_logs.csv";
  a.click();

  URL.revokeObjectURL(url);
  showWhitelistMessage("📊 Logs exported successfully! File downloaded.", "success");
});

// Helper functions
function showLoginError(message) {
  const errorDiv = $("loginError");
  setText(errorDiv, message);
  setHidden(errorDiv, false);
  setTimeout(() => {
    setHidden(errorDiv, true);
  }, 3000);
}

function showRoleScreen() {
  setHidden($("roleScreen"), false);
  setHidden($("loginScreen"), true);
  setHidden($("mainScreen"), true);
  setHidden($("studentScreen"), true);
}

function showSetupMessage(message, type) {
  const el = $("setupMessage");
  setText(el, message);
  el.className = type === "error" ? "error-message" : "success-message";
  setHidden(el, false);
  setTimeout(() => setHidden(el, true), 3000);
}

function showStudentMessage(message, type) {
  const el = $("studentMessage");
  setText(el, message);
  el.className = type === "error" ? "error-message" : "success-message";
  setHidden(el, false);
  setTimeout(() => setHidden(el, true), 3000);
}

function showPasswordMessage(message, type) {
  const messageDiv = $("passwordMessage");
  setText(messageDiv, message);
  messageDiv.className = type === "error" ? "error-message" : "success-message";
  setHidden(messageDiv, false);
  setTimeout(() => {
    setHidden(messageDiv, true);
  }, 3000);
}

function showWhitelistMessage(message, type) {
  const messageDiv = $("whitelistMessage");
  setText(messageDiv, message);
  messageDiv.className = type === "error" ? "error-message" : "success-message";
  setHidden(messageDiv, false);
  setTimeout(() => {
    setHidden(messageDiv, true);
  }, 4000); // Show a bit longer for whitelist messages
}

function showPcCodeMessage(message, type) {
  const el = $("pcCodeMessage");
  setText(el, message);
  el.className = type === "error" ? "error-message" : "success-message";
  setHidden(el, false);
  setTimeout(() => setHidden(el, true), 3000);
}

async function refreshDeviceStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "getDeviceStatus" });
    const idEl = $("deviceId");
    const hbEl = $("lastHeartbeat");
    if (resp) {
      if (idEl) setText(idEl, resp.id || "unknown");
      if (hbEl) {
        if (resp.lastHeartbeat && resp.lastHeartbeat.ts) {
          const d = new Date(resp.lastHeartbeat.ts);
          const ok = resp.lastHeartbeat.ok ? "OK" : "Failed";
          setText(hbEl, `${d.toLocaleString()} (${ok})`);
        } else {
          setText(hbEl, "no data yet");
        }
      }
    }
  } catch (e) {}
}

function setDeviceMessage(message, type) {
  const el = $("deviceMessage");
  setText(el, message);
  el.className = type === "error" ? "error-message" : "success-message";
  setHidden(el, false);
  setTimeout(() => setHidden(el, true), 3000);
}

function clearLoginForm() {
  $("loginPassword").value = "";
  setHidden($("loginError"), true);
}

function clearPasswordForm() {
  $("currentPassword").value = "";
  $("newPassword").value = "";
  $("confirmPassword").value = "";
}

// Show the password change section (always visible now)
function showPasswordChangeSection() {
  const passwordSection = document.querySelector(".password-section");
  if (passwordSection) {
    setHidden(passwordSection, false);
  }
}

// Show the password form
function showPasswordForm() {
  const passwordForm = $("passwordForm");
  if (passwordForm) {
    setHidden(passwordForm, false);
    $("currentPassword").focus();
  }
}

// Hide the password form
function hidePasswordForm() {
  const passwordForm = $("passwordForm");
  if (passwordForm) {
    setHidden(passwordForm, true);
  }
}
