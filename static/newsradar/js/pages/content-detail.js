import { renderMarkdown } from "../markdown.js";

export function initContentDetail(context) {
  const root = document.getElementById("content-detail-root");
  const backLink = document.getElementById("content-back-link");
  const contentId = Number(document.body.dataset.contentId || "0");
  if (!root || !contentId) return;

  const local = {
    item: null,
    loading: false,
    error: null,
    deleting: false,
  };

  function topicLabel(item) {
    const match = context.state.topics.find((topic) => topic.uuid === String(item.topic_uuid));
    return match ? match.term : (item.topic_queries || [])[0] || "Topic";
  }

  function syncSelection() {
    if (!local.item) return;
    const topicUuid = String(local.item.topic_uuid);
    const match = context.state.topics.find((topic) => topic.uuid === topicUuid);
    context.setSelectionState({
      topicUuid,
      groupId: match && match.groupUuid ? match.groupUuid : "",
    });
    if (backLink) {
      backLink.href = `/?topic=${encodeURIComponent(topicUuid)}`;
    }
  }

  function render() {
    if (local.loading) {
      root.innerHTML = '<div class="card p-6 text-sm text-slate-500">Loading content detail...</div>';
      return;
    }
    if (local.error) {
      root.innerHTML = `<div class="card p-6 text-sm text-red-600">${context.utils.escapeHtml(local.error)}</div>`;
      return;
    }
    const item = local.item;
    if (!item) return;
    const published = new Date(item.published_at || item.created_at);
    root.innerHTML = `<article class="card p-6">
      <div class="space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="badge badge-secondary">${context.utils.escapeHtml(item.source || "Unknown")}</span>
            <span class="text-xs text-slate-500">${context.utils.escapeHtml(context.utils.formatDistance(published))}</span>
            <span class="text-xs uppercase tracking-widest text-slate-400">${context.utils.escapeHtml(topicLabel(item))}</span>
          </div>
          <div class="flex items-center gap-1">
            <button type="button" class="btn btn-ghost btn-icon ${item.is_bookmarked ? "text-amber-500" : "text-slate-500"}" data-action="bookmark" aria-label="Toggle bookmark">${item.is_bookmarked ? "*" : "o"}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="share" aria-label="Share content">Link</button>
            <a class="btn btn-ghost btn-sm" href="${context.utils.escapeHtml(item.url)}" target="_blank" rel="noreferrer" aria-label="Open source">Open</a>
            ${context.state.isAuthenticated ? `<button type="button" class="btn btn-ghost btn-icon text-slate-500 hover:text-red-600" data-action="delete" aria-label="Delete content" ${local.deleting ? "disabled" : ""}>x</button>` : ""}
          </div>
        </div>
        <div class="space-y-3">
          <h2 class="text-2xl font-bold leading-tight text-slate-900">${context.utils.escapeHtml(item.title || item.url)}</h2>
          <div class="prose-lite">${renderMarkdown(item.content || item.summary || "Content not available.")}</div>
        </div>
        <div id="share-box" class="hidden rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Share link</p>
          <div class="mt-2 break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">${context.utils.escapeHtml(window.location.href)}</div>
          <p id="share-status" class="mt-2 text-xs text-slate-500"></p>
          <button type="button" class="btn btn-outline btn-sm mt-3" data-action="copy-share">Copy link</button>
        </div>
      </div>
    </article>`;
  }

  async function load() {
    local.loading = true;
    local.error = null;
    render();
    try {
      local.item = await context.api.getContentDetail(contentId);
      syncSelection();
    } catch (error) {
      local.item = null;
      local.error = error instanceof Error ? error.message : "Unable to load content.";
    } finally {
      local.loading = false;
      render();
    }
  }

  async function toggleBookmark() {
    if (!local.item || !context.ensureAuth()) return;
    const previous = local.item.is_bookmarked;
    local.item.is_bookmarked = !previous;
    render();
    try {
      if (local.item.is_bookmarked) {
        await context.api.createBookmark(local.item.id);
      } else {
        await context.api.deleteBookmark(local.item.id);
      }
    } catch (error) {
      local.item.is_bookmarked = previous;
      local.error = error instanceof Error ? error.message : "Unable to update bookmark.";
      render();
    }
  }

  async function deleteContent() {
    if (!local.item || !context.ensureAuth()) return;
    local.deleting = true;
    render();
    try {
      await context.api.deleteContentItem(local.item.id);
      window.location.assign(local.item.topic_uuid ? `/?topic=${encodeURIComponent(local.item.topic_uuid)}` : "/");
    } catch (error) {
      local.error = error instanceof Error ? error.message : "Unable to delete content.";
      local.deleting = false;
      render();
    }
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "bookmark") {
      toggleBookmark();
    }
    if (action.dataset.action === "share") {
      root.querySelector("#share-box")?.classList.toggle("hidden");
    }
    if (action.dataset.action === "copy-share") {
      const status = root.querySelector("#share-status");
      try {
        await navigator.clipboard.writeText(window.location.href);
        if (status) status.textContent = "Link copied.";
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : "Unable to copy the link.";
      }
    }
    if (action.dataset.action === "delete") {
      deleteContent();
    }
  });

  context.subscribe(() => {
    syncSelection();
  });

  load();
}
