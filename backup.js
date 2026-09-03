/*
  backup.js — export/import the whole vault.

  Honesty note: this export DOES include your actual files/images/videos,
  not just their names. Binary Blobs are converted to base64 so they fit
  inside one JSON file. That means backups of a vault with lots of large
  media can get big (base64 is ~33% larger than the original file) and may
  take a moment to build. For most personal use (notes, screenshots, small
  docs) this is fine and keeps the whole vault in one portable file.

  Format is versioned (`formatVersion`) so a future version of MyVault can
  read old backups and migrate them.
*/

const Backup = (() => {
  const FORMAT_VERSION = 1;

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function dataURLToBlob(dataURL) {
    const res = await fetch(dataURL);
    return res.blob();
  }

  async function exportVault() {
    const [items, categories] = await Promise.all([
      MyVaultDB.getAllItems(),
      MyVaultDB.getAllCategories(),
    ]);

    const exportedItems = [];
    for (const item of items) {
      const copy = { ...item };
      if (copy.fileBlob instanceof Blob) {
        copy.fileDataURL = await blobToDataURL(copy.fileBlob);
        copy.fileMime = copy.fileBlob.type;
        delete copy.fileBlob;
      }
      exportedItems.push(copy);
    }

    const payload = {
      app: "MyVault",
      formatVersion: FORMAT_VERSION,
      exportedAt: Date.now(),
      categories,
      items: exportedItems,
    };

    return payload;
  }

  async function downloadExport() {
    const payload = await exportVault();
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `myvault-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return blob.size;
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object") return "This file isn't valid JSON.";
    if (payload.app !== "MyVault") return "This doesn't look like a MyVault backup file.";
    if (!Array.isArray(payload.items) || !Array.isArray(payload.categories)) {
      return "This backup file is missing vault data and may be corrupted.";
    }
    if (payload.formatVersion > FORMAT_VERSION) {
      return "This backup was made with a newer version of MyVault. Please update the app first.";
    }
    return null;
  }

  async function importFromFile(file) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      throw new Error("Couldn't read that file. It may be corrupted.");
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error("This file isn't valid JSON \u2014 it may be corrupted or not a MyVault backup.");
    }

    const err = validatePayload(payload);
    if (err) throw new Error(err);

    const restoredItems = [];
    for (const item of payload.items) {
      const copy = { ...item };
      if (copy.fileDataURL) {
        try {
          copy.fileBlob = await dataURLToBlob(copy.fileDataURL);
        } catch (e) {
          // Keep the item's metadata even if the binary failed to decode,
          // rather than silently losing the whole record.
          copy.fileRestoreError = true;
        }
        delete copy.fileDataURL;
      }
      restoredItems.push(copy);
    }

    await MyVaultDB.replaceAll(restoredItems, payload.categories);
    return { itemCount: restoredItems.length, categoryCount: payload.categories.length };
  }

  return { exportVault, downloadExport, importFromFile };
})();
