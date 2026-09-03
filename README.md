# MyVault — Your Personal Digital Second Brain

A private, offline-first, mobile-first PWA. Plain HTML/CSS/JavaScript — no build step, no framework.

## What actually works right now

- **Storage:** IndexedDB holds every note, task, link, and file (as real binary Blobs — not fake placeholders). Small settings (PIN hash, theme, lock state) live in `localStorage`.
- **Offline:** the app shell (HTML/CSS/JS/icons) is cached by a service worker; your vault data lives in IndexedDB, which already works offline with no service worker needed.
- **Search:** a real ranking search across titles, descriptions, note content, tags, category names, links, and project fields — with filters and sort.
- **Assistant:** retrieval only. It searches your own vault and shows you what it found — it never invents information, and it never calls any external AI service unless you wire one up yourself (see `js/ai.js`, `externalApiHook`).
- **Backup/Restore:** exports one JSON file containing your structured data *and* your actual files (base64-encoded inside the JSON). Restoring replaces the vault with the backup's contents.
- **Trash:** soft-delete with a real 7-day countdown, purged automatically on each app launch.
- **My Apps:** a full personal project log — GitHub/live links, tech used, status, milestones, and attached screenshots/notes/files.
- **PIN lock:** a real hashed PIN (SHA-256, salted) gates the app.
- **Biometric unlock:** uses the real WebAuthn API to trigger your device's own Face ID/fingerprint/Windows Hello prompt. Read the honesty note in `js/auth.js` — since there's no backend server, this is a best-effort local convenience layer, not a full server-verified WebAuthn login. Treat your PIN as the real backstop.

## What needs your own setup (optional)

**Google sign-in** requires your own free Firebase project — this app ships without one, so it runs in "local-only mode" by default (fully functional).

1. Create a project at https://console.firebase.google.com
2. Enable **Google** under Authentication → Sign-in method
3. Copy `js/firebase-config.example.js` to `js/firebase-config.js` and paste in your project's config
4. Add `<script src="js/firebase-config.js"></script>` just before the other `<script>` tags in `index.html`
5. Reload — Settings → Account will now offer "Continue with Google"

Even with Google sign-in on, Firebase is used **only** for the sign-in screen — your vault content is never uploaded to it.

## Deploying

This is static files — deploy anywhere that serves static sites:

- **Netlify:** drag the whole folder onto https://app.netlify.com/drop
- **GitHub Pages:** push this folder to a repo, enable Pages on the `main` branch
- **Vercel:** `vercel deploy` from inside this folder

PWAs require HTTPS to install and use a service worker — both Netlify and GitHub Pages give you that for free.

## Project structure

```
/index.html          — app shell, all views/modals
/css/style.css        — full styling (dark, violet/teal/coral theme)
/js/db.js             — IndexedDB storage engine
/js/auth.js           — PIN lock, biometric gate, optional Firebase
/js/search.js         — ranking search
/js/ai.js             — retrieval-based assistant
/js/backup.js         — export/import
/js/ui.js             — render helpers (cards, rows)
/js/app.js            — state, navigation, event wiring
/js/utils.js          — shared helpers
/manifest.json, /sw.js — PWA config + offline shell caching
/assets/icons/        — generated app icons
```

## Known limitations (by design, not oversight)

- Backups of large media libraries produce large JSON files (base64 adds ~33% overhead). Fine for notes/screenshots/docs; think twice before storing hours of video.
- Biometric unlock is a local convenience, not a server-verified login (see above) — there is no server in this architecture.
- Background push notifications for reminders aren't included: browsers only reliably deliver these through a server-backed push service, which is outside a local-first architecture. Reminders currently surface inside the app (Dashboard, Reminders list) rather than as OS-level notifications.
