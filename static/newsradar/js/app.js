import { api } from "./api.js";
import { escapeHtml } from "./markdown.js";
import { initDashboard } from "./pages/dashboard.js";
import { initTopics } from "./pages/topics.js";
import { initUpgrade } from "./pages/upgrade.js";
import { initDeveloperAccess } from "./pages/developer-access.js";
import { initContentDetail } from "./pages/content-detail.js";

const state = {
  isAuthenticated: null,
  currentUser: null,
  groups: [],
  topics: [],
  selectedGroupId: "",
  selectedTopicUuid: null,
};

const subscribers = new Set();

function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notify() {
  subscribers.forEach((callback) => callback(state));
}

function normalizeTopic(topic) {
  return {
    id: topic.id,
    uuid: String(topic.uuid),
    monitoringPrompt: topic.monitoring_prompt,
    displayTitle: topic.display_title,
    queries: topic.queries || [],
    term: topic.display_title || (topic.queries || [])[0] || "Untitled",
    isActive: topic.is_active,
    lastSearch: topic.last_fetched_at ? new Date(topic.last_fetched_at) : null,
    hasNewItems: topic.content_source_count > 0,
    groupUuid: topic.group_uuid ? String(topic.group_uuid) : null,
    groupName: topic.group_name,
    ownerUsername: topic.owner_username,
    isOwner: topic.is_owner,
    domainAllowlist: topic.search_domain_allowlist,
    languageFilter: topic.search_language_filter,
    country: topic.country,
    updateFrequency: topic.update_frequency,
    autoEffectiveIntervalHours: topic.auto_effective_interval_hours,
    autoIntervalUpdatedAt: topic.auto_interval_updated_at ? new Date(topic.auto_interval_updated_at) : null,
  };
}

function formatFrequency(topic) {
  switch (topic.updateFrequency) {
    case "auto":
      return `auto${topic.autoEffectiveIntervalHours ? ` / ${topic.autoEffectiveIntervalHours}h` : ""}`;
    case "hour":
      return "hourly";
    case "day":
      return "daily";
    case "week":
      return "weekly";
    default:
      return "manual";
  }
}

function formatDistance(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function parseSelectionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.selectedGroupId = params.get("group") || "";
  state.selectedTopicUuid = params.get("topic") || null;
}

function buildDashboardUrl(groupId, topicUuid) {
  const url = new URL("/", window.location.origin);
  if (topicUuid) {
    url.searchParams.set("topic", topicUuid);
  } else if (groupId) {
    url.searchParams.set("group", groupId);
  }
  return `${url.pathname}${url.search}`;
}

function setSelection({ groupId = "", topicUuid = null, replace = false, navigate = false } = {}) {
  state.selectedGroupId = groupId || "";
  state.selectedTopicUuid = topicUuid || null;
  if (topicUuid) {
    const topic = state.topics.find((entry) => entry.uuid === topicUuid);
    if (topic && topic.groupUuid) {
      state.selectedGroupId = topic.groupUuid;
    }
  }

  if (navigate || window.location.pathname !== "/") {
    window.location.assign(buildDashboardUrl(state.selectedGroupId, state.selectedTopicUuid));
    return;
  }

  const nextUrl = buildDashboardUrl(state.selectedGroupId, state.selectedTopicUuid);
  if (replace) {
    window.history.replaceState({}, "", nextUrl);
  } else {
    window.history.pushState({}, "", nextUrl);
  }
  renderSidebar();
  notify();
}

function setSelectionState({ groupId = "", topicUuid = null } = {}) {
  state.selectedGroupId = groupId || "";
  state.selectedTopicUuid = topicUuid || null;
  if (topicUuid) {
    const topic = state.topics.find((entry) => entry.uuid === topicUuid);
    if (topic && topic.groupUuid) {
      state.selectedGroupId = topic.groupUuid;
    }
  }
  renderSidebar();
  notify();
}

function showToast(message, tone = "default") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden", "border-red-200", "bg-red-50", "text-red-700");
  if (tone === "error") {
    toast.classList.add("border-red-200", "bg-red-50", "text-red-700");
  }
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  const focusTarget = modal.querySelector("input, button, textarea, select");
  if (focusTarget) focusTarget.focus();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
}

