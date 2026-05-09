// Shared configuration for the extension.
// Leave optional endpoints blank until production infrastructure is ready.

const CONFIG = {
  BACKEND_BASE: "",
  ADMIN_DASHBOARD_URL: "",
  HEARTBEAT_MINUTES: 1,
  REQUIRED_RULES: [
    "chrome://extensions/",
  ],
  FIREBASE: {
    apiKey: "AIzaSyDR3Q-q1lornS8SjCMBNfcdCr6avx4tBm8",
    authDomain: "eschool-dev-4c6b4.firebaseapp.com",
    projectId: "eschool-dev-4c6b4",
    appId: "1:875648503944:web:3055e97d1026c38d6f0f3d",
    // REST endpoints derived from projectId
    rest: {
      identityToolkit: "https://identitytoolkit.googleapis.com/v1/accounts:signUp", // anonymous sign-in
      firestoreBase: "https://firestore.googleapis.com/v1"
    }
  },
  GA4: {
    measurement_id: "",
    api_secret: ""
  }
};

// Export to global scope (MV3 service worker + options page)
// eslint-disable-next-line no-undef
self.CONFIG = CONFIG;


