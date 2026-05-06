import { renderMarkdown } from "../markdown.js";

const AI_PRESETS = [
  {
    label: "Summarize",
    instruction: "Summarize the key developments in these news items.",
  },
  {
    label: "List facts",
    instruction: "List the most actionable facts as concise bullet points.",
  },
  {
    label: "List entities",
    instruction: "List the key people, companies, organizations, and places mentioned.",
  },
  {
    label: "Risks & opportunities",
    instruction: "Highlight risks, opportunities, and open questions.",
  },
];

function mapNewsItem(item) {
  const timestamp = new Date(item.published_at || item.created_at);
  const fetchedAt = new Date(item.created_at);
  return {
    id: item.id,
    title: item.title || item.url,
    summary: item.summary || "Summary not available.",
    source: item.source || "Unknown",
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    fetchedAt: Number.isNaN(fetchedAt.getTime()) ? new Date() : fetchedAt,
    relevanceScore: item.relevance_score || 0,
    topicUuid: item.topic_uuid ? String(item.topic_uuid) : "",
    topicDisplayTitle: item.topic_display_title || (item.topic_queries || [])[0] || "Untitled topic",
    keywords: item.topic_queries || [],
    url: item.url,
    isBookmarked: Boolean(item.is_bookmarked),
  };
}