function openAuthModal() {
  const form = document.getElementById("auth-form");
  const success = document.getElementById("auth-success");
  const error = document.getElementById("auth-error");
  if (form) form.classList.remove("hidden");
  if (success) success.classList.add("hidden");
  if (error) error.classList.add("hidden");
  openModal("auth-modal");
}

function ensureAuth() {
  if (state.isAuthenticated) return true;
  openAuthModal();
  return false;
}

async function refreshAuth() {
  try {
    state.currentUser = await api.getCurrentUser();
    state.isAuthenticated = true;
  } catch {
    state.currentUser = null;
    state.isAuthenticated = false;
  }
  renderAuthState();
  notify();
}

async function loadNavigation() {
  if (!state.isAuthenticated) {
    state.groups = [];
    state.topics = [];
    renderSidebar();
    notify();
    return;
  }
  const status = document.getElementById("topic-list-status");
  if (status) {
    status.textContent = "Loading topics...";
    status.classList.remove("hidden", "text-red-600");
  }
  try {
    const [groupsResponse, topicsResponse] = await Promise.all([
      api.listTopicGroups(),
      api.listTopics(),
    ]);
    state.groups = groupsResponse.groups || [];
    state.topics = (topicsResponse.topics || []).map(normalizeTopic);
    reconcileSelection();
    renderSidebar();
    notify();
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : "Unable to load topics.";
      status.classList.remove("hidden");
      status.classList.add("text-red-600");
    }
  }
}

function reconcileSelection() {
  if (state.selectedTopicUuid) {
    const topic = state.topics.find((entry) => entry.uuid === state.selectedTopicUuid);
    if (!topic) {
      state.selectedTopicUuid = null;
    } else if (topic.groupUuid) {
      state.selectedGroupId = topic.groupUuid;
    }
  }
  if (state.selectedGroupId && !state.groups.some((group) => String(group.uuid) === state.selectedGroupId)) {
    state.selectedGroupId = "";
  }
}

function renderAuthState() {
  const userLabel = document.getElementById("sidebar-user-label");
  const signIn = document.getElementById("sign-in-button");
  const signOut = document.getElementById("sign-out-button");
  if (userLabel) {
    userLabel.textContent = state.currentUser ? state.currentUser.email || state.currentUser.username : "Sign in to manage your radar";
  }
  signIn?.classList.toggle("hidden", state.isAuthenticated === true);
  signOut?.classList.toggle("hidden", state.isAuthenticated !== true);
}

