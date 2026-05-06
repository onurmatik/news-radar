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

function normalizeGroup(group) {
  return {
    id: group.id,
    uuid: String(group.uuid),
    name: group.name,
    description: group.description || "",
    isActive: group.is_active !== undefined ? Boolean(group.is_active) : group.isActive !== false,
    ownerUsername: group.owner_username,
    isOwner: group.is_owner,
    createdAt: group.created_at ? new Date(group.created_at) : null,
    updatedAt: group.updated_at ? new Date(group.updated_at) : null,
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

function defaultDashboardGroupId() {
  if (state.groups.length) {
    return String(state.groups[0].uuid);
  }
  return "";
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
    if (topic) {
      state.selectedGroupId = topic.groupUuid || "";
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
    if (topic) {
      state.selectedGroupId = topic.groupUuid || "";
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
  try {
    const [groupsResponse, topicsResponse] = await Promise.all([
      api.listTopicGroups(),
      api.listTopics(),
    ]);
    state.groups = (groupsResponse.groups || []).map(normalizeGroup);
    state.topics = (topicsResponse.topics || []).map(normalizeTopic);
    reconcileSelection();
    renderSidebar();
    notify();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to load navigation.", "error");
  }
}

function reconcileSelection() {
  if (state.selectedTopicUuid) {
    const topic = state.topics.find((entry) => entry.uuid === state.selectedTopicUuid);
    if (!topic) {
      state.selectedTopicUuid = null;
    } else {
      state.selectedGroupId = topic.groupUuid || "";
    }
  }
  if (
    state.selectedGroupId
    && !state.groups.some((group) => String(group.uuid) === state.selectedGroupId)
  ) {
    state.selectedGroupId = "";
  }
  if (!state.selectedGroupId && !state.selectedTopicUuid && document.body.dataset.page === "dashboard") {
    state.selectedGroupId = defaultDashboardGroupId();
    if (window.location.pathname === "/" && !window.location.search) {
      window.history.replaceState({}, "", buildDashboardUrl(state.selectedGroupId, null));
    }
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
  if (!groupList) return;

  if (!state.isAuthenticated) {
    groupList.innerHTML = "";
    return;
  }

  groupList.innerHTML = [
    ...state.groups.map((group) => {
      const uuid = String(group.uuid);
      const count = state.topics.filter((topic) => topic.groupUuid === uuid).length;
      const active = state.selectedGroupId === uuid;
      const manageUrl = `/topics?group=${encodeURIComponent(uuid)}&manage=topics`;
      return `<div class="nr-group-card">
        <a href="/?group=${encodeURIComponent(uuid)}" data-group="${escapeHtml(uuid)}" class="nr-group-item ${active ? "is-active" : ""}">
          <p>${escapeHtml(group.name)}</p>
          <span>${count} topics</span>
        </a>
        <a href="${manageUrl}" class="nr-group-edit" aria-label="Manage topics in ${escapeHtml(group.name)}" title="Manage topics">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 20h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="m16.5 3.5 4 4L8 20H4v-4L16.5 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>`;
    }),
  ].join("");
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
      normalizeGroup,
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
