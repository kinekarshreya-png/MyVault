/*
  auth.js — MyVault access control.

  Two independent layers, both optional but recommended together:

  1) Google sign-in via Firebase Authentication.
     This requires a real Firebase project (API key, auth domain, etc).
     Since this app ships without your own Firebase project, Google
     sign-in is OFF by default and the app runs in "local-only mode".
     Fill in `FIREBASE_CONFIG` below with your project's config
     (see js/firebase-config.example.js) to turn it on — see the README.

  2) MyVault App Lock: a local PIN, optionally backed by your device's
     biometric/passkey hardware via the WebAuthn API.

     Important honesty note: ordinary JavaScript CANNOT read a phone's
     fingerprint sensor directly — no website can. What WebAuthn actually
     does is ask the OS to show its own Face ID / fingerprint / Windows
     Hello prompt, and hand back a signed credential if it succeeds.
     Verifying that signature properly requires a server (a "relying
     party"). Because MyVault has no backend, this app uses WebAuthn in a
     best-effort "local gate" mode: it asks your device to run its native
     biometric check, and only unlocks the vault if the device reports
     success. This is convenient, but it is not equivalent to a
     server-verified WebAuthn login — treat your PIN as the real backstop.
*/

const Auth = (() => {
  const LOCK_PREF = "appLock"; // { pinHash, salt, biometricCredId, enabled }
  let sessionUnlocked = false;
  let firebaseUser = null;
  let firebaseReady = false;

  // ---------------- Firebase (optional Google sign-in) ----------------

  async function initFirebase() {
    if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) {
      firebaseReady = false;
      return false;
    }
    try {
      // Firebase is loaded lazily only if a config is actually present,
      // so the app never depends on network access for normal use.
      await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
      ).then((m) => {
        window.__fbApp = m.initializeApp(window.FIREBASE_CONFIG);
      });
      const authMod = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
      );
      window.__fbAuth = authMod.getAuth(window.__fbApp);
      window.__fbAuthMod = authMod;
      authMod.onAuthStateChanged(window.__fbAuth, (user) => {
        firebaseUser = user;
        document.dispatchEvent(new CustomEvent("myvault:authchange", { detail: user }));
      });
      firebaseReady = true;
      return true;
    } catch (e) {
      console.warn("Firebase not available:", e);
      firebaseReady = false;
      return false;
    }
  }

  async function googleSignIn() {
    if (!firebaseReady) {
      Utils.toast("Google sign-in isn't configured yet. See Settings → Account.");
      return null;
    }
    const provider = new window.__fbAuthMod.GoogleAuthProvider();
    const result = await window.__fbAuthMod.signInWithPopup(window.__fbAuth, provider);
    return result.user;
  }

  async function signOutFirebase() {
    if (firebaseReady && window.__fbAuth) {
      await window.__fbAuthMod.signOut(window.__fbAuth);
    }
    firebaseUser = null;
  }

  function isGoogleConfigured() {
    return firebaseReady;
  }

  function getFirebaseUser() {
    return firebaseUser;
  }

  // ---------------- PIN lock ----------------

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function getLockConfig() {
    return Utils.getPref(LOCK_PREF, { enabled: false });
  }

  function isLockEnabled() {
    return !!getLockConfig().enabled;
  }

  async function setPin(pin) {
    const salt = Utils.uid();
    const pinHash = await sha256Hex(salt + ":" + pin);
    const cfg = { ...getLockConfig(), enabled: true, pinHash, salt };
    Utils.setPref(LOCK_PREF, cfg);
    return true;
  }

  async function verifyPin(pin) {
    const cfg = getLockConfig();
    if (!cfg.pinHash) return false;
    const hash = await sha256Hex(cfg.salt + ":" + pin);
    return hash === cfg.pinHash;
  }

  function disableLock() {
    Utils.setPref(LOCK_PREF, { enabled: false });
  }

  function isUnlocked() {
    return !isLockEnabled() || sessionUnlocked;
  }

  function unlockSession() {
    sessionUnlocked = true;
  }

  function lockSession() {
    sessionUnlocked = false;
  }

  // ---------------- WebAuthn biometric gate (best-effort, see note above) ----------------

  function webAuthnSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  async function registerBiometric() {
    if (!webAuthnSupported()) {
      Utils.toast("This device/browser doesn't support platform biometrics.");
      return false;
    }
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        Utils.toast("No fingerprint/Face ID hardware detected on this device.");
        return false;
      }
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "MyVault" },
          user: { id: userId, name: "myvault-user", displayName: "MyVault User" },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60000,
        },
      });
      const cfg = getLockConfig();
      cfg.biometricCredId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      Utils.setPref(LOCK_PREF, cfg);
      return true;
    } catch (e) {
      console.warn(e);
      Utils.toast("Biometric setup was cancelled or failed.");
      return false;
    }
  }

  function hasBiometric() {
    return !!getLockConfig().biometricCredId;
  }

  async function verifyBiometric() {
    const cfg = getLockConfig();
    if (!cfg.biometricCredId) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const rawId = Uint8Array.from(atob(cfg.biometricCredId), (c) => c.charCodeAt(0));
      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: rawId, type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      return true; // browser only resolves this if the device's own check passed
    } catch (e) {
      console.warn(e);
      return false;
    }
  }

  function clearBiometric() {
    const cfg = getLockConfig();
    delete cfg.biometricCredId;
    Utils.setPref(LOCK_PREF, cfg);
  }

  return {
    initFirebase,
    googleSignIn,
    signOutFirebase,
    isGoogleConfigured,
    getFirebaseUser,
    isLockEnabled,
    setPin,
    verifyPin,
    disableLock,
    isUnlocked,
    unlockSession,
    lockSession,
    webAuthnSupported,
    registerBiometric,
    hasBiometric,
    verifyBiometric,
    clearBiometric,
  };
})();