function renderSidebar() {
  renderAuthState();
  const groupList = document.getElementById("group-list");
  const topicList = document.getElementById("topic-list");
  const topicStatus = document.getElementById("topic-list-status");
  const visibleTopicCount = document.getElementById("visible-topic-count");
  const selectedGroupPanel = document.getElementById("selected-group-panel");
  if (!groupList || !topicList || !topicStatus || !visibleTopicCount || !selectedGroupPanel) return;

  if (!state.isAuthenticated) {
    groupList.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Sign in to load topic groups.</div>';
    topicList.innerHTML = "";
    topicStatus.textContent = "No session yet.";
    topicStatus.classList.remove("hidden");
    visibleTopicCount.textContent = "0 topics visible";
    selectedGroupPanel.classList.add("hidden");
    return;
  }

  const selectedGroup = state.groups.find((group) => String(group.uuid) === state.selectedGroupId) || null;
  const filteredTopics = state.selectedGroupId
    ? state.topics.filter((topic) => topic.groupUuid === state.selectedGroupId)
    : state.topics;
  visibleTopicCount.textContent = `${filteredTopics.length} topics visible`;

  const allActive = !state.selectedGroupId && !state.selectedTopicUuid;
  groupList.innerHTML = [
    `<a href="/" data-group="" class="block w-full rounded-2xl px-4 py-3 text-left transition-colors ${allActive ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100"}">
      <p class="text-sm font-semibold">All topics</p>
      <p class="mt-1 text-xs text-slate-500">${state.topics.length} topics</p>
    </a>`,
    ...state.groups.map((group) => {
      const uuid = String(group.uuid);
      const count = state.topics.filter((topic) => topic.groupUuid === uuid).length;
      const active = state.selectedGroupId === uuid && !state.selectedTopicUuid;
      return `<a href="/?group=${encodeURIComponent(uuid)}" data-group="${escapeHtml(uuid)}" class="block w-full rounded-2xl px-4 py-3 text-left transition-colors ${active ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100"}">
        <p class="text-sm font-semibold">${escapeHtml(group.name)}</p>
        <p class="mt-1 text-xs text-slate-500">${count} topics</p>
      </a>`;
    }),
  ].join("");

  if (selectedGroup) {
    selectedGroupPanel.classList.remove("hidden");
    selectedGroupPanel.innerHTML = `<div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-slate-900">${escapeHtml(selectedGroup.name)}</p>
        <p class="mt-1 text-xs text-slate-500">Visual organization only. Topics keep their own filters and frequency.</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-edit-group="${escapeHtml(String(selectedGroup.uuid))}">Edit</button>
    </div>`;
  } else {
    selectedGroupPanel.classList.add("hidden");
  }

  if (!filteredTopics.length) {
    topicStatus.textContent = state.selectedGroupId ? "No topics in this group yet." : "No topics yet. Create one to start monitoring.";
    topicStatus.classList.remove("hidden");
    topicList.innerHTML = "";
  } else {
    topicStatus.classList.add("hidden");
    topicList.innerHTML = filteredTopics.map((topic) => {
      const active = state.selectedTopicUuid === topic.uuid && document.body.dataset.page === "dashboard";
      return `<a href="/?topic=${encodeURIComponent(topic.uuid)}" data-topic="${escapeHtml(topic.uuid)}" class="block w-full rounded-2xl border px-4 py-3 text-left transition-colors ${active ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(topic.term)}</p>
            <p class="mt-1 text-xs text-slate-500">${escapeHtml(formatFrequency(topic))}</p>
          </div>
          ${topic.hasNewItems ? '<span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"></span>' : ""}
        </div>
      </a>`;
    }).join("");
  }
}

