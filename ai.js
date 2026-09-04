/*
  ai.js — MyVault Assistant.
  Local-first retrieval assistant: it searches the user's own Vault and
  never pretends that it knows something that isn't stored there.
*/
const Assistant = (() => {
  const INTENT_MAP = [
    {
      name: "overdue",
      keywords: ["yesterday", "overdue", "missed", "unfinished", "not completed", "not done", "left over", "leftover"],
      intro: "I found the unfinished tasks that have carried over from earlier days:",
    },
    {
      name: "today",
      keywords: ["today", "what should i do", "what do i need to do", "for today", "due today"],
      intro: "Here is what needs your attention today:",
    },
    {
      name: "motivation",
      keywords: ["demotivated", "unmotivated", "motivation", "stuck", "give up", "tired", "discouraged", "down", "burnt out", "burnout"],
      searchTerms: ["motivation", "inspire", "progress", "achievement", "goal", "important"],
      intro: "I checked your Vault for things you saved that can remind you why you started:",
    },
    {
      name: "projects",
      keywords: ["project", "github", "app", "coding", "code", "build", "apps", "my apps"],
      intro: "Here is your project history from MyVault:",
    },
    {
      name: "tasks",
      keywords: ["task", "todo", "to-do", "due", "deadline", "work"],
      intro: "Here is what's on your task list:",
    },
    {
      name: "reminders",
      keywords: ["remind", "reminder", "forgot", "forget", "remember"],
      intro: "Here are your active reminders:",
    },
  ];

  function detectIntent(message) {
    const lower = message.toLowerCase();
    for (const intent of INTENT_MAP) {
      if (intent.keywords.some((k) => lower.includes(k))) return intent;
    }
    return null;
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  async function ask(message) {
    const [items, categories] = await Promise.all([
      MyVaultDB.getActiveItems(),
      MyVaultDB.getAllCategories(),
    ]);
    const intent = detectIntent(message);
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    if (intent?.name === "overdue") {
      const overdue = items
        .filter((i) => i.type === "task" && !i.completed && i.dueDate && i.dueDate < todayStart)
        .sort((a, b) => a.dueDate - b.dueDate);
      return {
        intro: `${intent.intro} Today is ${dateLabel}.`,
        results: overdue.slice(0, 10),
        empty: "Nothing is overdue. Your task list is clear.",
      };
    }

    if (intent?.name === "today") {
      const tasks = items
        .filter((i) => i.type === "task" && !i.completed && (!i.dueDate || i.dueDate <= todayEnd))
        .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
      const reminders = items
        .filter((i) => i.reminderAt && !i.completed && i.reminderAt <= todayEnd)
        .sort((a, b) => a.reminderAt - b.reminderAt);
      const combined = [...tasks, ...reminders].sort((a, b) => ((a.dueDate || a.reminderAt || Infinity) - (b.dueDate || b.reminderAt || Infinity)));
      return {
        intro: `${intent.intro} ${dateLabel}.`,
        results: combined.slice(0, 10),
        empty: "You have no unfinished tasks or reminders needing attention today.",
      };
    }

    if (intent?.name === "tasks") {
      const openTasks = items.filter((i) => i.type === "task" && !i.completed).sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
      return { intro: intent.intro, results: openTasks.slice(0, 10), empty: "You don't have any open tasks right now — nice and clear." };
    }

    if (intent?.name === "reminders") {
      const reminders = items.filter((i) => i.reminderAt && !i.completed).sort((a, b) => a.reminderAt - b.reminderAt);
      return { intro: intent.intro, results: reminders.slice(0, 10), empty: "No active reminders at the moment." };
    }

    if (intent?.name === "projects") {
      const apps = items.filter((i) => i.type === "myapp").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return { intro: intent.intro, results: apps.slice(0, 10), empty: "You haven't logged any projects in My Apps yet." };
    }

    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const searchQuery = intent?.searchTerms?.length ? intent.searchTerms.join(" ") : message;
    let results = Search.search(items, categories, searchQuery, { sortBy: "recent-modified" });

    if (intent?.name === "motivation") {
      const important = items.filter((i) => i.important);
      results = [...new Map([...important, ...results].map((i) => [i.id, i])).values()];
    }

    return {
      intro: intent ? intent.intro : `I searched your Vault for “${message}”:`,
      results: results.slice(0, 10),
      empty: "I couldn't find anything in your Vault about that yet. Save a note, link, screenshot, or project about it and I'll be able to find it later.",
      categoryLookup: catMap,
    };
  }

  async function externalApiHook(retrievedSnippets, userMessage) {
    throw new Error("No external AI API is connected. MyVault currently uses private local retrieval.");
  }

  return { ask, detectIntent, externalApiHook };
})();
