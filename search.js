/*
  search.js — MyVault's unified search & retrieval layer.

  Pipeline (also reused by the AI assistant, see ai.js):
    query text
      -> tokenize
      -> score every active item across title/description/content/tags/
         category name/link/project fields
      -> rank by score, tie-broken by recency
      -> caller applies type filter + sort order on top
*/

const Search = (() => {
  function tokenize(text) {
    return (text || "")
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/i)
      .filter(Boolean);
  }

  function fieldsForItem(item, categoryName) {
    const parts = [
      item.title,
      item.description,
      item.content,
      item.url,
      item.techUsed,
      item.status,
      categoryName,
      ...(item.tags || []),
      ...(item.milestones ? item.milestones.map((m) => m.text) : []),
    ];
    return parts.filter(Boolean).join(" \n ").toLowerCase();
  }

  function scoreItem(item, categoryName, queryTokens, rawQuery) {
    const haystack = fieldsForItem(item, categoryName);
    if (!queryTokens.length) return 0;
    let score = 0;

    const titleLower = (item.title || "").toLowerCase();
    if (rawQuery && titleLower === rawQuery.toLowerCase()) score += 50;
    if (rawQuery && titleLower.includes(rawQuery.toLowerCase())) score += 20;

    for (const tok of queryTokens) {
      if (!tok) continue;
      if (titleLower.includes(tok)) score += 8;
      if ((item.tags || []).some((t) => t.toLowerCase().includes(tok))) score += 6;
      if (categoryName && categoryName.toLowerCase().includes(tok)) score += 5;
      if (haystack.includes(tok)) score += 2;
    }
    return score;
  }

  // items: array of vault items (active). categories: array of category objects.
  function search(items, categories, query, opts = {}) {
    const { typeFilter = "all", sortBy = "recent-added" } = opts;
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const queryTokens = tokenize(query);

    let results = items;

    if (typeFilter && typeFilter !== "all") {
      results = results.filter((i) => i.type === typeFilter);
    }

    if (queryTokens.length) {
      results = results
        .map((item) => ({
          item,
          score: scoreItem(item, catMap.get(item.categoryId), queryTokens, query),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
        .map((r) => r.item);
    } else {
      results = [...results];
    }

    results = sortItems(results, sortBy, !!queryTokens.length);
    return results;
  }

  function sortItems(items, sortBy, preserveRelevance) {
    if (preserveRelevance && (sortBy === "recent-added" || !sortBy)) {
      return items; // already ranked by relevance
    }
    const arr = [...items];
    switch (sortBy) {
      case "recent-added":
        return arr.sort((a, b) => b.createdAt - a.createdAt);
      case "recent-modified":
        return arr.sort((a, b) => b.updatedAt - a.updatedAt);
      case "oldest":
        return arr.sort((a, b) => a.createdAt - b.createdAt);
      case "az":
        return arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      default:
        return arr;
    }
  }

  return { search, tokenize, sortItems };
})();
