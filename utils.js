/*
  utils.js — small shared helpers.

  Small preferences (theme, app-lock settings, last active tab) are kept in
  localStorage on purpose: they're tiny strings, read constantly on boot,
  and don't need IndexedDB's async overhead. Vault content never lives here.
*/

const Utils = (() => {
  function uid() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function now() {
    return Date.now();
  }

  function formatDate(ts, opts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, opts || { month: "short", day: "numeric" });
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function relativeTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return formatDate(ts, { month: "short", day: "numeric", year: "numeric" });
  }

  function daysUntil(ts) {
    if (!ts) return null;
    const target = new Date(ts);
    const today = new Date();
    target.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function humanFileSize(bytes) {
    if (bytes == null) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  // ---- localStorage prefs (small values only) ----
  const PREF_KEY = "myvault_prefs_v1";

  function getPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function setPref(key, value) {
    const p = getPrefs();
    p[key] = value;
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  }

  function getPref(key, fallback) {
    const p = getPrefs();
    return key in p ? p[key] : fallback;
  }

  // ---- toast ----
  let toastTimer = null;
  function toast(message, type = "default") {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = "toast";
    }, 2600);
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  return {
    uid,
    now,
    formatDate,
    formatDateTime,
    relativeTime,
    daysUntil,
    debounce,
    escapeHtml,
    fileToDataURL,
    humanFileSize,
    getPrefs,
    setPref,
    getPref,
    toast,
    isValidUrl,
  };
})();
