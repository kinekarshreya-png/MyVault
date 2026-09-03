/*
  OPTIONAL — Google sign-in via Firebase Authentication.

  MyVault works fully without this file (local-only mode with PIN/biometric
  lock). If you want Google sign-in as an extra front door:

  1. Go to https://console.firebase.google.com and create a free project.
  2. In Build → Authentication → Sign-in method, enable "Google".
  3. In Project settings → General, add a Web app and copy its config.
  4. Copy this file to js/firebase-config.js (same folder) and paste your
     real values below.
  5. Reload MyVault — Settings → Account will show a "Sign in with Google"
     button.

  MyVault never sends your vault content anywhere — Firebase here is used
  ONLY for the sign-in screen, never for storing notes/files/tasks.
*/

window.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