export function initDashboard(context) {
  const heading = document.getElementById("dashboard-heading");
  const subtitle = document.getElementById("dashboard-subtitle");
  const signedOut = document.getElementById("dashboard-signed-out");
  const dashboardContent = document.getElementById("dashboard-content");
  const selectedTopicActions = document.getElementById("selected-topic-actions");
  const editSelectedTopic = document.getElementById("edit-selected-topic");
  const scanSelectedTopic = document.getElementById("scan-selected-topic");
  const searchInput = document.getElementById("feed-search");
  const newOnlyButton = document.getElementById("new-only-filter");
  const bookmarkedButton = document.getElementById("bookmarked-filter");
  const domainFiltersRoot = document.getElementById("domain-filters");
  const feedError = document.getElementById("feed-error");
  const feedList = document.getElementById("feed-list");
  const feedResultCount = document.getElementById("feed-result-count");
  const aiPresets = document.getElementById("ai-presets");
  const aiInstruction = document.getElementById("ai-instruction");
  const aiOutput = document.getElementById("ai-output");
  const aiContextCount = document.getElementById("ai-context-count");
  const runAiButton = document.getElementById("run-ai-analysis");

  const local = {
    items: [],
    loading: false,
    error: null,
    searchTerm: "",
    debouncedSearchTerm: "",
    newOnly: false,
    bookmarkedOnly: false,
    domainFilters: [],
    aiInstruction: AI_PRESETS[0].instruction,
    scanning: false,
  };

  let searchTimer = null;
  let lastFeedKey = "";

  function selectedTopic() {
    return context.state.selectedTopicUuid
      ? context.state.topics.find((topic) => topic.uuid === context.state.selectedTopicUuid) || null
      : null;
  }

  function selectedGroupName() {
    if (!context.state.selectedGroupId) return "Collections";
    const group = context.state.groups.find((entry) => String(entry.uuid) === context.state.selectedGroupId);
    return group ? group.name : "Collections";
  }

  function selectedGroupTopicCount() {
    if (!context.state.selectedGroupId) return 0;
    return context.state.topics.filter((topic) => topic.groupUuid === context.state.selectedGroupId).length;
  }

  function feedKey() {
    return JSON.stringify({
      auth: context.state.isAuthenticated,
      group: context.state.selectedGroupId,
      topic: context.state.selectedTopicUuid,
      newOnly: local.newOnly,
      search: local.debouncedSearchTerm,
    });
  }

  function filteredItems() {
    return local.items.filter((item) => {
      if (local.domainFilters.length && !local.domainFilters.includes(item.source)) return false;
      if (local.bookmarkedOnly && !item.isBookmarked) return false;
      return true;
    });
  }

  function setError(message) {
    local.error = message || null;
    if (!feedError) return;
    if (local.error) {
      feedError.textContent = local.error;
      feedError.classList.remove("hidden");
    } else {
      feedError.classList.add("hidden");
    }
  }

  function renderHeading() {
    const topic = selectedTopic();
    const label = topic ? topic.term : selectedGroupName();
    if (heading) heading.textContent = label;
    if (subtitle) {
      subtitle.textContent = topic
        ? `Monitoring prompt: ${topic.monitoringPrompt}`
        : "Browse the latest saved search results in this collection.";
    }
    selectedTopicActions?.classList.add("hidden");
    if (editSelectedTopic && topic) {
      editSelectedTopic.href = `/topics?edit=${encodeURIComponent(topic.uuid)}`;
    }
  }

  function renderAuthState() {
    signedOut?.classList.add("hidden");
    dashboardContent?.classList.remove("hidden");
  }

  function renderDomainFilters() {
    if (!domainFiltersRoot) return;
    const domains = Array.from(new Set(local.items.map((item) => item.source).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    domainFiltersRoot.innerHTML = [
      `<button type="button" class="nr-filter-pill ${local.domainFilters.length ? "" : "is-active"}" data-domain-clear>All domains (${local.items.length})</button>`,
      ...domains.map((domain) => {
        const active = local.domainFilters.includes(domain);
        return `<button type="button" class="nr-filter-pill ${active ? "is-active" : ""}" data-domain="${context.utils.escapeHtml(domain)}">${context.utils.escapeHtml(domain)}</button>`;
      }),
    ].join("");
  }

  function renderFeed() {
    if (!feedList) return;
    renderAuthState();
    renderHeading();
    setError(local.error);
    newOnlyButton?.classList.toggle("btn-secondary", local.newOnly);
    newOnlyButton?.classList.toggle("btn-outline", !local.newOnly);
    newOnlyButton?.classList.toggle("is-active", local.newOnly);
    bookmarkedButton?.classList.toggle("btn-secondary", local.bookmarkedOnly);
    bookmarkedButton?.classList.toggle("btn-outline", !local.bookmarkedOnly);
    bookmarkedButton?.classList.toggle("is-active", local.bookmarkedOnly);
    renderDomainFilters();

    if (local.loading) {
      feedList.innerHTML = '<div class="nr-loading-card">Loading content feed...</div>';
      return;
    }
    const items = filteredItems();
    if (feedResultCount) {
      feedResultCount.textContent = `${items.length} ${items.length === 1 ? "result" : "results"}`;
    }
    if (aiContextCount) {
      aiContextCount.textContent = `Context: ${items.length} ${items.length === 1 ? "item" : "items"}`;
    }
    if (!items.length) {
      const hasTopics = context.state.topics.length > 0;
      feedList.innerHTML = `<div class="nr-empty-feed">
        <div class="nr-empty-state">
          <div class="nr-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 8.4v7.2M8.4 12h7.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <p>${hasTopics ? "No matching content" : "No topics created"}</p>
          <span>${hasTopics ? "Try changing filters or manage the topics in this collection." : "Create a topic to start monitoring news."}</span>
          <button type="button" class="nr-empty-button" data-empty-manage-topics>Manage topics</button>
        </div>
      </div>`;
      return;
    }
    const showTopicLabels = !context.state.selectedTopicUuid && selectedGroupTopicCount() > 1;
    feedList.innerHTML = items.map((item) => `<article class="nr-content-card">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            ${showTopicLabels && item.topicUuid ? `<a href="/?topic=${encodeURIComponent(item.topicUuid)}" data-topic="${context.utils.escapeHtml(item.topicUuid)}" class="nr-content-topic">${context.utils.escapeHtml(item.topicDisplayTitle)}</a>` : ""}
            <span class="badge badge-secondary">${context.utils.escapeHtml(item.source)}</span>
            <span class="text-xs text-slate-500">${context.utils.escapeHtml(context.utils.formatDistance(item.timestamp))}</span>
          </div>
          <a href="/content/${item.id}/full" class="block text-2xl font-bold leading-tight text-slate-900 transition-colors hover:text-emerald-700">${context.utils.escapeHtml(item.title)}</a>
          <p class="text-sm leading-relaxed text-slate-600">${context.utils.escapeHtml(item.summary)}</p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-ghost btn-icon ${item.isBookmarked ? "text-amber-500" : "text-slate-400"}" data-bookmark="${item.id}" aria-label="Toggle bookmark">${item.isBookmarked ? "*" : "o"}</button>
          <a class="btn btn-ghost btn-sm" href="${context.utils.escapeHtml(item.url)}" target="_blank" rel="noreferrer" aria-label="Open source">Open</a>
          <button type="button" class="btn btn-ghost btn-icon text-slate-400 hover:text-red-600" data-delete="${item.id}" aria-label="Delete content">x</button>
        </div>
      </div>
      ${item.keywords.length ? `<div class="mt-4 flex flex-wrap gap-2">${item.keywords.slice(0, 5).map((keyword) => `<span class="badge badge-outline">${context.utils.escapeHtml(keyword)}</span>`).join("")}</div>` : ""}
    </article>`).join("");
  }

  async function loadFeed({ force = false } = {}) {
    renderHeading();
    renderAuthState();
    if (context.state.isAuthenticated !== true) {
      local.items = [];
      local.loading = false;
      renderFeed();
      return;
    }
    const currentKey = feedKey();
    if (!force && currentKey === lastFeedKey) {
      renderFeed();
      return;
    }
    lastFeedKey = currentKey;
    local.loading = true;
    setError(null);
    renderFeed();
    try {
      const response = context.state.selectedTopicUuid
        ? await context.api.listContentFeed({
            topicUuid: context.state.selectedTopicUuid,
            onlyNew: local.newOnly,
            search: local.debouncedSearchTerm || undefined,
          })
        : context.state.selectedGroupId
          ? await context.api.listContentByGroup(context.state.selectedGroupId, {
              onlyNew: local.newOnly,
              search: local.debouncedSearchTerm || undefined,
            })
          : await context.api.listContentFeed({
              onlyNew: local.newOnly,
              search: local.debouncedSearchTerm || undefined,
            });
      local.items = (response.items || []).map(mapNewsItem);
      local.domainFilters = local.domainFilters.filter((domain) => local.items.some((item) => item.source === domain));
    } catch (error) {
      local.items = [];
      setError(error instanceof Error ? error.message : "Unable to load content feed.");
    } finally {
      local.loading = false;
      renderFeed();
    }
  }

  async function waitForExecutionCompletion(executionId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const execution = await context.api.getExecution(executionId);
      if (execution.status === "completed") return execution;
      if (execution.status === "failed") {
        throw new Error(execution.error_message || "Scan failed.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Timed out waiting for the scan to finish.");
  }

  async function handleScanNow() {
    const topic = selectedTopic();
    if (!topic || !context.ensureAuth()) return;
    local.scanning = true;
    scanSelectedTopic.disabled = true;
    scanSelectedTopic.textContent = "Scanning...";
    setError(null);
    try {
      const { execution_id: executionId } = await context.api.runTopicScan(topic.uuid);
      await waitForExecutionCompletion(executionId);
      await context.reloadNavigation();
      await loadFeed({ force: true });
      context.showToast("Scan completed.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to scan this topic.");
    } finally {
      local.scanning = false;
      scanSelectedTopic.disabled = false;
      scanSelectedTopic.textContent = "Scan now";
    }
  }

  async function toggleBookmark(id) {
    if (!context.ensureAuth()) return;
    const item = local.items.find((entry) => entry.id === id);
    if (!item) return;
    const previous = item.isBookmarked;
    item.isBookmarked = !previous;
    renderFeed();
    try {
      if (item.isBookmarked) {
        await context.api.createBookmark(id);
      } else {
        await context.api.deleteBookmark(id);
      }
    } catch (error) {
      item.isBookmarked = previous;
      setError(error instanceof Error ? error.message : "Unable to update bookmark.");
      renderFeed();
    }
  }

  async function deleteContent(id) {
    if (!context.ensureAuth()) return;
    try {
      await context.api.deleteContentItem(id);
      local.items = local.items.filter((entry) => entry.id !== id);
      renderFeed();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to delete content.");
    }
  }

  function renderAiPresets() {
    if (!aiPresets || !aiInstruction) return;
    aiInstruction.value = local.aiInstruction;
    aiPresets.innerHTML = AI_PRESETS.map((preset) => `<button type="button" class="nr-ai-preset ${preset.instruction === local.aiInstruction ? "is-active" : ""}" data-ai-preset="${context.utils.escapeHtml(preset.instruction)}">${context.utils.escapeHtml(preset.label)}</button>`).join("");
  }

  async function runAiAnalysis() {
    if (!context.ensureAuth()) return;
    const contentIds = filteredItems().map((item) => item.id);
    if (!contentIds.length) {
      setError("No content in the current feed to analyze.");
      return;
    }
    runAiButton.disabled = true;
    runAiButton.classList.add("is-running");
    setError(null);
    try {
      const response = await context.api.requestContentAIResponse({
        contentIds,
        instruction: local.aiInstruction,
      });
      if (aiOutput) {
        aiOutput.innerHTML = renderMarkdown(response.answer || "");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to run AI analysis.");
    } finally {
      runAiButton.disabled = false;
      runAiButton.classList.remove("is-running");
    }
  }

  searchInput?.addEventListener("input", () => {
    local.searchTerm = searchInput.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      local.debouncedSearchTerm = local.searchTerm.trim();
      loadFeed();
    }, 250);
  });

  newOnlyButton?.addEventListener("click", () => {
    if (!context.ensureAuth()) return;
    local.newOnly = !local.newOnly;
    loadFeed({ force: true });
  });

  bookmarkedButton?.addEventListener("click", () => {
    if (!context.ensureAuth()) return;
    local.bookmarkedOnly = !local.bookmarkedOnly;
    renderFeed();
  });

  domainFiltersRoot?.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-domain-clear]");
    if (clear) {
      local.domainFilters = [];
      renderFeed();
      return;
    }
    const button = event.target.closest("[data-domain]");
    if (!button) return;
    const domain = button.dataset.domain;
    local.domainFilters = local.domainFilters.includes(domain)
      ? local.domainFilters.filter((entry) => entry !== domain)
      : [...local.domainFilters, domain];
    renderFeed();
  });

  feedList?.addEventListener("click", (event) => {
    const manageTopics = event.target.closest("[data-empty-manage-topics]");
    if (manageTopics) {
      if (!context.ensureAuth()) return;
      const url = new URL("/topics", window.location.origin);
      if (context.state.selectedGroupId) {
        url.searchParams.set("group", context.state.selectedGroupId);
        url.searchParams.set("manage", "topics");
      }
      window.location.assign(`${url.pathname}${url.search}`);
      return;
    }
    const bookmark = event.target.closest("[data-bookmark]");
    if (bookmark) {
      toggleBookmark(Number(bookmark.dataset.bookmark));
      return;
    }
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      deleteContent(Number(deleteButton.dataset.delete));
    }
  });

  scanSelectedTopic?.addEventListener("click", handleScanNow);
  runAiButton?.addEventListener("click", runAiAnalysis);
  aiInstruction?.addEventListener("input", () => {
    local.aiInstruction = aiInstruction.value;
    renderAiPresets();
  });
  aiPresets?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ai-preset]");
    if (!button) return;
    local.aiInstruction = button.dataset.aiPreset;
    renderAiPresets();
  });

  context.subscribe(() => {
    renderHeading();
    loadFeed();
  });

  renderAiPresets();
  renderHeading();
  loadFeed({ force: true });
}
