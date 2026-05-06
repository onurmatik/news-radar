const COUNTRY_OPTIONS = [
  ["", "All countries"],
  ["AU", "Australia"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CN", "China"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["IN", "India"],
  ["JP", "Japan"],
  ["SG", "Singapore"],
  ["TR", "Turkey"],
  ["US", "United States"],
];

const EMPTY_DRAFT = {
  monitoringPrompt: "",
  displayTitle: "",
  queries: [""],
  suggestedDomains: [],
  topicWarning: null,
  limitToSelectedDomains: false,
  domainAllowlist: [""],
  languageFilter: [""],
  country: "",
  updateFrequency: "auto",
  autoEffectiveIntervalHours: 24,
};

function cloneDraft(source = EMPTY_DRAFT) {
  return {
    ...source,
    queries: [...(source.queries || [""])],
    suggestedDomains: [...(source.suggestedDomains || [])],
    domainAllowlist: [...(source.domainAllowlist || [""])],
    languageFilter: [...(source.languageFilter || [""])],
  };
}

function toDraftFromTopic(topic) {
  const existingDomains = topic.domainAllowlist && topic.domainAllowlist.length ? topic.domainAllowlist : [""];
  return {
    monitoringPrompt: topic.monitoringPrompt,
    displayTitle: topic.displayTitle,
    queries: topic.queries.length ? topic.queries : [""],
    suggestedDomains: topic.domainAllowlist && topic.domainAllowlist.length ? topic.domainAllowlist : [],
    topicWarning: null,
    limitToSelectedDomains: Boolean(topic.domainAllowlist && topic.domainAllowlist.length),
    domainAllowlist: existingDomains,
    languageFilter: topic.languageFilter && topic.languageFilter.length ? topic.languageFilter : [""],
    country: topic.country || "",
    updateFrequency: topic.updateFrequency,
    autoEffectiveIntervalHours: topic.autoEffectiveIntervalHours || 24,
  };
}

function toDraftFromSplitSuggestion(suggestion) {
  const suggestedDomains = normalizeList(suggestion.suggested_domains || []);
  return {
    monitoringPrompt: suggestion.monitoring_prompt || "",
    displayTitle: suggestion.display_title || suggestion.monitoring_prompt || "",
    queries: suggestion.query_variations && suggestion.query_variations.length ? suggestion.query_variations : [suggestion.monitoring_prompt || ""],
    suggestedDomains,
    topicWarning: suggestion.topic_warning || null,
    limitToSelectedDomains: suggestedDomains.length > 0,
    domainAllowlist: ensureAtLeastOne(suggestedDomains),
    languageFilter: suggestion.search_language_filter && suggestion.search_language_filter.length ? suggestion.search_language_filter : [""],
    country: suggestion.country || "",
    updateFrequency: "auto",
    autoEffectiveIntervalHours: 24,
  };
}

function normalizeList(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function ensureAtLeastOne(values) {
  return values.length ? values : [""];
}

function buildFeedbackItems(previewResults, previewReactions) {
  return previewResults.flatMap((item) => {
    const reaction = previewReactions[item.url];
    if (reaction !== "up" && reaction !== "down") return [];
    return [{
      url: item.url,
      title: item.title,
      snippet: item.snippet,
      domain: item.domain,
      reaction,
    }];
  });
}

export function initTopics(context) {
  const root = document.getElementById("topic-form-root");
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  const editUuid = params.get("edit");
  const preselectedGroup = params.get("group") || context.state.selectedGroupId || "";
  const state = {
    mode: editUuid ? "edit" : "create",
    topicUuid: editUuid,
    stage: editUuid ? "review" : "prompt",
    draft: cloneDraft(EMPTY_DRAFT),
    groupUuid: preselectedGroup,
    groupNameDraft: "",
    suggestedGroupName: "",
    error: null,
    busy: null,
    lastOrganizedPrompt: "",
    previewResults: [],
    previewReactions: {},
    previewHasRun: false,
    extraDrafts: [],
    splitDrafts: [],
    initializedForTopic: null,
  };

  function activeTopic() {
    if (!state.topicUuid) return null;
    return context.state.topics.find((topic) => topic.uuid === state.topicUuid) || null;
  }

  function normalizedQueries() {
    return normalizeList(state.draft.queries);
  }

  function normalizedDomains() {
    return state.draft.limitToSelectedDomains ? normalizeList(state.draft.domainAllowlist) : [];
  }

  function normalizedLanguages() {
    return normalizeList(state.draft.languageFilter);
  }

  function hasPendingPromptChanges() {
    return state.draft.monitoringPrompt.trim() !== state.lastOrganizedPrompt.trim();
  }

  function feedbackItems() {
    return buildFeedbackItems(state.previewResults, state.previewReactions);
  }

  function syncFromActiveTopic() {
    if (state.mode !== "edit") return;
    const topic = activeTopic();
    if (!topic || state.initializedForTopic === topic.uuid) return;
    state.draft = cloneDraft(toDraftFromTopic(topic));
    state.groupUuid = topic.groupUuid || "";
    state.groupNameDraft = topic.groupName || "";
    state.suggestedGroupName = "";
    state.lastOrganizedPrompt = topic.monitoringPrompt;
    state.stage = "review";
    state.previewResults = [];
    state.previewReactions = {};
    state.previewHasRun = false;
    state.extraDrafts = [];
    state.splitDrafts = [];
    state.initializedForTopic = topic.uuid;
  }

  function readDraftList(index, name) {
    return Array.from(root.querySelectorAll(`[data-draft-list="${name}"][data-draft-index="${index}"]`)).map((input) => input.value);
  }

  function collectTopicDraftFromDom(index, fallback) {
    const monitoringPrompt = root.querySelector(`[data-draft-prompt="${index}"]`);
    const displayTitle = root.querySelector(`[data-draft-title="${index}"]`);
    const country = root.querySelector(`[data-draft-country="${index}"]`);
    return {
      ...fallback,
      monitoringPrompt: monitoringPrompt ? monitoringPrompt.value : fallback.monitoringPrompt,
      displayTitle: displayTitle ? displayTitle.value : fallback.displayTitle,
      queries: ensureAtLeastOne(readDraftList(index, "queries")),
      domainAllowlist: ensureAtLeastOne(readDraftList(index, "domainAllowlist")),
      limitToSelectedDomains: fallback.limitToSelectedDomains,
      languageFilter: ensureAtLeastOne(readDraftList(index, "languageFilter")),
      country: country ? country.value : fallback.country,
    };
  }

  function collectDraftFromDom() {
    const cardPrompt = root.querySelector('[data-draft-prompt="0"]');
    const monitoringPrompt = root.querySelector("[name='monitoringPrompt']");
    const groupName = root.querySelector("[name='groupName']");

    if (cardPrompt) {
      state.groupNameDraft = groupName ? groupName.value : state.groupNameDraft;
      state.draft = collectTopicDraftFromDom(0, state.draft);
      state.extraDrafts = state.extraDrafts.map((draft, index) => collectTopicDraftFromDom(index + 1, draft));
      return;
    }

    state.draft.monitoringPrompt = monitoringPrompt ? monitoringPrompt.value : state.draft.monitoringPrompt;
    state.groupNameDraft = groupName ? groupName.value : state.groupNameDraft;
  }

  function collectSplitDraftsFromDom() {
    const groupName = root.querySelector("[name='splitGroupName']");
    state.groupNameDraft = groupName ? groupName.value : state.groupNameDraft;
    state.splitDrafts = state.splitDrafts.map((entry, index) => {
      const selected = root.querySelector(`[data-draft-selected="${index}"]`);
      return {
        ...entry,
        selected: selected ? selected.checked : entry.selected,
        draft: collectTopicDraftFromDom(index, entry.draft),
      };
    });
  }

  function buildTopicPayload(draft, { groupUuid = "", isActive = true } = {}) {
    const queries = normalizeList(draft.queries);
    return {
      monitoringPrompt: draft.monitoringPrompt.trim(),
      displayTitle: draft.displayTitle.trim(),
      primaryQuery: queries[0],
      queryVariations: queries.slice(1),
      groupUuid: groupUuid || null,
      domainAllowlist: draft.limitToSelectedDomains ? normalizeList(draft.domainAllowlist) : null,
      languageFilter: normalizeList(draft.languageFilter),
      country: (draft.country || "").trim() || null,
      updateFrequency: draft.updateFrequency,
      autoEffectiveIntervalHours: draft.autoEffectiveIntervalHours || null,
      isActive,
    };
  }

  function validateTopicDraft(draft, label = "Topic") {
    if (!draft.monitoringPrompt.trim()) return `${label}: monitoring prompt cannot be empty.`;
    if (!draft.displayTitle.trim()) return `${label}: title cannot be empty.`;
    if (!normalizeList(draft.queries).length) return `${label}: add at least one query.`;
    return null;
  }

  function findGroupByName(name) {
    const normalizedName = String(name || "").trim().toLowerCase();
    if (!normalizedName) return null;
    return context.state.groups.find((group) => String(group.name || "").trim().toLowerCase() === normalizedName) || null;
  }

  function groupNameForUuid(uuid) {
    const group = context.state.groups.find((entry) => String(entry.uuid) === String(uuid));
    return group ? group.name : "";
  }

  async function resolveGroupUuid() {
    const groupName = String(state.groupNameDraft || "").trim();
    if (!groupName) return null;

    const existingGroup = findGroupByName(groupName);
    if (existingGroup) return String(existingGroup.uuid);

    try {
      const response = await context.api.createTopicGroup({ name: groupName, description: "" });
      return response.group ? String(response.group.uuid) : null;
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("already exists")) {
        await context.reloadNavigation();
        const reloadedGroup = findGroupByName(groupName);
        if (reloadedGroup) return String(reloadedGroup.uuid);
      }
      throw error;
    }
  }

  function setError(message) {
    state.error = message || null;
    render();
  }

  function renderSignedOut() {
    root.innerHTML = `<div class="mx-auto max-w-3xl p-4 md:p-6 lg:p-10">
      <div class="card p-8 text-center">
        <p class="text-base font-semibold text-slate-900">Sign in to manage topics</p>
        <p class="mt-2 text-sm text-slate-500">Create, test, and edit monitoring topics from your account.</p>
        <button type="button" class="btn btn-primary mt-5" data-open-auth>Sign in</button>
      </div>
    </div>`;
  }

  function draftListInputs(draftIndex, name, values, placeholder) {
    return ensureAtLeastOne(values).map((value, index) => `<div class="flex items-center gap-3">
      <input class="input h-9 px-3 text-xs" data-draft-list="${name}" data-draft-index="${draftIndex}" value="${context.utils.escapeHtml(value)}" placeholder="${context.utils.escapeHtml(placeholder)}">
      <button type="button" class="btn btn-ghost btn-sm px-2 text-slate-400 hover:text-red-600" data-remove-draft-list="${name}" data-draft-index="${draftIndex}" data-index="${index}">Remove</button>
    </div>`).join("");
  }

  function renderGroupField({ inputName, listId, useSuggestion = false } = {}) {
    const derivedGroupName = state.groupNameDraft || (state.groupUuid ? groupNameForUuid(state.groupUuid) : "");
    const inputValue = useSuggestion && !derivedGroupName
      ? state.suggestedGroupName
      : derivedGroupName;
    return `<div class="space-y-2">
      <input name="${inputName}" list="${listId}" class="input" value="${context.utils.escapeHtml(inputValue || "")}" placeholder="${state.suggestedGroupName ? context.utils.escapeHtml(state.suggestedGroupName) : "Type or choose a group"}">
      <datalist id="${listId}">
        ${context.state.groups.map((group) => `<option value="${context.utils.escapeHtml(group.name)}"></option>`).join("")}
      </datalist>
      <p class="text-xs text-slate-500">Choose an existing group from suggestions or type a new group name.</p>
    </div>`;
  }

  function renderPromptStage() {
    return `<div class="space-y-6">
      <div class="space-y-2">
        <label class="text-xs font-bold uppercase tracking-widest text-slate-500">What topic do you want to monitor?</label>
        <input name="monitoringPrompt" class="input h-12" value="${context.utils.escapeHtml(state.draft.monitoringPrompt)}" placeholder="Enter the topic you want to monitor">
      </div>
      ${state.error ? `<p class="text-sm text-red-600">${context.utils.escapeHtml(state.error)}</p>` : ""}
      <div class="flex items-center justify-end gap-3">
        <a class="btn btn-outline" href="/">Cancel</a>
        <button type="button" class="btn btn-primary" data-action="organize" ${state.busy ? "disabled" : ""}>${state.busy === "organize" ? "Analyzing..." : "Analyze topic"}</button>
      </div>
    </div>`;
  }

  function renderTopicWarning() {
    const hasSplitDrafts = state.mode === "create" && state.splitDrafts.length > 0;
    const warning = hasSplitDrafts
      ? "Broad topic detected: split into focused drafts."
      : state.draft.topicWarning;
    if (!warning) return "";
    return `<div class="inline-flex max-w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4 flex-none text-amber-500" aria-hidden="true">
        <path d="m12 3 9 16H3L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="font-semibold">${context.utils.escapeHtml(warning)}</span>
    </div>`;
  }

  function renderTopicDraftCard({
    draft,
    index,
    title,
    selected = true,
    selectable = false,
    removable = false,
    allowDomainSuggestions = false,
  }) {
    const selectedDomains = normalizeList(draft.domainAllowlist);
    const canSuggestMoreDomains = allowDomainSuggestions && draft.limitToSelectedDomains && selectedDomains.length > 0 && selectedDomains.length < 20;
    const labelClass = "text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400";
    const cardClass = selectable
      ? (selected ? "border-emerald-200 bg-emerald-50/80 shadow-sm shadow-emerald-100/80" : "border-slate-200 bg-white hover:border-slate-300")
      : "border-slate-200 bg-white";
    return `<div class="rounded-xl border ${cardClass} p-6 transition-colors">
      <div class="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        ${selectable ? `<label class="flex items-center gap-3 text-sm font-semibold text-slate-900">
          <input type="checkbox" class="h-5 w-5 accent-emerald-600" data-draft-selected="${index}" ${selected ? "checked" : ""}>
          <span class="text-base font-bold">${context.utils.escapeHtml(title)}</span>
        </label>` : `<p class="text-sm font-semibold text-slate-900">${context.utils.escapeHtml(title)}</p>`}
        <div class="flex flex-wrap items-center gap-3">
          ${draft.topicWarning ? `<span class="text-xs font-medium text-amber-700">${context.utils.escapeHtml(draft.topicWarning)}</span>` : ""}
          ${removable ? `<button type="button" class="btn btn-ghost btn-sm text-slate-400 hover:text-red-600" data-action="remove-topic-card" data-draft-index="${index}">Remove topic</button>` : ""}
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <div class="space-y-1.5 md:col-span-2">
          <label class="${labelClass}">Display title</label>
          <input class="input" data-draft-title="${index}" value="${context.utils.escapeHtml(draft.displayTitle)}">
        </div>
        <div class="space-y-1.5">
          <label class="${labelClass}">Target country</label>
          <select class="input" data-draft-country="${index}">
            ${COUNTRY_OPTIONS.map(([value, label]) => `<option value="${value}" ${draft.country === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="space-y-1.5 md:col-span-3">
          <label class="${labelClass}">Monitoring scope</label>
          <input class="input" data-draft-prompt="${index}" value="${context.utils.escapeHtml(draft.monitoringPrompt)}">
        </div>
      </div>

      <div class="mt-6 grid gap-6 border-t ${selectable && selected ? "border-emerald-100" : "border-slate-100"} pt-6 lg:grid-cols-12">
        <div class="space-y-3 lg:col-span-4">
          <div class="flex items-center justify-between">
            <label class="${labelClass}">Search queries</label>
            <button type="button" class="text-xs font-bold text-emerald-700 hover:underline" data-add-draft-list="queries" data-draft-index="${index}">Add</button>
          </div>
          ${draftListInputs(index, "queries", draft.queries, "English search query")}
        </div>
        <div class="space-y-3 lg:col-span-5">
          <div class="flex items-center justify-between">
            <label class="${labelClass}">Source control</label>
            <div class="flex overflow-hidden rounded-lg border border-slate-200 text-[10px] font-extrabold uppercase tracking-[0.08em]">
              <button type="button" class="${draft.limitToSelectedDomains ? "bg-white text-slate-500" : "bg-emerald-600 text-white"} px-2.5 py-1" data-draft-domain-mode="all" data-draft-index="${index}">All</button>
              <button type="button" class="${draft.limitToSelectedDomains ? "bg-emerald-600 text-white" : "bg-white text-slate-500"} border-l border-slate-200 px-2.5 py-1" data-draft-domain-mode="limited" data-draft-index="${index}">Limited</button>
            </div>
          </div>
          ${draft.limitToSelectedDomains ? `<div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-bold text-slate-500">${selectedDomains.length}/20 domains</p>
              <div class="flex items-center gap-2">
                ${draft.suggestedDomains.length ? `<button type="button" class="text-xs font-bold text-slate-500 hover:text-slate-900" data-action="restore-draft-domains" data-draft-index="${index}">Use AI list</button>` : ""}
                <button type="button" class="text-xs font-bold text-emerald-700 hover:underline" data-add-draft-list="domainAllowlist" data-draft-index="${index}">Add domain</button>
              </div>
            </div>
            ${draftListInputs(index, "domainAllowlist", draft.domainAllowlist, "example.org")}
            ${allowDomainSuggestions ? `<button type="button" class="btn btn-outline btn-sm" data-action="suggest-domains" ${!canSuggestMoreDomains || state.busy ? "disabled" : ""}>${state.busy === "suggest-domains" ? "Suggesting..." : "Suggest more like this"}</button>` : ""}
          </div>` : `<p class="text-sm leading-6 text-slate-500">Do not limit to specific domains.</p>`}
        </div>
        <div class="space-y-3 lg:col-span-3">
          <div class="flex items-center justify-between">
            <label class="${labelClass}">Languages</label>
            <button type="button" class="text-xs font-bold text-emerald-700 hover:underline" data-add-draft-list="languageFilter" data-draft-index="${index}">Add</button>
          </div>
          ${draftListInputs(index, "languageFilter", draft.languageFilter, "en")}
        </div>
      </div>
    </div>`;
  }

  function renderReviewStage() {
    const feedback = feedbackItems();
    const draftCards = [state.draft, ...state.extraDrafts];
    const canUseSingleTools = state.mode === "edit" || state.extraDrafts.length === 0;
    const draftCountLabel = `${draftCards.length} topic draft${draftCards.length === 1 ? "" : "s"}`;
    const actionLabel = state.mode === "edit"
      ? "Save topic"
      : draftCards.length > 1 ? "Create topics" : "Create topic";
    return `<div class="space-y-8">
      <div class="rounded-xl border border-slate-200 bg-white p-5">
        <div class="space-y-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Topic review</p>
              <p class="mt-1 text-sm leading-6 text-slate-600">Review the topic drafts before creating them.</p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">${draftCountLabel}</span>
              <button type="button" class="btn btn-outline btn-sm" data-action="organize" ${state.busy ? "disabled" : ""}>${state.busy === "organize" ? "Refreshing..." : "Refresh AI suggestions"}</button>
            </div>
          </div>
          ${renderTopicWarning()}
          <div class="space-y-2 border-t border-slate-100 pt-4">
            <label class="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Save into group</label>
            ${renderGroupField({ inputName: "groupName", listId: "topic-group-options" })}
          </div>
        </div>
      </div>

      <div class="space-y-4">
        ${draftCards.map((draft, index) => renderTopicDraftCard({
          draft,
          index,
          title: `Topic ${index + 1}`,
          removable: state.mode === "create" && index > 0,
          allowDomainSuggestions: canUseSingleTools && index === 0,
        })).join("")}
      </div>
      ${state.mode === "create" ? `<div class="flex justify-center pt-1">
        <button type="button" class="btn btn-outline w-full max-w-sm border-dashed border-slate-300 text-slate-500" data-action="add-topic-card">Add topic</button>
      </div>` : ""}

      ${canUseSingleTools && state.previewHasRun ? renderPreview(feedback) : ""}
      ${state.error ? `<p class="text-sm text-red-600">${context.utils.escapeHtml(state.error)}</p>` : ""}

      <div class="flex flex-col gap-4 border-t border-slate-100 pt-8 md:flex-row md:items-center md:justify-between">
        <div class="text-sm text-slate-400">${state.mode === "edit" ? '<button type="button" class="btn btn-ghost text-red-600" data-action="delete-topic">Delete topic</button>' : "Unsaved changes will be discarded."}</div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <a class="btn btn-outline" href="${state.mode === "edit" ? "/topics" : "/"}">Cancel</a>
          ${canUseSingleTools ? `<button type="button" class="btn btn-outline" data-action="preview" ${state.busy ? "disabled" : ""}>${state.busy === "preview" ? "Testing..." : "Test run"}</button>` : ""}
          ${canUseSingleTools && feedback.length ? `<button type="button" class="btn btn-primary rounded-xl px-6 shadow-lg shadow-emerald-500/20" data-action="refine" ${state.busy ? "disabled" : ""}>${state.busy === "refine" ? "Updating..." : "Update topic parameters"}</button>` : `<button type="button" class="btn btn-primary rounded-xl px-6 shadow-lg shadow-emerald-500/20" data-action="save" ${state.busy ? "disabled" : ""}>${state.busy === "save" ? "Saving..." : actionLabel}</button>`}
        </div>
      </div>
    </div>`;
  }

  function renderSplitStage() {
    const selectedCount = state.splitDrafts.filter((entry) => entry.selected).length;
    const selectedLabel = `${selectedCount} of ${state.splitDrafts.length} selected`;
    const actionLabel = selectedCount === 0
      ? "Create selected topics"
      : selectedCount === 1 ? "Create 1 selected topic" : `Create ${selectedCount} selected topics`;
    return `<div class="space-y-6">
      <div class="rounded-xl border border-slate-200 bg-white p-5">
        <div class="space-y-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Multiple topic review</p>
              <p class="mt-1 text-sm leading-6 text-slate-600">Select and edit the focused topics to create from this broad prompt.</p>
            </div>
            <span class="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">${selectedLabel}</span>
          </div>
          ${renderTopicWarning()}
          <div class="space-y-2 border-t border-slate-100 pt-4">
            <label class="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Save into group</label>
            ${renderGroupField({ inputName: "splitGroupName", listId: "split-topic-group-options", useSuggestion: true })}
          </div>
        </div>
      </div>

      <div class="space-y-4">
        ${state.splitDrafts.map((entry, index) => renderTopicDraftCard({
          draft: entry.draft,
          index,
          title: `Topic ${index + 1}`,
          selected: entry.selected,
          selectable: true,
          removable: state.splitDrafts.length > 1,
        })).join("")}
      </div>
      <div class="flex justify-center pt-1">
        <button type="button" class="btn btn-outline w-full max-w-sm border-dashed border-slate-300 text-slate-500" data-action="add-topic-card">Add topic</button>
      </div>

      ${state.error ? `<p class="text-sm text-red-600">${context.utils.escapeHtml(state.error)}</p>` : ""}
      <div class="flex flex-col gap-4 border-t border-slate-100 pt-8 md:flex-row md:items-center md:justify-between">
        <p class="text-sm text-slate-400">Unsaved changes will be discarded.</p>
        <div class="flex flex-wrap items-center justify-end gap-3">
        <a class="btn btn-outline" href="/">Cancel</a>
        <button type="button" class="btn btn-primary rounded-xl px-6 shadow-lg shadow-emerald-500/20" data-action="bulk-save" ${state.busy ? "disabled" : ""}>${state.busy === "bulk-save" ? "Creating..." : actionLabel}</button>
        </div>
      </div>
    </div>`;
  }

  function renderPreview(feedback) {
    return `<div class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Test run results</p>
          <p class="mt-1 text-sm text-slate-600">Rate strong or weak results, then update the topic parameters if the mix looks off.</p>
        </div>
        ${feedback.length ? `<span class="text-sm font-medium text-slate-700">${feedback.length} rated result${feedback.length === 1 ? "" : "s"}</span>` : ""}
      </div>
      ${state.previewResults.length ? `<div class="space-y-3">${state.previewResults.map((item) => {
        const reaction = state.previewReactions[item.url];
        return `<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span>${context.utils.escapeHtml(item.domain || "Unknown domain")}</span>
                ${item.published_at ? `<span>${context.utils.escapeHtml(new Date(item.published_at).toLocaleDateString())}</span>` : ""}
              </div>
              <a href="${context.utils.escapeHtml(item.url)}" target="_blank" rel="noreferrer" class="block text-base font-semibold text-slate-900 hover:text-slate-700">${context.utils.escapeHtml(item.title || item.url)}</a>
              ${item.snippet ? `<p class="text-sm leading-6 text-slate-600">${context.utils.escapeHtml(item.snippet)}</p>` : ""}
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-sm ${reaction === "up" ? "btn-primary" : "btn-outline"}" data-rate-url="${context.utils.escapeHtml(item.url)}" data-rate="up">Good</button>
              <button type="button" class="btn btn-sm ${reaction === "down" ? "btn-primary" : "btn-outline"}" data-rate-url="${context.utils.escapeHtml(item.url)}" data-rate="down">Bad</button>
            </div>
          </div>
        </div>`;
      }).join("")}</div>` : '<div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">No results returned for this test run. Try broader queries or turn off domain limiting.</div>'}
    </div>`;
  }

  function render() {
    syncFromActiveTopic();
    if (context.state.isAuthenticated !== true) {
      renderSignedOut();
      return;
    }
    if (state.mode === "edit" && !activeTopic()) {
      root.innerHTML = `<div class="card m-4 p-6 text-sm text-slate-500 md:m-6 lg:m-10">Select a topic to edit.</div>`;
      return;
    }
    const pageTitle = state.mode === "edit"
      ? "Edit monitoring topic"
      : state.stage === "prompt" ? "Create monitoring topic" : "Review drafts";
    const pageDescription = state.stage === "split"
      ? "AI analyzed your prompt and generated focused topic monitors."
      : state.stage === "review"
        ? "Review the topic draft configuration before saving."
        : "Start with one topic. AI suggests the query set and domain strategy, then you can test the configuration before saving.";
    root.innerHTML = `<div class="h-full border-none bg-white shadow-none">
      <div class="mx-auto max-w-5xl px-6 pb-0 pt-8 md:px-10">
        <h2 class="text-3xl font-bold text-slate-900">${pageTitle}</h2>
        <p class="mt-2 max-w-2xl text-base text-slate-600">${pageDescription}</p>
      </div>
      <div class="mx-auto max-w-5xl space-y-8 px-6 py-8 md:px-10">
        ${state.stage === "prompt" ? renderPromptStage() : state.stage === "split" ? renderSplitStage() : renderReviewStage()}
      </div>
    </div>`;
  }

  function applyOrganizerResponse(response, prompt, { preserveTitle = false } = {}) {
    const nextQueries = response.query_variations && response.query_variations.length ? response.query_variations : [prompt];
    const nextDomains = response.suggested_domains && response.suggested_domains.length ? response.suggested_domains : [];
    const splitSuggestions = response.split_suggestions && response.split_suggestions.length
      ? response.split_suggestions.map((suggestion) => toDraftFromSplitSuggestion(suggestion))
      : [];
    state.draft = {
      ...state.draft,
      monitoringPrompt: prompt,
      displayTitle: preserveTitle && state.draft.displayTitle.trim() ? state.draft.displayTitle : response.display_title || prompt,
      queries: nextQueries,
      suggestedDomains: nextDomains,
      topicWarning: response.topic_warning || null,
      limitToSelectedDomains: nextDomains.length > 0,
      domainAllowlist: ensureAtLeastOne(nextDomains),
      languageFilter: response.search_language_filter && response.search_language_filter.length ? response.search_language_filter : [""],
      country: response.country || "",
      updateFrequency: state.draft.updateFrequency || "auto",
      autoEffectiveIntervalHours: state.draft.autoEffectiveIntervalHours || 24,
    };
    state.lastOrganizedPrompt = prompt;
    state.previewResults = [];
    state.previewReactions = {};
    state.previewHasRun = false;
    state.suggestedGroupName = response.suggested_group_name || "";
    state.extraDrafts = [];
    state.splitDrafts = splitSuggestions.map((draft) => ({ selected: true, draft }));
    state.stage = state.mode === "create" && state.splitDrafts.length > 0 ? "split" : "review";
  }

  async function runOrganizer() {
    collectDraftFromDom();
    const prompt = state.draft.monitoringPrompt.trim();
    if (!prompt) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    state.busy = "organize";
    state.error = null;
    render();
    try {
      const response = await context.api.organizeTopic({ monitoringPrompt: prompt });
      applyOrganizerResponse(response, prompt);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to analyze this topic.";
    } finally {
      state.busy = null;
      render();
    }
  }

  async function suggestDomains() {
    collectDraftFromDom();
    if (!state.draft.monitoringPrompt.trim()) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    state.busy = "suggest-domains";
    state.error = null;
    render();
    try {
      const response = await context.api.suggestMoreDomains({
        monitoringPrompt: state.draft.monitoringPrompt.trim(),
        selectedDomains: normalizedDomains(),
      });
      state.draft.domainAllowlist = ensureAtLeastOne(normalizeList([...state.draft.domainAllowlist, ...(response.domains || [])]).slice(0, 20));
      state.draft.suggestedDomains = normalizeList([...state.draft.suggestedDomains, ...(response.domains || [])]).slice(0, 20);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to suggest more domains.";
    } finally {
      state.busy = null;
      render();
    }
  }

  async function runPreview() {
    collectDraftFromDom();
    if (hasPendingPromptChanges()) {
      setError("Refresh AI suggestions after editing the monitoring prompt before running a test.");
      return;
    }
    if (!normalizedQueries().length) {
      setError("Add at least one query before running a test.");
      return;
    }
    if (state.draft.limitToSelectedDomains && !normalizedDomains().length) {
      setError("Add at least one domain or turn off domain limiting.");
      return;
    }
    state.busy = "preview";
    state.error = null;
    render();
    try {
      const response = await context.api.previewTopic({
        queries: normalizedQueries(),
        domainAllowlist: state.draft.limitToSelectedDomains ? normalizedDomains() : null,
        languageFilter: normalizedLanguages(),
        country: state.draft.country.trim() || null,
      });
      state.previewResults = response.items || [];
      state.previewReactions = {};
      state.previewHasRun = true;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to run a test search.";
    } finally {
      state.busy = null;
      render();
    }
  }

  async function refineTopic() {
    collectDraftFromDom();
    const feedback = feedbackItems();
    if (hasPendingPromptChanges()) {
      setError("Refresh AI suggestions after editing the monitoring prompt before updating parameters.");
      return;
    }
    if (!feedback.length) {
      setError("Rate at least one test result before updating topic parameters.");
      return;
    }
    state.busy = "refine";
    state.error = null;
    render();
    try {
      const response = await context.api.refineTopic({
        monitoringPrompt: state.draft.monitoringPrompt.trim(),
        queries: normalizedQueries(),
        domainAllowlist: state.draft.limitToSelectedDomains ? normalizedDomains() : null,
        languageFilter: normalizedLanguages(),
        country: state.draft.country.trim() || null,
        feedback,
      });
      applyOrganizerResponse(response, state.draft.monitoringPrompt.trim(), { preserveTitle: true });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to update topic parameters.";
    } finally {
      state.busy = null;
      render();
    }
  }

  async function saveTopic() {
    collectDraftFromDom();
    const topic = activeTopic();
    const drafts = state.mode === "create" ? [state.draft, ...state.extraDrafts] : [state.draft];
    for (const [index, draft] of drafts.entries()) {
      const validationError = validateTopicDraft(draft, `Topic ${index + 1}`);
      if (validationError) {
        setError(validationError);
        return;
      }
      if (draft.limitToSelectedDomains && !normalizeList(draft.domainAllowlist).length) {
        setError(`Topic ${index + 1}: add at least one domain or turn off domain limiting.`);
        return;
      }
    }
    if (hasPendingPromptChanges()) {
      setError("Refresh AI suggestions after editing the monitoring prompt before saving.");
      return;
    }
    state.busy = "save";
    state.error = null;
    render();
    try {
      const resolvedGroupUuid = await resolveGroupUuid();
      let response;
      if (state.mode === "edit" && state.topicUuid) {
        const payload = buildTopicPayload(state.draft, {
          groupUuid: resolvedGroupUuid,
          isActive: topic ? topic.isActive : true,
        });
        response = await context.api.updateTopic(state.topicUuid, payload);
      } else if (drafts.length > 1) {
        const bulkResponse = await context.api.createTopics({
          topics: drafts.map((draft) => buildTopicPayload(draft, {
            groupUuid: resolvedGroupUuid,
            isActive: true,
          })),
        });
        response = (bulkResponse.topics || [])[0];
      } else {
        const payload = buildTopicPayload(state.draft, {
          groupUuid: resolvedGroupUuid,
          isActive: true,
        });
        response = (await context.api.createTopic(payload)).topic;
      }
      await context.reloadNavigation();
      if (response) {
        const uuid = String(response.uuid);
        context.setSelection({ topicUuid: uuid, navigate: true });
      } else {
        window.location.assign("/");
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to save topic.";
      state.busy = null;
      render();
    }
  }

  async function saveSplitTopics() {
    collectSplitDraftsFromDom();
    const selectedEntries = state.splitDrafts
      .map((entry, index) => ({ ...entry, index }))
      .filter((entry) => entry.selected);
    if (!selectedEntries.length) {
      setError("Select at least one topic before saving.");
      return;
    }

    for (const entry of selectedEntries) {
      const validationError = validateTopicDraft(entry.draft, `Topic ${entry.index + 1}`);
      if (validationError) {
        setError(validationError);
        return;
      }
      if (entry.draft.limitToSelectedDomains && !normalizeList(entry.draft.domainAllowlist).length) {
        setError(`Topic ${entry.index + 1}: add at least one domain or turn off domain limiting.`);
        return;
      }
    }

    state.busy = "bulk-save";
    state.error = null;
    render();
    try {
      const resolvedGroupUuid = await resolveGroupUuid();
      const response = await context.api.createTopics({
        topics: selectedEntries.map((entry) => buildTopicPayload(entry.draft, {
          groupUuid: resolvedGroupUuid,
          isActive: true,
        })),
      });
      await context.reloadNavigation();
      const firstTopic = (response.topics || [])[0];
      if (firstTopic) {
        context.setSelection({ topicUuid: String(firstTopic.uuid), navigate: true });
      } else {
        window.location.assign("/");
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to create topics.";
      state.busy = null;
      render();
    }
  }

  async function deleteTopic() {
    const topic = activeTopic();
    if (!topic) return;
    if (!window.confirm("Delete this topic permanently? This cannot be undone.")) return;
    state.busy = "delete";
    render();
    try {
      await context.api.deleteTopic(topic.uuid);
      await context.reloadNavigation();
      window.location.assign("/topics");
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to delete topic.";
      state.busy = null;
      render();
    }
  }

  function collectCurrentDraftCardsFromDom() {
    if (state.stage === "split") {
      collectSplitDraftsFromDom();
    } else {
      collectDraftFromDom();
    }
  }

  function draftForCard(index) {
    if (state.stage === "split") {
      return state.splitDrafts[index] ? state.splitDrafts[index].draft : null;
    }
    if (index === 0) return state.draft;
    return state.extraDrafts[index - 1] || null;
  }

  function addTopicCard() {
    collectCurrentDraftCardsFromDom();
    const draft = cloneDraft(EMPTY_DRAFT);
    if (state.stage === "split") {
      state.splitDrafts.push({ selected: true, draft });
    } else {
      state.extraDrafts.push(draft);
      state.previewResults = [];
      state.previewReactions = {};
      state.previewHasRun = false;
    }
    state.error = null;
    render();
  }

  function removeTopicCard(index) {
    collectCurrentDraftCardsFromDom();
    if (state.stage === "split") {
      if (state.splitDrafts.length <= 1) return;
      state.splitDrafts = state.splitDrafts.filter((_entry, currentIndex) => currentIndex !== index);
    } else if (index > 0) {
      state.extraDrafts = state.extraDrafts.filter((_draft, currentIndex) => currentIndex !== index - 1);
    }
    state.error = null;
    render();
  }

  root.addEventListener("click", (event) => {
    const draftSelected = event.target.closest("[data-draft-selected]");
    if (draftSelected) {
      collectSplitDraftsFromDom();
      render();
      return;
    }

    const draftDomainMode = event.target.closest("[data-draft-domain-mode]");
    if (draftDomainMode) {
      collectCurrentDraftCardsFromDom();
      const draft = draftForCard(Number(draftDomainMode.dataset.draftIndex));
      if (!draft) return;
      draft.limitToSelectedDomains = draftDomainMode.dataset.draftDomainMode === "limited";
      if (draft.limitToSelectedDomains) {
        const nextDomains = normalizeList(draft.domainAllowlist).length
          ? normalizeList(draft.domainAllowlist)
          : normalizeList(draft.suggestedDomains);
        draft.domainAllowlist = ensureAtLeastOne(nextDomains);
      }
      render();
      return;
    }

    const addDraftList = event.target.closest("[data-add-draft-list]");
    if (addDraftList) {
      collectCurrentDraftCardsFromDom();
      const draft = draftForCard(Number(addDraftList.dataset.draftIndex));
      if (!draft) return;
      const field = addDraftList.dataset.addDraftList;
      draft[field] = [...draft[field], ""];
      render();
      return;
    }

    const removeDraftList = event.target.closest("[data-remove-draft-list]");
    if (removeDraftList) {
      collectCurrentDraftCardsFromDom();
      const draft = draftForCard(Number(removeDraftList.dataset.draftIndex));
      if (!draft) return;
      const field = removeDraftList.dataset.removeDraftList;
      const index = Number(removeDraftList.dataset.index);
      draft[field] = ensureAtLeastOne(draft[field].filter((_value, currentIndex) => currentIndex !== index));
      render();
      return;
    }
    const rate = event.target.closest("[data-rate-url]");
    if (rate) {
      const url = rate.dataset.rateUrl;
      const reaction = rate.dataset.rate;
      state.previewReactions[url] = state.previewReactions[url] === reaction ? null : reaction;
      render();
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "organize") runOrganizer();
    if (name === "add-topic-card") addTopicCard();
    if (name === "remove-topic-card") removeTopicCard(Number(action.dataset.draftIndex));
    if (name === "restore-draft-domains") {
      collectCurrentDraftCardsFromDom();
      const draft = draftForCard(Number(action.dataset.draftIndex));
      if (!draft) return;
      draft.limitToSelectedDomains = true;
      draft.domainAllowlist = ensureAtLeastOne(normalizeList(draft.suggestedDomains));
      render();
    }
    if (name === "suggest-domains") suggestDomains();
    if (name === "preview") runPreview();
    if (name === "refine") refineTopic();
    if (name === "save") saveTopic();
    if (name === "bulk-save") saveSplitTopics();
    if (name === "delete-topic") deleteTopic();
  });

  context.subscribe(() => {
    render();
  });

  render();
}
