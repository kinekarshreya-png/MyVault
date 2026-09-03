/*
  db.js — MyVault local storage engine (IndexedDB)

  Why IndexedDB and not localStorage:
  localStorage only stores small strings (~5MB total) and blocks the main
  thread. It cannot reasonably hold images, videos or documents. IndexedDB
  can store binary Blobs, is asynchronous, and scales to much larger
  amounts of data (browser-dependent, but typically hundreds of MB to GB).

  Two object stores:
    - "items"      : notes, files, images, videos, links, documents, tasks,
                      and "myapp" project records. One flexible schema keeps
                      search/tagging/category logic identical across types.
    - "categories" : user-created categories (name, color).

  Small preferences (theme, lock settings, last-view) live in localStorage
  via utils.prefs — this file only owns the vault content itself.
*/

const MyVaultDB = (() => {
  const DB_NAME = "myvault-db";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains("items")) {
          const store = db.createObjectStore("items", { keyPath: "id" });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("categoryId", "categoryId", { unique: false });
          store.createIndex("tags", "tags", { unique: false, multiEntry: true });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("deletedAt", "deletedAt", { unique: false });
          store.createIndex("favorite", "favorite", { unique: false });
          store.createIndex("important", "important", { unique: false });
          store.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
          store.createIndex("dueDate", "dueDate", { unique: false });
        }

        if (!db.objectStoreNames.contains("categories")) {
          const cat = db.createObjectStore("categories", { keyPath: "id" });
          cat.createIndex("name", "name", { unique: false });
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function tx(storeNames, mode) {
    const db = await open();
    return db.transaction(storeNames, mode);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Items ----------

  async function putItem(item) {
    const t = await tx(["items"], "readwrite");
    t.objectStore("items").put(item);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(item);
      t.onerror = () => rej(t.error);
    });
  }

  async function getItem(id) {
    const t = await tx(["items"], "readonly");
    return reqToPromise(t.objectStore("items").get(id));
  }

  async function deleteItemHard(id) {
    const t = await tx(["items"], "readwrite");
    t.objectStore("items").delete(id);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    });
  }

  async function getAllItems() {
    const t = await tx(["items"], "readonly");
    return reqToPromise(t.objectStore("items").getAll());
  }

  // Active = not in trash. Trash = deletedAt is set.
  async function getActiveItems() {
    const all = await getAllItems();
    return all.filter((i) => !i.deletedAt);
  }

  async function getTrashedItems() {
    const all = await getAllItems();
    return all.filter((i) => !!i.deletedAt);
  }

  // ---------- Categories ----------

  async function putCategory(cat) {
    const t = await tx(["categories"], "readwrite");
    t.objectStore("categories").put(cat);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(cat);
      t.onerror = () => rej(t.error);
    });
  }

  async function getAllCategories() {
    const t = await tx(["categories"], "readonly");
    return reqToPromise(t.objectStore("categories").getAll());
  }

  async function deleteCategory(id) {
    const t = await tx(["categories"], "readwrite");
    t.objectStore("categories").delete(id);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    });
  }

  // ---------- Bulk (used by backup/restore) ----------

  async function replaceAll(items, categories) {
    const t = await tx(["items", "categories"], "readwrite");
    t.objectStore("items").clear();
    t.objectStore("categories").clear();
    for (const i of items) t.objectStore("items").put(i);
    for (const c of categories) t.objectStore("categories").put(c);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    });
  }

  async function estimateUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        return await navigator.storage.estimate();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  return {
    putItem,
    getItem,
    deleteItemHard,
    getAllItems,
    getActiveItems,
    getTrashedItems,
    putCategory,
    getAllCategories,
    deleteCategory,
    replaceAll,
    estimateUsage,
  };
})();