function openGroupModal(group = null) {
  const title = document.getElementById("group-modal-title");
  const description = document.getElementById("group-modal-description");
  const uuid = document.getElementById("group-uuid");
  const name = document.getElementById("group-name");
  const groupDescription = document.getElementById("group-description");
  const deleteButton = document.getElementById("delete-group-button");
  const error = document.getElementById("group-error");
  if (!title || !description || !uuid || !name || !groupDescription || !deleteButton || !error) return;

  title.textContent = group ? "Edit group" : "Create group";
  description.textContent = group ? "Rename or delete this visual topic bucket." : "Groups are optional visual buckets for organizing related topics.";
  uuid.value = group ? String(group.uuid) : "";
  name.value = group ? group.name || "" : "";
  groupDescription.value = group ? group.description || "" : "";
  deleteButton.classList.toggle("hidden", !group);
  error.classList.add("hidden");
  openModal("group-modal");
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-modal-close]");
    if (closeButton) {
      closeModal(closeButton.dataset.modalClose);
      return;
    }

    if (event.target.matches("[data-open-auth]")) {
      openAuthModal();
      return;
    }

    const groupLink = event.target.closest("[data-group]");
    if (groupLink) {
      event.preventDefault();
      setSelection({ groupId: groupLink.dataset.group || "", topicUuid: null, navigate: window.location.pathname !== "/" });
      return;
    }

    const topicLink = event.target.closest("[data-topic]");
    if (topicLink) {
      event.preventDefault();
      setSelection({ topicUuid: topicLink.dataset.topic, navigate: window.location.pathname !== "/" });
      return;
    }

    const editGroup = event.target.closest("[data-edit-group]");
    if (editGroup) {
      const group = state.groups.find((entry) => String(entry.uuid) === editGroup.dataset.editGroup);
      if (group) openGroupModal(group);
    }
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  window.addEventListener("popstate", () => {
    parseSelectionFromUrl();
    reconcileSelection();
    renderSidebar();
    notify();
  });

  document.getElementById("sign-in-button")?.addEventListener("click", openAuthModal);
  document.getElementById("add-topic-button")?.addEventListener("click", () => {
    if (!ensureAuth()) return;
    const url = new URL("/topics", window.location.origin);
    if (state.selectedGroupId) {
      url.searchParams.set("group", state.selectedGroupId);
    }
    window.location.assign(`${url.pathname}${url.search}`);
  });
  document.getElementById("create-group-button")?.addEventListener("click", () => {
    if (!ensureAuth()) return;
    openGroupModal();
  });
  document.getElementById("sign-out-button")?.addEventListener("click", async () => {
    try {
      await api.logout();
    } finally {
      state.currentUser = null;
      state.isAuthenticated = false;
      state.groups = [];
      state.topics = [];
      state.selectedGroupId = "";
      state.selectedTopicUuid = null;
      renderSidebar();
      notify();
      showToast("Signed out.");
    }
  });

  document.getElementById("auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById("auth-submit");
    const email = form.elements.email.value.trim();
    const error = document.getElementById("auth-error");
    if (!email) return;
    submit.disabled = true;
    submit.textContent = "Sending...";
    error?.classList.add("hidden");
    try {
      await api.requestMagicLink(email, window.location.href);
      form.classList.add("hidden");
      const success = document.getElementById("auth-success");
      const message = document.getElementById("auth-success-message");
      if (message) {
        message.textContent = `We sent a magic link to ${email}. Click the link to sign in instantly.`;
      }
      success?.classList.remove("hidden");
    } catch (requestError) {
      if (error) {
        error.textContent = requestError instanceof Error ? requestError.message : "Unable to send magic link.";
        error.classList.remove("hidden");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Send magic link";
    }
  });

  document.getElementById("auth-reset")?.addEventListener("click", () => {
    document.getElementById("auth-success")?.classList.add("hidden");
    document.getElementById("auth-form")?.classList.remove("hidden");
    document.getElementById("auth-error")?.classList.add("hidden");
  });

  document.getElementById("group-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const uuid = document.getElementById("group-uuid")?.value || "";
    const name = document.getElementById("group-name")?.value.trim() || "";
    const description = document.getElementById("group-description")?.value.trim() || "";
    const error = document.getElementById("group-error");
    const saveButton = document.getElementById("save-group-button");
    if (!name) {
      if (error) {
        error.textContent = "Group name cannot be empty.";
        error.classList.remove("hidden");
      }
      return;
    }
    saveButton.disabled = true;
    try {
      const response = uuid
        ? await api.updateTopicGroup(uuid, { name, description })
        : await api.createTopicGroup({ name, description });
      closeModal("group-modal");
      await loadNavigation();
      if (!uuid && response.group) {
        setSelectionState({ groupId: String(response.group.uuid), topicUuid: null });
      }
    } catch (requestError) {
      if (error) {
        error.textContent = requestError instanceof Error ? requestError.message : "Unable to save group.";
        error.classList.remove("hidden");
      }
    } finally {
      saveButton.disabled = false;
    }
  });

  document.getElementById("delete-group-button")?.addEventListener("click", async () => {
    const uuid = document.getElementById("group-uuid")?.value || "";
    if (!uuid) return;
    if (!window.confirm("Delete this group? Topics in the group will keep their own filters.")) return;
    try {
      await api.deleteTopicGroup(uuid);
      if (state.selectedGroupId === uuid) {
        state.selectedGroupId = "";
        state.selectedTopicUuid = null;
      }
      closeModal("group-modal");
      await loadNavigation();
      showToast("Group deleted.");
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : "Unable to delete group.", "error");
    }
  });
}

function initPage(context) {
  switch (document.body.dataset.page) {
    case "dashboard":
      initDashboard(context);
      break;
    case "topics":
      initTopics(context);
      break;
    case "upgrade":
      initUpgrade(context);
      break;
    case "developer-access":
      initDeveloperAccess(context);
      break;
    case "content-detail":
      initContentDetail(context);
      break;
    default:
      break;
  }
}

async function init() {
  parseSelectionFromUrl();
  bindGlobalEvents();

  const context = {
    api,
    state,
    subscribe,
    ensureAuth,
    openAuthModal,
    showToast,
    reloadNavigation: loadNavigation,
    setSelection,
    setSelectionState,
    renderSidebar,
    utils: {
      escapeHtml,
      formatDistance,
      normalizeTopic,
      formatFrequency,
    },
  };

  await refreshAuth();
  await loadNavigation();
  initPage(context);
}

init().catch((error) => {
  showToast(error instanceof Error ? error.message : "Unable to start NewsRadar.", "error");
});
