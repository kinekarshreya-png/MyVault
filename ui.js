/*
  ui.js — pure(ish) rendering helpers. These build HTML strings/DOM from
  vault data; app.js owns state, events, and calls into these.
*/

const UI = (() => {
  const TYPE_ICON = {
    note: "📝", task: "✅", link: "🔗", image: "🖼️",
    video: "🎬", file: "📎", document: "📄", reminder: "🔔", myapp: "🚀",
  };
  const TYPE_LABEL = {
    note: "Note", task: "Task", link: "Link", image: "Image",
    video: "Video", file: "File", document: "Document", reminder: "Reminder", myapp: "App",
  };

  function catById(categories, id) {
    return categories.find((c) => c.id === id);
  }

  function catDot(color) {
    return `<span class="item-cat-dot" style="background:${color || "#676D91"}"></span>`;
  }

  // ---------------- Item card ----------------
  function itemCard(item, categories) {
    const cat = catById(categories, item.categoryId);
    const icon = TYPE_ICON[item.type] || "📦";
    let thumb = "";
    if (item.type === "image") {
      const urls = Array.isArray(item._imageUrls) ? item._imageUrls : (item._blobUrl ? [item._blobUrl] : []);
      if (urls.length) thumb = `<div class="item-thumb-wrap"><img class="item-thumb" src="${urls[0]}" alt="" />${urls.length > 1 ? `<span class="image-count-badge">${urls.length}</span>` : ""}</div>`;
    }
    const flags = [];
    if (item.important) flags.push('<span class="flag-icon">💠</span>');

    let snippet = "";
    if (item.type === "note") snippet = item.content || "";
    else if (item.type === "link") snippet = item.url || "";
    else snippet = item.description || "";

    const metaBits = [];
    if (cat) metaBits.push(`${catDot(cat.color)}${Utils.escapeHtml(cat.name)}`);
    metaBits.push(Utils.relativeTime(item.updatedAt || item.createdAt));

    return `
      <div class="item-card" data-item-id="${item.id}">
        ${thumb || `<div class="type-badge badge-${item.type}">${icon}</div>`}
        <div class="item-body">
          <div class="item-title">${Utils.escapeHtml(item.title || "Untitled")}</div>
          <div class="item-meta">${metaBits.join('<span>&middot;</span>')}</div>
          ${snippet ? `<div class="item-snippet">${Utils.escapeHtml(snippet)}</div>` : ""}
        </div>
        ${flags.length ? `<div class="item-flags">${flags.join("")}</div>` : ""}
      </div>`;
  }

  function taskRow(item) {
    const dueBits = [];
    if (item.dueDate) {
      const d = Utils.daysUntil(item.dueDate);
      let label = Utils.formatDate(item.dueDate);
      if (!item.completed) {
        if (d < 0) label = `Overdue \u00b7 ${label}`;
        else if (d === 0) label = `Due today`;
        else if (d === 1) label = `Due tomorrow`;
      }
      dueBits.push(label);
    }
    return `
      <div class="task-row" data-item-id="${item.id}">
        <button class="task-check ${item.completed ? "checked" : ""}" data-task-toggle="${item.id}">${item.completed ? "✓" : ""}</button>
        <div style="flex:1; min-width:0;">
          <div class="task-title ${item.completed ? "done" : ""}">${Utils.escapeHtml(item.title)}</div>
          ${item.description ? `<div class="task-desc">${Utils.escapeHtml(item.description)}</div>` : ""}
          ${dueBits.length ? `<div class="task-due">${Utils.escapeHtml(dueBits.join(""))}</div>` : ""}
        </div>
      </div>`;
  }

  function reminderRow(item) {
    let range = "";
    if (item.startDate && item.dueDate) {
      range = `${Utils.formatDate(item.startDate)} \u2192 ${Utils.formatDate(item.dueDate)}`;
    } else if (item.reminderAt) {
      range = Utils.formatDateTime(item.reminderAt);
    } else if (item.dueDate) {
      range = Utils.formatDate(item.dueDate);
    }
    return `
      <div class="reminder-row" data-item-id="${item.id}">
        <span class="reminder-bell">🔔</span>
        <div style="flex:1; min-width:0;">
          <div class="reminder-title">${Utils.escapeHtml(item.title)}</div>
          ${range ? `<div class="reminder-range">${Utils.escapeHtml(range)}</div>` : ""}
        </div>
      </div>`;
  }

  function myAppCard(app, categories) {
    const statusClass = app.status === "Active" ? "status-active" : app.status === "Paused" ? "status-paused" : "status-done";
    let media = `<div class="myapp-card-media">🚀</div>`;
    if (app._coverUrl) {
      media = `<div class="myapp-card-media"><img src="${app._coverUrl}" alt=""/></div>`;
    }
    return `
      <div class="myapp-card" data-item-id="${app.id}">
        ${media}
        <div class="myapp-card-body">
          <div class="myapp-card-title">${Utils.escapeHtml(app.title)}</div>
          ${app.techUsed ? `<div class="myapp-card-tech">${Utils.escapeHtml(app.techUsed)}</div>` : ""}
          <span class="status-pill ${statusClass}">${Utils.escapeHtml(app.status || "Active")}</span>
          ${app.description ? `<div class="myapp-card-desc">${Utils.escapeHtml(app.description)}</div>` : ""}
        </div>
      </div>`;
  }

  function emptyState(text) {
    return `<div class="dash-empty">${Utils.escapeHtml(text)}</div>`;
  }

  return {
    TYPE_ICON, TYPE_LABEL, catById, catDot,
    itemCard, taskRow, reminderRow, myAppCard, emptyState,
  };
})();
