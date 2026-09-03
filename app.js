/*
  app.js — application state, navigation, and event wiring.
  ui.js provides render helpers; this file owns "what happens when".
*/

(() => {
  const state = {
    categories: [],
    items: [],           // active (non-trashed) items, freshly loaded
    trashItems: [],
    view: "home",
    sublistContext: null, // { kind: 'category'|'favorites'|'important'|'reminders'|'trash', catId? }
    taskTab: "today",
    searchQuery: "",
    searchFilter: "all",
    searchSort: "recent-added",
    pendingFormType: null,
    editingItem: null,
    formFileBlob: null,
    formTags: [],
    confirmCb: null,
    blobUrls: [], // tracked object URLs to revoke on refresh
    myAppParentId: null, // when adding media attached to a My Apps project
  };

  const DEFAULT_CATEGORIES = [
    { name: "My Apps", color: "#00D8B8" },
    { name: "College", color: "#7C6CF0" },
    { name: "JavaScript", color: "#FFD166" },
    { name: "Important", color: "#FF6B7A" },
    { name: "Personal", color: "#FF9A6B" },
    { name: "Learning", color: "#5AC8FA" },
    { name: "Ideas", color: "#9297B5" },
  ];

  const SWATCHES = ["#7C6CF0", "#00D8B8", "#FF9A6B", "#5AC8FA", "#FFD166", "#FF6B7A", "#9297B5", "#4ADE80"];

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    await Auth.initFirebase();
    registerServiceWorker();

    const onboarded = Utils.getPref("onboarded", false);
    if (!onboarded) {
      showOnboarding();
      return;
    }
    await enterApp();
  }

  async function enterApp() {
    if (Auth.isLockEnabled() && !Auth.isUnlocked()) {
      showGate();
      return;
    }
    document.getElementById("gate-screen").classList.add("hidden");
    document.getElementById("onboard-screen").classList.add("hidden");
    document.getElementById("app-root").classList.remove("hidden");
    await seedCategoriesIfNeeded();
    await purgeExpiredTrash();
    await refreshData();
    wireGlobalEvents();
    goToView("home");
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {
        // Offline caching just won't be available; core app still works.
      });
    }
  }

  // ---------------------------------------------------------------
  // Onboarding
  // ---------------------------------------------------------------
  function showOnboarding() {
    document.getElementById("onboard-screen").classList.remove("hidden");
    if (Auth.isGoogleConfigured()) {
      document.getElementById("onboard-google-note").classList.add("hidden");
    }
    document.getElementById("onboard-google-btn").onclick = async () => {
      const user = await Auth.googleSignIn();
      if (user) finishOnboarding();
    };
    document.getElementById("onboard-local-btn").onclick = finishOnboarding;
  }

  function finishOnboarding() {
    Utils.setPref("onboarded", true);
    document.getElementById("onboard-screen").classList.add("hidden");
    enterApp();
  }

  // ---------------------------------------------------------------
  // PIN Gate
  // ---------------------------------------------------------------
  let gatePin = "";
  function showGate() {
    const gate = document.getElementById("gate-screen");
    gate.classList.remove("hidden");
    gatePin = "";
    renderPinDots();
    document.getElementById("gate-error").textContent = "";

    const hasBio = Auth.hasBiometric() && Auth.webAuthnSupported();
    document.getElementById("gate-biometric-btn").style.visibility = hasBio ? "visible" : "hidden";

    document.getElementById("gate-keypad").onclick = async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "gate-back") {
        gatePin = gatePin.slice(0, -1);
        renderPinDots();
        return;
      }
      if (btn.id === "gate-biometric-btn") {
        const ok = await Auth.verifyBiometric();
        if (ok) unlockAndEnter();
        else document.getElementById("gate-error").textContent = "Biometric check didn't succeed.";
        return;
      }
      if (btn.dataset.k != null) {
        gatePin += btn.dataset.k;
        renderPinDots();
        if (gatePin.length === 4) {
          const ok = await Auth.verifyPin(gatePin);
          if (ok) {
            unlockAndEnter();
          } else {
            document.getElementById("gate-error").textContent = "Incorrect PIN. Try again.";
            gatePin = "";
            renderPinDots();
          }
        }
      }
    };

    if (hasBio) {
      Auth.verifyBiometric().then((ok) => {
        if (ok) unlockAndEnter();
      });
    }
  }

  function unlockAndEnter() {
    Auth.unlockSession();
    document.getElementById("gate-screen").classList.add("hidden");
    enterApp();
  }

  function renderPinDots() {
    const dots = document.querySelectorAll("#gate-pin-dots span");
    dots.forEach((d, i) => d.classList.toggle("filled", i < gatePin.length));
  }

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------
  async function seedCategoriesIfNeeded() {
    const cats = await MyVaultDB.getAllCategories();
    if (cats.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await MyVaultDB.putCategory({ id: Utils.uid(), name: c.name, color: c.color, createdAt: Utils.now() });
      }
    }
  }

  async function purgeExpiredTrash() {
    const all = await MyVaultDB.getAllItems();
    const cutoff = Utils.now() - 7 * 24 * 60 * 60 * 1000;
    for (const item of all) {
      if (item.deletedAt && item.deletedAt < cutoff) {
        await MyVaultDB.deleteItemHard(item.id);
      }
    }
  }

  function revokeTrackedBlobUrls() {
    state.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    state.blobUrls = [];
  }

  function attachBlobUrls(items) {
    for (const item of items) {
      if (item.fileBlob instanceof Blob && (item.type === "image" || item.type === "video")) {
        const url = URL.createObjectURL(item.fileBlob);
        item._blobUrl = url;
        state.blobUrls.push(url);
      }
    }
  }

  async function refreshData() {
    revokeTrackedBlobUrls();
    const [items, trashed, categories] = await Promise.all([
      MyVaultDB.getActiveItems(),
      MyVaultDB.getTrashedItems(),
      MyVaultDB.getAllCategories(),
    ]);
    attachBlobUrls(items);
    attachBlobUrls(trashed);
    state.items = items;
    state.trashItems = trashed;
    state.categories = categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  function myAppsCategory() {
    return state.categories.find((c) => c.name === "My Apps") || state.categories[0];
  }

  // ---------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------
  function goToView(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    document.querySelectorAll(".nav-btn[data-nav]").forEach((b) => {
      b.classList.toggle("active", b.dataset.nav === view);
    });
    document.getElementById("app-main").scrollTop = 0;

    if (view === "home") renderHome();
    if (view === "search") renderSearchView();
    if (view === "tasks") renderTasksView();
    if (view === "myapps") renderMyAppsView();
  }

  function wireGlobalEvents() {
    document.querySelectorAll(".nav-btn[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => goToView(btn.dataset.nav));
    });
    document.getElementById("nav-add-btn").addEventListener("click", () => openAddSheet());
    document.getElementById("search-launcher").addEventListener("click", () => goToView("search"));
    document.getElementById("search-back").addEventListener("click", () => goToView("home"));
    document.getElementById("assistant-btn").addEventListener("click", () => openAssistant());
    document.getElementById("assistant-back").addEventListener("click", () => goToView("home"));

    // More tiles
    document.getElementById("more-grid").addEventListener("click", (e) => {
      const tile = e.target.closest(".more-tile");
      if (!tile) return;
      handleMoreTile(tile.dataset.more);
    });

    // Search input/filters
    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", Utils.debounce(() => {
      state.searchQuery = searchInput.value;
      renderSearchResults();
    }, 180));
    document.getElementById("search-sort").addEventListener("change", (e) => {
      state.searchSort = e.target.value;
      renderSearchResults();
    });

    // Tasks tabs
    document.getElementById("tasks-tab-row").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      state.taskTab = tab.dataset.tasktab;
      document.querySelectorAll("#tasks-tab-row .tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderTaskList();
    });

    // Add sheet
    document.getElementById("add-type-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".add-type");
      if (!btn) return;
      closeSheet("add-sheet-overlay");
      openItemForm(btn.dataset.type);
    });

    // Generic overlay dismiss (tap outside sheet)
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      ov.addEventListener("click", (e) => {
        if (e.target === ov) ov.classList.add("hidden");
      });
    });
    document.getElementById("form-sheet-close").addEventListener("click", () => closeSheet("form-sheet-overlay"));

    // Item detail overlay delegation
    document.getElementById("item-detail-overlay").addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) handleDetailAction(actionBtn.dataset.action, actionBtn.dataset.id);
    });

    // Sublist back
    document.getElementById("sublist-back").addEventListener("click", () => goToView("more"));
    document.getElementById("myapps-back").addEventListener("click", () => goToView("more"));
    document.getElementById("myapps-add").addEventListener("click", () => {
      state.myAppParentId = null;
      openItemForm("myapp");
    });
    document.getElementById("myapp-detail-back").addEventListener("click", () => goToView("myapps"));
    document.getElementById("settings-back").addEventListener("click", () => goToView("more"));
    document.getElementById("account-back").addEventListener("click", () => goToView("more"));
    document.getElementById("backup-back").addEventListener("click", () => goToView("more"));

    // Item cards click delegation (home, search, sublist, tasks)
    ["home-sections", "search-results", "sublist-content", "myapps-list"].forEach((id) => {
      document.getElementById(id).addEventListener("click", (e) => {
        const card = e.target.closest("[data-item-id]");
        const taskToggle = e.target.closest("[data-task-toggle]");
        if (taskToggle) {
          toggleTaskComplete(taskToggle.dataset.taskToggle);
          return;
        }
        if (card) openItemDetailOrApp(card.dataset.itemId);
      });
    });
    document.getElementById("tasks-list").addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-task-toggle]");
      if (toggle) { toggleTaskComplete(toggle.dataset.taskToggle); return; }
      const card = e.target.closest("[data-item-id]");
      if (card) openItemDetail(card.dataset.itemId);
    });

    // Confirm dialog
    document.getElementById("confirm-cancel").addEventListener("click", () => closeSheet("confirm-overlay"));
    document.getElementById("confirm-ok").addEventListener("click", () => {
      const cb = state.confirmCb;
      closeSheet("confirm-overlay");
      if (cb) cb();
    });

    // Assistant
    document.getElementById("assistant-form").addEventListener("submit", handleAssistantSubmit);
  }

  function openItemDetailOrApp(id) {
    const item = findItemAnywhere(id);
    if (!item) return;
    if (item.type === "myapp") openMyAppDetail(id);
    else openItemDetail(id);
  }

  function findItemAnywhere(id) {
    return state.items.find((i) => i.id === id) || state.trashItems.find((i) => i.id === id);
  }

  function closeSheet(id) {
    document.getElementById(id).classList.add("hidden");
  }
  function openOverlay(id) {
    document.getElementById(id).classList.remove("hidden");
  }

  function confirmDialog(message, cb) {
    document.getElementById("confirm-message").textContent = message;
    state.confirmCb = cb;
    openOverlay("confirm-overlay");
  }

  // ---------------------------------------------------------------
  // HOME DASHBOARD
  // ---------------------------------------------------------------
  function renderHome() {
    const container = document.getElementById("home-sections");
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const todayTasks = state.items.filter((i) => i.type === "task" && !i.completed && i.dueDate && i.dueDate <= today.getTime());
    const upcomingReminders = state.items
      .filter((i) => i.reminderAt && i.reminderAt >= Utils.now() - 86400000 && !i.completed)
      .sort((a, b) => a.reminderAt - b.reminderAt)
      .slice(0, 5);
    const recentlyAdded = [...state.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    const favorites = state.items.filter((i) => i.favorite).slice(0, 8);
    const myApps = state.items.filter((i) => i.type === "myapp").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);

    let html = "";

    html += section("Today's Tasks", "tasks", todayTasks.length,
      todayTasks.length ? todayTasks.slice(0, 4).map(UI.taskRow).join("") : UI.emptyState("Nothing due today. Tap ＋ to add a task."));

    html += section("Upcoming Reminders", "more", upcomingReminders.length,
      upcomingReminders.length ? upcomingReminders.map(UI.reminderRow).join("") : UI.emptyState("No active reminders."));

    if (myApps.length) {
      html += `<div class="dash-section"><div class="dash-section-head"><h3>My Apps progress</h3><button class="see-all" data-goto="myapps">See all</button></div>
        <div class="dash-hscroll">${myApps.map((a) => UI.myAppCard(a, state.categories)).join("")}</div></div>`;
    }

    html += `<div class="dash-section"><div class="dash-section-head"><h3>Favorites</h3></div>` +
      (favorites.length ? `<div class="dash-hscroll">${favorites.map((i) => UI.itemCard(i, state.categories)).join("")}</div>` : UI.emptyState("Star items to pin them here.")) +
      `</div>`;

    html += `<div class="dash-section"><div class="dash-section-head"><h3>Recently Added</h3></div>` +
      (recentlyAdded.length ? recentlyAdded.map((i) => UI.itemCard(i, state.categories)).join("") : UI.emptyState("Your Vault is empty — tap ＋ to add your first item.")) +
      `</div>`;

    container.innerHTML = html;
    container.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => goToView(el.dataset.goto)));

    function section(title, gotoView, count, bodyHtml) {
      return `<div class="dash-section"><div class="dash-section-head"><h3>${title}</h3></div>${bodyHtml}</div>`;
    }
  }

  // ---------------------------------------------------------------
  // SEARCH VIEW
  // ---------------------------------------------------------------
  const SEARCH_FILTERS = [
    ["all", "All"], ["note", "Notes"], ["file", "Files"], ["image", "Images"],
    ["video", "Videos"], ["link", "Links"], ["document", "Documents"], ["task", "Tasks"], ["myapp", "Projects"],
  ];

  function renderSearchView() {
    const chipRow = document.getElementById("search-filters");
    chipRow.innerHTML = SEARCH_FILTERS.map(([val, label]) =>
      `<button class="chip ${state.searchFilter === val ? "active" : ""}" data-filter="${val}">${label}</button>`).join("");
    chipRow.onclick = (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.searchFilter = chip.dataset.filter;
      renderSearchView();
    };
    document.getElementById("search-sort").value = state.searchSort;
    renderSearchResults();
    setTimeout(() => document.getElementById("search-input").focus(), 250);
  }

  function renderSearchResults() {
    const results = Search.search(state.items, state.categories, state.searchQuery, {
      typeFilter: state.searchFilter,
      sortBy: state.searchSort,
    });
    document.getElementById("search-count").textContent = results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "";
    const el = document.getElementById("search-results");
    el.innerHTML = results.length
      ? results.map((i) => i.type === "myapp" ? UI.myAppCard(i, state.categories) : UI.itemCard(i, state.categories)).join("")
      : `<div class="dash-empty" style="padding:20px 4px;">${state.searchQuery ? "No matches. Try a different word." : "Start typing to search your whole Vault."}</div>`;
  }

  // ---------------------------------------------------------------
  // TASKS VIEW
  // ---------------------------------------------------------------
  function renderTasksView() {
    renderTaskList();
  }
  function renderTaskList() {
    const tasks = state.items.filter((i) => i.type === "task");
    let list;
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    if (state.taskTab === "today") {
      list = tasks.filter((t) => !t.completed && (!t.dueDate || t.dueDate <= endOfToday.getTime()));
    } else if (state.taskTab === "upcoming") {
      list = tasks.filter((t) => !t.completed && t.dueDate && t.dueDate > endOfToday.getTime());
    } else {
      list = tasks.filter((t) => t.completed);
    }
    list.sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
    const el = document.getElementById("tasks-list");
    el.innerHTML = list.length ? list.map(UI.taskRow).join("") : UI.emptyState(
      state.taskTab === "done" ? "No completed tasks yet." : "Nothing here. Tap ＋ to add a task."
    );
  }

  async function toggleTaskComplete(id) {
    const item = await MyVaultDB.getItem(id);
    if (!item) return;
    item.completed = !item.completed;
    item.updatedAt = Utils.now();
    await MyVaultDB.putItem(item);
    await refreshData();
    if (state.view === "tasks") renderTaskList();
    if (state.view === "home") renderHome();
  }

  // ---------------------------------------------------------------
  // MORE / SUBLISTS
  // ---------------------------------------------------------------
  function handleMoreTile(kind) {
    if (kind === "myapps") { goToView("myapps"); return; }
    if (kind === "settings") { renderSettings(); goToView("settings"); return; }
    if (kind === "account") { renderAccount(); goToView("account"); return; }
    if (kind === "backup") { renderBackup(); goToView("backup"); return; }
    if (kind === "categories") { renderCategoriesSublist(); return; }
    if (kind === "favorites") { renderFilteredSublist("Favorites", (i) => i.favorite); return; }
    if (kind === "important") { renderFilteredSublist("Important", (i) => i.important); return; }
    if (kind === "reminders") { renderFilteredSublist("Reminders", (i) => !!i.reminderAt, "reminder"); return; }
    if (kind === "trash") { renderTrashSublist(); return; }
  }

  function showSublist(title, toolbarHtml, bodyHtml) {
    document.getElementById("sublist-title").textContent = title;
    document.getElementById("sublist-toolbar").innerHTML = toolbarHtml || "";
    document.getElementById("sublist-content").innerHTML = bodyHtml;
    goToView("sublist");
  }

  function renderCategoriesSublist() {
    const toolbar = `<button class="btn btn-primary btn-sm" id="cat-add-btn">＋ New Category</button>`;
    const body = state.categories.map((c) => {
      const count = state.items.filter((i) => i.categoryId === c.id).length;
      return `<div class="category-tile" data-cat-id="${c.id}">
        <span class="category-color-dot" style="background:${c.color}"></span>
        <span>${Utils.escapeHtml(c.name)}</span>
        <span class="cat-count">${count} item${count === 1 ? "" : "s"}</span>
      </div>`;
    }).join("") || UI.emptyState("No categories yet.");
    showSublist("Categories", toolbar, body);
    document.getElementById("cat-add-btn").onclick = () => openCategoryForm();
    document.getElementById("sublist-content").querySelectorAll(".category-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const cat = state.categories.find((c) => c.id === tile.dataset.catId);
        renderFilteredSublist(cat.name, (i) => i.categoryId === cat.id);
      });
    });
  }

  function renderFilteredSublist(title, predicate, mode) {
    const list = state.items.filter(predicate).sort((a, b) => b.updatedAt - a.updatedAt);
    const body = list.length
      ? list.map((i) => mode === "reminder" ? UI.reminderRow(i) : (i.type === "myapp" ? UI.myAppCard(i, state.categories) : UI.itemCard(i, state.categories))).join("")
      : UI.emptyState("Nothing here yet.");
    showSublist(title, "", body);
  }

  function renderTrashSublist() {
    const list = [...state.trashItems].sort((a, b) => b.deletedAt - a.deletedAt);
    const body = list.length ? list.map((i) => {
      const daysLeft = 7 - Math.floor((Utils.now() - i.deletedAt) / 86400000);
      return `<div class="item-card" data-trash-id="${i.id}">
        <div class="type-badge badge-${i.type}">${UI.TYPE_ICON[i.type] || "📦"}</div>
        <div class="item-body">
          <div class="item-title">${Utils.escapeHtml(i.title || "Untitled")}</div>
          <div class="trash-countdown">${daysLeft > 0 ? `Deletes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "Deleting soon"}</div>
        </div>
        <div class="item-flags" style="flex-direction:column; gap:8px;">
          <button class="btn btn-sm btn-ghost" data-restore="${i.id}">Restore</button>
          <button class="btn btn-sm btn-danger" data-purge="${i.id}">Delete</button>
        </div>
      </div>`;
    }).join("") : UI.emptyState("Trash is empty.");
    showSublist("Trash", `<div class="field-hint">Items are kept for 7 days, then removed automatically.</div>`, body);
    document.getElementById("sublist-content").onclick = async (e) => {
      const r = e.target.closest("[data-restore]");
      const p = e.target.closest("[data-purge]");
      if (r) {
        const item = await MyVaultDB.getItem(r.dataset.restore);
        delete item.deletedAt;
        item.updatedAt = Utils.now();
        await MyVaultDB.putItem(item);
        await refreshData();
        renderTrashSublist();
        Utils.toast("Restored to your Vault.");
      } else if (p) {
        confirmDialog("Permanently delete this item? This can't be undone.", async () => {
          await MyVaultDB.deleteItemHard(p.dataset.purge);
          await refreshData();
          renderTrashSublist();
          Utils.toast("Permanently deleted.");
        });
      }
    };
  }

  // ---------------------------------------------------------------
  // CATEGORY FORM
  // ---------------------------------------------------------------
  function openCategoryForm() {
    document.getElementById("cat-name").value = "";
    const row = document.getElementById("cat-color-row");
    let selected = SWATCHES[0];
    row.innerHTML = SWATCHES.map((c) => `<button type="button" class="color-swatch ${c === selected ? "selected" : ""}" style="background:${c}" data-color="${c}"></button>`).join("");
    row.onclick = (e) => {
      const sw = e.target.closest(".color-swatch");
      if (!sw) return;
      selected = sw.dataset.color;
      row.querySelectorAll(".color-swatch").forEach((s) => s.classList.toggle("selected", s === sw));
    };
    document.getElementById("category-form").onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("cat-name").value.trim();
      if (!name) return;
      await MyVaultDB.putCategory({ id: Utils.uid(), name, color: selected, createdAt: Utils.now() });
      closeSheet("category-sheet-overlay");
      await refreshData();
      Utils.toast("Category created.");
      renderCategoriesSublist();
    };
    openOverlay("category-sheet-overlay");
  }

  // ---------------------------------------------------------------
  // MY APPS
  // ---------------------------------------------------------------
  function renderMyAppsView() {
    const apps = state.items.filter((i) => i.type === "myapp").sort((a, b) => b.updatedAt - a.updatedAt);
    document.getElementById("myapps-list").innerHTML = apps.length
      ? apps.map((a) => UI.myAppCard(a, state.categories)).join("")
      : UI.emptyState("No projects yet. Tap ＋ to log your first app.");
  }

  function openMyAppDetail(id) {
    const app = findItemAnywhere(id);
    if (!app) return;
    document.getElementById("myapp-detail-title").textContent = app.title;
    const linked = state.items.filter((i) => i.parentAppId === id);
    const milestones = (app.milestones || []).map((m, idx) => `
      <div class="milestone-item"><div class="milestone-num">${idx + 1}</div><div>${Utils.escapeHtml(m.text)}</div></div>`).join("");

    document.getElementById("myapp-detail-content").innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        ${app.description ? `<p class="detail-desc" style="margin-bottom:12px;">${Utils.escapeHtml(app.description)}</p>` : ""}
        <div class="detail-meta-row">
          ${app.techUsed ? `<span class="meta-pill">${Utils.escapeHtml(app.techUsed)}</span>` : ""}
          <span class="meta-pill">${Utils.escapeHtml(app.status || "Active")}</span>
          <span class="meta-pill">Created ${Utils.formatDate(app.createdAt)}</span>
          <span class="meta-pill">Updated ${Utils.relativeTime(app.updatedAt)}</span>
        </div>
        <div class="detail-actions">
          ${app.githubUrl ? `<a class="btn btn-outline" href="${Utils.escapeHtml(app.githubUrl)}" target="_blank" rel="noopener">GitHub</a>` : ""}
          ${app.liveUrl ? `<a class="btn btn-primary" href="${Utils.escapeHtml(app.liveUrl)}" target="_blank" rel="noopener">Live Demo</a>` : ""}
        </div>
      </div>
      ${milestones ? `<h3 style="font-size:14px; margin-bottom:8px;">Milestones</h3><div class="card" style="margin-bottom:16px;">${milestones}</div>` : ""}
      <div class="view-header-row" style="margin-bottom:10px;"><h3 style="flex:1; font-size:14px;">Attached media &amp; notes</h3>
        <button class="btn btn-sm btn-outline" id="myapp-add-media">＋ Add</button>
      </div>
      <div id="myapp-linked-items">${linked.length ? linked.map((i) => UI.itemCard(i, state.categories)).join("") : UI.emptyState("Attach screenshots, notes, or files to this project.")}</div>
      <button class="btn btn-danger btn-block" id="myapp-delete-btn" style="margin-top:20px;">Move to Trash</button>
    `;
    document.getElementById("myapp-linked-items").querySelectorAll("[data-item-id]").forEach((el) => {
      el.addEventListener("click", () => openItemDetail(el.dataset.itemId));
    });
    document.getElementById("myapp-add-media").onclick = () => {
      state.myAppParentId = id;
      openAddSheet(true);
    };
    document.getElementById("myapp-detail-edit").onclick = () => openItemForm("myapp", app);
    document.getElementById("myapp-delete-btn").onclick = () => {
      confirmDialog("Move this project to Trash?", async () => {
        await softDeleteItem(id);
        goToView("myapps");
      });
    };
    goToView("myapp-detail");
  }

  // ---------------------------------------------------------------
  // ADD SHEET + ITEM FORM
  // ---------------------------------------------------------------
  function openAddSheet(mediaOnly) {
    if (!mediaOnly) state.myAppParentId = null; // only keep project-linking context when opened from a project
    const grid = document.getElementById("add-type-grid");
    grid.querySelectorAll(".add-type").forEach((btn) => {
      const isMedia = ["image", "video", "file", "note"].includes(btn.dataset.type);
      btn.style.display = mediaOnly ? (isMedia ? "" : "none") : "";
    });
    openOverlay("add-sheet-overlay");
  }

  function tagEditor(container, initialTags) {
    let tags = [...(initialTags || [])];
    function render() {
      container.querySelectorAll(".tag-pill").forEach((p) => p.remove());
      const input = container.querySelector("input");
      tags.forEach((t) => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.innerHTML = `${Utils.escapeHtml(t)} <button type="button">&times;</button>`;
        pill.querySelector("button").onclick = () => { tags = tags.filter((x) => x !== t); render(); };
        container.insertBefore(pill, input);
      });
    }
    const input = container.querySelector("input");
    input.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
        e.preventDefault();
        const v = input.value.trim().replace(/,$/, "");
        if (v && !tags.includes(v)) tags.push(v);
        input.value = "";
        render();
      } else if (e.key === "Backspace" && !input.value && tags.length) {
        tags.pop();
        render();
      }
    });
    render();
    return { getTags: () => tags };
  }

  function categoryOptions(selectedId) {
    return state.categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${Utils.escapeHtml(c.name)}</option>`).join("");
  }

  function openItemForm(type, existingItem) {
    state.pendingFormType = type;
    state.editingItem = existingItem || null;
    state.formFileBlob = existingItem && existingItem.fileBlob instanceof Blob ? existingItem.fileBlob : null;

    const isQuick = type === "quick";
    const effType = isQuick ? "note" : type;
    document.getElementById("form-sheet-title").textContent = existingItem
      ? `Edit ${UI.TYPE_LABEL[effType]}`
      : isQuick ? "Quick Capture" : `New ${UI.TYPE_LABEL[effType]}`;

    const form = document.getElementById("item-form");
    form.innerHTML = buildFormHtml(effType, existingItem, isQuick);
    openOverlay("form-sheet-overlay");

    let tagCtl = null;
    const tagRow = form.querySelector(".tag-input-row");
    if (tagRow) tagCtl = tagEditor(tagRow, existingItem ? existingItem.tags : []);

    const fileInput = form.querySelector("#form-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        state.formFileBlob = file;
        state.formFileMeta = { name: file.name, size: file.size, mime: file.type };
        renderFilePreview(form, effType, file);
      });
    }

    form.onsubmit = (e) => handleFormSubmit(e, effType, existingItem, tagCtl, isQuick);
  }

  function renderFilePreview(form, type, file) {
    const wrap = form.querySelector("#file-preview-wrap");
    if (!wrap) return;
    const url = URL.createObjectURL(file);
    state.blobUrls.push(url);
    let inner = `<span>${Utils.escapeHtml(file.name)} \u00b7 ${Utils.humanFileSize(file.size)}</span>`;
    if (type === "image") inner = `<img src="${url}" alt="" />` + inner;
    if (type === "video") inner = `<video src="${url}" muted></video>` + inner;
    wrap.innerHTML = `<div class="file-preview">${inner}</div>`;
  }

  function buildFormHtml(type, item, isQuick) {
    const catField = `
      <label class="field-label">Category</label>
      <select class="field-select" id="form-category">${categoryOptions(item ? item.categoryId : myAppsCategoryDefaultFor(type))}</select>`;
    const tagsField = `
      <label class="field-label">Tags</label>
      <div class="tag-input-row"><input type="text" placeholder="Type a tag, press Enter" /></div>`;
    const titleField = (label = "Title") => `
      <label class="field-label">${label}</label>
      <input class="field-input" id="form-title" value="${item ? Utils.escapeHtml(item.title) : ""}" placeholder="Give it a name" ${isQuick ? "" : "required"} />`;
    const descField = (label = "Description") => `
      <label class="field-label">${label}</label>
      <textarea class="field-textarea" id="form-description" placeholder="Optional details">${item ? Utils.escapeHtml(item.description || "") : ""}</textarea>`;
    const flagsField = `
      <div class="settings-row" style="margin-top:14px;">
        <span class="settings-label">Mark as Important</span>
        <input type="checkbox" id="form-important" ${item && item.important ? "checked" : ""} style="width:22px;height:22px;" />
      </div>
      <div class="settings-row" style="margin-top:10px;">
        <span class="settings-label">Add to Favorites</span>
        <input type="checkbox" id="form-favorite" ${item && item.favorite ? "checked" : ""} style="width:22px;height:22px;" />
      </div>`;
    const fileField = (accept, label) => `
      <label class="field-label">${label}</label>
      <label class="file-drop" for="form-file-input">${item && item.fileName ? `Replace file: ${Utils.escapeHtml(item.fileName)}` : "Tap to choose a file"}</label>
      <input type="file" id="form-file-input" accept="${accept}" style="display:none;" ${item ? "" : "required"} />
      <div id="file-preview-wrap"></div>`;
    const submitBtn = `<div class="form-actions">
        <button type="button" class="btn btn-ghost" id="form-cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">${item ? "Save Changes" : "Add to Vault"}</button>
      </div>`;

    let fields = "";
    if (type === "note") {
      fields = `
        ${isQuick ? "" : titleField()}
        <label class="field-label">${isQuick ? "What's on your mind?" : "Content"}</label>
        <textarea class="field-textarea" id="form-content" placeholder="Write your note…" style="min-height:${isQuick ? "140px" : "120px"};">${item ? Utils.escapeHtml(item.content || "") : ""}</textarea>
        ${isQuick ? "" : catField}
        ${isQuick ? "" : tagsField}
        ${isQuick ? "" : `<label class="field-label">Optional reminder</label><input class="field-input" type="datetime-local" id="form-reminder" value="${item && item.reminderAt ? toLocalInput(item.reminderAt) : ""}" />`}
        ${isQuick ? "" : flagsField}`;
    } else if (type === "task") {
      fields = `
        ${titleField("Task title")}
        ${descField("Description (optional)")}
        <label class="field-label">Due date</label>
        <input class="field-input" type="date" id="form-duedate" value="${item && item.dueDate ? toDateInput(item.dueDate) : ""}" />
        <label class="field-label">Reminder (optional)</label>
        <input class="field-input" type="datetime-local" id="form-reminder" value="${item && item.reminderAt ? toLocalInput(item.reminderAt) : ""}" />
        ${catField}${tagsField}${flagsField}`;
    } else if (type === "link") {
      fields = `
        <label class="field-label">URL</label>
        <input class="field-input" id="form-url" type="url" placeholder="https://…" value="${item ? Utils.escapeHtml(item.url || "") : ""}" required />
        ${titleField()}
        ${descField()}
        ${catField}${tagsField}${flagsField}`;
    } else if (type === "image" || type === "video" || type === "file" || type === "document") {
      const accept = type === "image" ? "image/*" : type === "video" ? "video/*" : type === "document" ? ".pdf,.doc,.docx,.txt,.rtf,.odt" : "*/*";
      fields = `
        ${fileField(accept, type === "image" ? "Image" : type === "video" ? "Video" : type === "document" ? "Document" : "File")}
        ${titleField()}
        ${descField()}
        ${catField}${tagsField}${flagsField}`;
    } else if (type === "myapp") {
      fields = `
        ${titleField("Project name")}
        ${descField("What is it? What did you learn?")}
        <label class="field-label">GitHub URL</label>
        <input class="field-input" id="form-github" type="url" placeholder="https://github.com/…" value="${item ? Utils.escapeHtml(item.githubUrl || "") : ""}" />
        <label class="field-label">Live Demo URL</label>
        <input class="field-input" id="form-live" type="url" placeholder="https://…" value="${item ? Utils.escapeHtml(item.liveUrl || "") : ""}" />
        <label class="field-label">Technology used</label>
        <input class="field-input" id="form-tech" placeholder="HTML, CSS, JavaScript" value="${item ? Utils.escapeHtml(item.techUsed || "") : ""}" />
        <label class="field-label">Status</label>
        <select class="field-select" id="form-status">
          ${["Active", "Paused", "Done"].map((s) => `<option ${item && item.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <label class="field-label">Milestones (one per line)</label>
        <textarea class="field-textarea" id="form-milestones" placeholder="e.g. Built the calculator UI">${item && item.milestones ? item.milestones.map((m) => m.text).join("\n") : ""}</textarea>
        ${tagsField}${flagsField}`;
    }

    return fields + submitBtn;

    function myAppsCategoryDefaultFor(t) {
      if (t === "myapp") { const c = myAppsCategory(); return c ? c.id : undefined; }
      if (state.myAppParentId) { const c = myAppsCategory(); return c ? c.id : undefined; }
      return state.categories[0] ? state.categories[0].id : undefined;
    }
  }

  function toLocalInput(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toDateInput(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "form-cancel-btn") {
      state.myAppParentId = null;
      state.formFileBlob = null;
      closeSheet("form-sheet-overlay");
    }
  });

  async function handleFormSubmit(e, type, existingItem, tagCtl, isQuick) {
    e.preventDefault();
    const form = e.target;
    const get = (id) => form.querySelector(id);

    if ((type === "image" || type === "video" || type === "file" || type === "document") && !state.formFileBlob) {
      Utils.toast("Please choose a file first.", "error");
      return;
    }

    const now = Utils.now();
    let item = existingItem ? { ...existingItem } : {
      id: Utils.uid(), type, createdAt: now, favorite: false, important: false,
    };
    item.updatedAt = now;

    if (type === "note") {
      item.title = isQuick
        ? (get("#form-content").value.trim().slice(0, 60) || "Quick note")
        : get("#form-title").value.trim();
      item.content = get("#form-content").value.trim();
      if (!isQuick) {
        item.categoryId = get("#form-category").value;
        item.tags = tagCtl.getTags();
        const rem = get("#form-reminder").value;
        item.reminderAt = rem ? new Date(rem).getTime() : null;
        item.important = get("#form-important").checked;
        item.favorite = get("#form-favorite").checked;
      } else {
        item.categoryId = state.categories[0] ? state.categories[0].id : undefined;
        item.tags = ["quick-capture"];
      }
    } else if (type === "task") {
      item.title = get("#form-title").value.trim();
      item.description = get("#form-description").value.trim();
      const due = get("#form-duedate").value;
      item.dueDate = due ? new Date(due + "T23:59:59").getTime() : null;
      const rem = get("#form-reminder").value;
      item.reminderAt = rem ? new Date(rem).getTime() : null;
      item.categoryId = get("#form-category").value;
      item.tags = tagCtl.getTags();
      item.completed = existingItem ? existingItem.completed : false;
      item.important = get("#form-important").checked;
      item.favorite = get("#form-favorite").checked;
    } else if (type === "link") {
      const url = get("#form-url").value.trim();
      if (!Utils.isValidUrl(url)) { Utils.toast("That doesn't look like a valid link.", "error"); return; }
      item.url = url;
      item.title = get("#form-title").value.trim();
      item.description = get("#form-description").value.trim();
      item.categoryId = get("#form-category").value;
      item.tags = tagCtl.getTags();
      item.important = get("#form-important").checked;
      item.favorite = get("#form-favorite").checked;
    } else if (["image", "video", "file", "document"].includes(type)) {
      item.title = get("#form-title").value.trim();
      item.description = get("#form-description").value.trim();
      item.categoryId = get("#form-category").value;
      item.tags = tagCtl.getTags();
      item.important = get("#form-important").checked;
      item.favorite = get("#form-favorite").checked;
      if (state.formFileBlob) {
        item.fileBlob = state.formFileBlob;
        item.fileName = state.formFileBlob.name || item.fileName;
        item.fileMime = state.formFileBlob.type;
        item.fileSize = state.formFileBlob.size;
      }
    } else if (type === "myapp") {
      item.title = get("#form-title").value.trim();
      item.description = get("#form-description").value.trim();
      item.githubUrl = get("#form-github").value.trim();
      item.liveUrl = get("#form-live").value.trim();
      item.techUsed = get("#form-tech").value.trim();
      item.status = get("#form-status").value;
      item.milestones = get("#form-milestones").value.split("\n").map((l) => l.trim()).filter(Boolean).map((t) => ({ text: t, date: now }));
      item.categoryId = myAppsCategory() ? myAppsCategory().id : undefined;
      item.tags = tagCtl.getTags();
      item.important = get("#form-important").checked;
      item.favorite = get("#form-favorite").checked;
    }

    // Link this item to a My Apps project if it was added from that project's
    // "Add media/notes" flow — applies regardless of which type was chosen.
    if (state.myAppParentId && type !== "myapp") {
      item.parentAppId = state.myAppParentId;
    }

    try {
      await MyVaultDB.putItem(item);
    } catch (err) {
      console.error(err);
      Utils.toast("Couldn't save — storage may be full.", "error");
      return;
    }

    state.formFileBlob = null;
    state.myAppParentId = null;
    closeSheet("form-sheet-overlay");
    await refreshData();
    Utils.toast(existingItem ? "Changes saved." : "Added to your Vault.");
    rerenderCurrentView();
    if (type === "myapp" && !existingItem) openMyAppDetail(item.id);
  }

  function rerenderCurrentView() {
    if (state.view === "home") renderHome();
    else if (state.view === "search") renderSearchResults();
    else if (state.view === "tasks") renderTaskList();
    else if (state.view === "myapps") renderMyAppsView();
    else if (state.view === "myapp-detail" && state.editingItem) openMyAppDetail(state.editingItem.id);
  }

  // ---------------------------------------------------------------
  // ITEM DETAIL
  // ---------------------------------------------------------------
  function openItemDetail(id) {
    const item = findItemAnywhere(id);
    if (!item) return;
    if (!item.deletedAt) {
      MyVaultDB.getItem(id).then((full) => {
        if (full) { full.lastOpenedAt = Utils.now(); MyVaultDB.putItem(full); }
      });
    }
    const cat = UI.catById(state.categories, item.categoryId);
    let media = "";
    if (item.fileBlob instanceof Blob) {
      if (item.type === "image") media = `<div class="detail-media"><img src="${item._blobUrl}" alt=""/></div>`;
      else if (item.type === "video") media = `<div class="detail-media"><video src="${item._blobUrl}" controls></video></div>`;
    }

    const metaPills = [];
    if (cat) metaPills.push(`<span class="meta-pill">${UI.catDot(cat.color)} ${Utils.escapeHtml(cat.name)}</span>`);
    (item.tags || []).forEach((t) => metaPills.push(`<span class="meta-pill">#${Utils.escapeHtml(t)}</span>`));
    if (item.dueDate) metaPills.push(`<span class="meta-pill">Due ${Utils.formatDate(item.dueDate)}</span>`);
    if (item.reminderAt) metaPills.push(`<span class="meta-pill">🔔 ${Utils.formatDateTime(item.reminderAt)}</span>`);
    metaPills.push(`<span class="meta-pill">Updated ${Utils.relativeTime(item.updatedAt)}</span>`);

    let bodyText = item.content || item.description || "";
    let linkRow = "";
    if (item.type === "link" && item.url) {
      linkRow = `<a class="btn btn-outline btn-block" href="${Utils.escapeHtml(item.url)}" target="_blank" rel="noopener" style="margin-bottom:14px; display:block; text-align:center;">Open Link ↗</a>`;
    }
    let fileRow = "";
    if (item.fileBlob instanceof Blob && item.type !== "image" && item.type !== "video") {
      fileRow = `<button class="btn btn-outline btn-block" style="margin-bottom:14px;" data-action="download" data-id="${item.id}">Download ${Utils.escapeHtml(item.fileName || "file")} (${Utils.humanFileSize(item.fileSize)})</button>`;
    }

    const inTrash = !!item.deletedAt;

    document.getElementById("item-detail-content").innerHTML = `
      <div class="detail-header">
        <div class="type-badge badge-${item.type}">${UI.TYPE_ICON[item.type] || "📦"}</div>
        <div class="detail-title">${Utils.escapeHtml(item.title || "Untitled")}</div>
      </div>
      ${media}
      ${linkRow}${fileRow}
      ${bodyText ? `<div class="detail-desc">${Utils.escapeHtml(bodyText)}</div>` : ""}
      <div class="detail-meta-row">${metaPills.join("")}</div>
      ${inTrash ? `
        <div class="detail-actions">
          <button class="btn btn-ghost" data-action="restore" data-id="${item.id}">Restore</button>
          <button class="btn btn-danger" data-action="purge" data-id="${item.id}">Delete Forever</button>
        </div>` : `
        <div class="detail-actions">
          <button class="btn btn-ghost" data-action="favorite" data-id="${item.id}">${item.favorite ? "★ Favorited" : "☆ Favorite"}</button>
          <button class="btn btn-ghost" data-action="important" data-id="${item.id}">${item.important ? "💠 Important" : "◇ Mark Important"}</button>
        </div>
        <div class="detail-actions" style="margin-top:8px;">
          <button class="btn btn-outline" data-action="edit" data-id="${item.id}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${item.id}">Delete</button>
        </div>`}
    `;
    openOverlay("item-detail-overlay");
  }

  async function handleDetailAction(action, id) {
    const item = findItemAnywhere(id);
    if (!item) return;
    if (action === "favorite" || action === "important") {
      const full = await MyVaultDB.getItem(id);
      full[action] = !full[action];
      full.updatedAt = Utils.now();
      await MyVaultDB.putItem(full);
      await refreshData();
      closeSheet("item-detail-overlay");
      rerenderCurrentView();
    } else if (action === "delete") {
      confirmDialog("Move this to Trash? You can restore it within 7 days.", async () => {
        await softDeleteItem(id);
        closeSheet("item-detail-overlay");
      });
    } else if (action === "restore") {
      const full = await MyVaultDB.getItem(id);
      delete full.deletedAt;
      full.updatedAt = Utils.now();
      await MyVaultDB.putItem(full);
      await refreshData();
      closeSheet("item-detail-overlay");
      Utils.toast("Restored.");
      rerenderCurrentView();
    } else if (action === "purge") {
      confirmDialog("Permanently delete this item? This can't be undone.", async () => {
        await MyVaultDB.deleteItemHard(id);
        await refreshData();
        closeSheet("item-detail-overlay");
        Utils.toast("Permanently deleted.");
        rerenderCurrentView();
      });
    } else if (action === "edit") {
      closeSheet("item-detail-overlay");
      openItemForm(item.type, item);
    } else if (action === "download") {
      const a = document.createElement("a");
      a.href = item._blobUrl;
      a.download = item.fileName || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  async function softDeleteItem(id) {
    const full = await MyVaultDB.getItem(id);
    if (!full) return;
    full.deletedAt = Utils.now();
    await MyVaultDB.putItem(full);
    await refreshData();
    Utils.toast("Moved to Trash.");
    rerenderCurrentView();
  }

  // ---------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------
  function toggleRow(label, desc, checked, onToggle) {
    const id = "tg_" + Utils.uid();
    return { id, html: `
      <div class="settings-row">
        <div><div class="settings-label">${label}</div>${desc ? `<div class="settings-desc">${desc}</div>` : ""}</div>
        <button type="button" class="toggle ${checked ? "on" : ""}" id="${id}"><span class="toggle-knob"></span></button>
      </div>` };
  }

  function renderSettings() {
    const lockOn = Auth.isLockEnabled();
    const bioOn = Auth.hasBiometric();
    const lockToggle = toggleRow("App Lock (PIN)", "Require a PIN to open MyVault", lockOn);
    const bioToggle = toggleRow("Biometric unlock", "Use your device's Face ID / fingerprint as a shortcut", bioOn);

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-group-title">Security</div>
      ${lockToggle.html}
      ${bioToggle.html}
      <div class="settings-group-title">Data</div>
      <div class="settings-row" id="settings-storage-row"><div><div class="settings-label">Storage used</div><div class="settings-desc" id="settings-storage-desc">Calculating…</div></div></div>
      <div class="settings-row" id="settings-backup-row" style="cursor:pointer;"><div class="settings-label">Backup &amp; Restore</div><span>→</span></div>
      <div class="settings-group-title">Privacy</div>
      <div class="info-box">
        Your notes, files, tasks, and reminders are stored locally on this device using IndexedDB — they never leave your phone unless you export a backup or connect an external AI service yourself.
        ${Auth.isGoogleConfigured() ? "Google sign-in is used only for the lock screen, never for vault content." : "Google sign-in isn't configured in this build."}
      </div>
    `;
    document.getElementById(lockToggle.id).onclick = async () => {
      if (lockOn) {
        confirmDialog("Turn off App Lock? Anyone with this device can open MyVault.", () => {
          Auth.disableLock();
          renderSettings();
        });
      } else {
        promptSetPin();
      }
    };
    document.getElementById(bioToggle.id).onclick = async () => {
      if (bioOn) {
        Auth.clearBiometric();
        renderSettings();
      } else {
        if (!lockOn) { Utils.toast("Turn on App Lock (PIN) first."); return; }
        const ok = await Auth.registerBiometric();
        if (ok) { Utils.toast("Biometric unlock enabled."); renderSettings(); }
      }
    };
    document.getElementById("settings-backup-row").onclick = () => { renderBackup(); goToView("backup"); };

    MyVaultDB.estimateUsage().then((est) => {
      const el = document.getElementById("settings-storage-desc");
      if (est && est.usage != null) {
        el.textContent = `${Utils.humanFileSize(est.usage)} used${est.quota ? ` of ~${Utils.humanFileSize(est.quota)} available` : ""}`;
      } else {
        el.textContent = "Not available in this browser.";
      }
    });
  }

  function promptSetPin() {
    let pin = "";
    document.getElementById("gate-sub").textContent = "Create a 4-digit PIN";
    // Reuse the gate keypad UI inline via the confirm-free approach: simplest is a small prompt flow.
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-message").innerHTML = `
      <div style="margin-bottom:10px;">Create a 4-digit PIN</div>
      <input id="pin-set-input" class="field-input" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" style="text-align:center; letter-spacing:8px; font-size:20px;" />
    `;
    state.confirmCb = async () => {
      const val = document.getElementById("pin-set-input").value;
      if (!/^\d{4}$/.test(val)) { Utils.toast("Enter exactly 4 digits.", "error"); promptSetPin(); return; }
      await Auth.setPin(val);
      Utils.toast("App Lock enabled.");
      renderSettings();
    };
    openOverlay("confirm-overlay");
    setTimeout(() => document.getElementById("pin-set-input")?.focus(), 100);
  }

  // ---------------------------------------------------------------
  // ACCOUNT
  // ---------------------------------------------------------------
  function renderAccount() {
    const user = Auth.getFirebaseUser();
    let html = "";
    if (user) {
      html += `<div class="card" style="text-align:center; margin-bottom:16px;">
        <div style="font-weight:700; font-size:16px;">${Utils.escapeHtml(user.displayName || user.email)}</div>
        <div style="color:var(--text-faint); font-size:13px;">${Utils.escapeHtml(user.email || "")}</div>
      </div>
      <button class="btn btn-outline btn-block" id="account-signout">Sign out of Google</button>`;
    } else if (Auth.isGoogleConfigured()) {
      html += `<button class="btn btn-primary btn-block" id="account-signin">Continue with Google</button>`;
    } else {
      html += `<div class="info-box">Google sign-in isn't configured for this build. MyVault runs fully in local-only mode — see js/firebase-config.example.js in the project files for setup steps.</div>`;
    }
    document.getElementById("account-content").innerHTML = html;
    const signIn = document.getElementById("account-signin");
    if (signIn) signIn.onclick = async () => { await Auth.googleSignIn(); renderAccount(); };
    const signOut = document.getElementById("account-signout");
    if (signOut) signOut.onclick = async () => { await Auth.signOutFirebase(); renderAccount(); };
  }

  // ---------------------------------------------------------------
  // BACKUP
  // ---------------------------------------------------------------
  function renderBackup() {
    document.getElementById("backup-content").innerHTML = `
      <div class="info-box" style="margin-bottom:14px;">Backups include your notes, tasks, links, categories, and the actual files/images/videos you've saved (as one portable file). Large media libraries will make bigger backup files.</div>
      <button class="btn btn-primary btn-block" id="backup-export-btn">Export Vault Backup</button>
      <div class="field-label">Restore from a backup file</div>
      <label class="file-drop" for="backup-import-input">Tap to choose a MyVault backup (.json) file</label>
      <input type="file" id="backup-import-input" accept="application/json" style="display:none;" />
      <div class="info-box" style="margin-top:16px;">Restoring replaces everything currently in your Vault with the contents of the backup file.</div>
    `;
    document.getElementById("backup-export-btn").onclick = async () => {
      Utils.toast("Building your backup…");
      try {
        const size = await Backup.downloadExport();
        Utils.toast(`Backup ready (${Utils.humanFileSize(size)}).`);
      } catch (e) {
        console.error(e);
        Utils.toast("Backup failed. Please try again.", "error");
      }
    };
    document.getElementById("backup-import-input").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      confirmDialog("This will replace everything currently in your Vault. Continue?", async () => {
        try {
          const result = await Backup.importFromFile(file);
          await refreshData();
          Utils.toast(`Restored ${result.itemCount} items.`);
          goToView("home");
        } catch (err) {
          Utils.toast(err.message || "Couldn't restore that backup.", "error");
        }
      });
    };
  }

  // ---------------------------------------------------------------
  // ASSISTANT
  // ---------------------------------------------------------------
  function openAssistant() {
    goToView("assistant");
    const thread = document.getElementById("assistant-thread");
    if (!thread.dataset.greeted) {
      thread.innerHTML = `<div class="assistant-msg-bot"><div class="assistant-intro">Hi! I'm your MyVault Assistant. I search what's already in your Vault — I won't make things up. Try asking me something like "what's due today" or "I'm feeling demotivated".</div></div>`;
      thread.dataset.greeted = "1";
    }
  }

  async function handleAssistantSubmit(e) {
    e.preventDefault();
    const input = document.getElementById("assistant-input");
    const msg = input.value.trim();
    if (!msg) return;
    const thread = document.getElementById("assistant-thread");
    thread.insertAdjacentHTML("beforeend", `<div class="assistant-msg-user">${Utils.escapeHtml(msg)}</div>`);
    input.value = "";
    thread.scrollTop = thread.scrollHeight;

    const res = await Assistant.ask(msg);
    let html = `<div class="assistant-msg-bot"><div class="assistant-intro">${Utils.escapeHtml(res.intro)}</div>`;
    if (res.results.length) {
      html += res.results.map((i) => i.type === "myapp" ? UI.myAppCard(i, state.categories) : (i.reminderAt && !i.dueDate ? UI.reminderRow(i) : (i.type === "task" ? UI.taskRow(i) : UI.itemCard(i, state.categories)))).join("");
    } else {
      html += `<div class="assistant-empty">${Utils.escapeHtml(res.empty)}</div>`;
    }
    html += "</div>";
    thread.insertAdjacentHTML("beforeend", html);
    thread.querySelectorAll("[data-item-id]").forEach((el) => {
      el.addEventListener("click", () => openItemDetailOrApp(el.dataset.itemId));
    });
    thread.querySelectorAll("[data-task-toggle]").forEach((el) => {
      el.addEventListener("click", () => toggleTaskComplete(el.dataset.taskToggle));
    });
    thread.scrollTop = thread.scrollHeight;
  }
})();
