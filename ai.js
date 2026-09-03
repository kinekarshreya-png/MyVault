/*
  ai.js — the MyVault Assistant.

  This is retrieval, not a chatbot pretending to know things. Pipeline:

    user message
      -> understand intent (small keyword map: motivation, GitHub/apps,
         tasks, reminders, plain search fallback)
      -> expand into search terms
      -> run Search.search() against the user's own vault
      -> rank + group results
      -> present them with an honest, supportive message

  No external AI API is called. If a person wires one up later (see the
  `externalApiHook` stub), it should only ever receive the already-retrieved
  vault snippets as context, and only after explicit consent — never the
  full vault, and never silently.
*/

const Assistant = (() => {
  const INTENT_MAP = [
    {
      name: "motivation",
      keywords: ["demotivated", "unmotivated", "motivation", "stuck", "give up", "tired", "discouraged", "down", "burnt out", "burnout"],
      searchTerms: ["motivation", "inspire", "progress", "achievement", "goal", "important"],
      intro: "Here's some things that might help \u2014 pulled straight from your own Vault:",
    },
    {
      name: "projects",
      keywords: ["project", "github", "app", "coding", "code", "build", "apps"],
      searchTerms: [],
      intro: "Here's what's in your project history:",
    },
    {
      name: "tasks",
      keywords: ["task", "todo", "to-do", "due", "deadline"],
      searchTerms: [],
      intro: "Here's what's on your task list:",
    },
    {
      name: "reminders",
      keywords: ["remind", "reminder", "forgot", "forget"],
      searchTerms: [],
      intro: "Here's what you've set reminders for:",
    },
  ];

  function detectIntent(message) {
    const lower = message.toLowerCase();
    for (const intent of INTENT_MAP) {
      if (intent.keywords.some((k) => lower.includes(k))) return intent;
    }
    return null;
  }

  async function ask(message) {
    const [items, categories] = await Promise.all([
      MyVaultDB.getActiveItems(),
      MyVaultDB.getAllCategories(),
    ]);

    const intent = detectIntent(message);

    if (intent && intent.name === "tasks") {
      const openTasks = items
        .filter((i) => i.type === "task" && !i.completed)
        .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
      return {
        intro: intent.intro,
        results: openTasks.slice(0, 6),
        empty: "You don't have any open tasks right now \u2014 nice and clear.",
      };
    }

    if (intent && intent.name === "reminders") {
      const reminders = items
        .filter((i) => i.reminderAt && !i.completed)
        .sort((a, b) => a.reminderAt - b.reminderAt);
      return {
        intro: intent.intro,
        results: reminders.slice(0, 6),
        empty: "No active reminders at the moment.",
      };
    }

    if (intent && intent.name === "projects") {
      const apps = items.filter((i) => i.type === "myapp").sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        intro: intent.intro,
        results: apps.slice(0, 6),
        empty: "You haven't logged any projects in My Apps yet.",
      };
    }

    // Motivation / projects / generic fallback all go through vault search
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    let searchQuery = message;
    if (intent && intent.searchTerms.length) {
      searchQuery = intent.searchTerms.join(" ");
    }

    let results = Search.search(items, categories, searchQuery, { sortBy: "recent-modified" });

    // Boost favorites/important for motivation-style asks so the response
    // feels personal rather than a generic keyword match.
    if (intent && intent.name === "motivation") {
      const favImp = items.filter((i) => i.favorite || i.important);
      results = [...new Map([...favImp, ...results].map((i) => [i.id, i])).values()];
    }

    return {
      intro: intent ? intent.intro : `Here's what I found in your Vault for "${message}":`,
      results: results.slice(0, 8),
      empty:
        "I couldn't find anything in your Vault about that yet. Try saving a note, link, or file about it \u2014 next time I'll be able to find it.",
      categoryLookup: catMap,
    };
  }

  // Stub for future opt-in external AI use. Only ever called explicitly,
  // only ever passed the pre-retrieved snippets, never raw vault contents.
  async function externalApiHook(retrievedSnippets, userMessage) {
    throw new Error(
      "No external AI API is connected. MyVault works fully on local retrieval. " +
        "Wire up your own API call here only after explicit user consent."
    );
  }

  return { ask, detectIntent, externalApiHook };
})();
