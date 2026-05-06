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

function readList(root, name) {
  return Array.from(root.querySelectorAll(`[data-list="${name}"]`)).map((input) => input.value);
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
    state.splitDrafts = [];
    state.initializedForTopic = topic.uuid;
  }

  function collectDraftFromDom() {
    const monitoringPrompt = root.querySelector("[name='monitoringPrompt']");
    const displayTitle = root.querySelector("[name='displayTitle']");
    const groupName = root.querySelector("[name='groupName']");
    const country = root.querySelector("[name='country']");
    state.draft.monitoringPrompt = monitoringPrompt ? monitoringPrompt.value : state.draft.monitoringPrompt;
    state.draft.displayTitle = displayTitle ? displayTitle.value : state.draft.displayTitle;
    state.groupNameDraft = groupName ? groupName.value : state.groupNameDraft;
    state.draft.country = country ? country.value : state.draft.country;
    state.draft.queries = ensureAtLeastOne(readList(root, "queries"));
    state.draft.domainAllowlist = ensureAtLeastOne(readList(root, "domainAllowlist"));
    state.draft.languageFilter = ensureAtLeastOne(readList(root, "languageFilter"));
  }

  function readSplitList(index, name) {
    return Array.from(root.querySelectorAll(`[data-split-list="${name}"][data-split-index="${index}"]`)).map((input) => input.value);
  }

  function collectSplitDraftsFromDom() {
    const groupName = root.querySelector("[name='splitGroupName']");
    state.groupNameDraft = groupName ? groupName.value : state.groupNameDraft;
    state.splitDrafts = state.splitDrafts.map((entry, index) => {
      const selected = root.querySelector(`[data-split-selected="${index}"]`);
      const monitoringPrompt = root.querySelector(`[data-split-prompt="${index}"]`);
      const displayTitle = root.querySelector(`[data-split-title="${index}"]`);
      const country = root.querySelector(`[data-split-country="${index}"]`);
      const domainAllowlist = ensureAtLeastOne(readSplitList(index, "domainAllowlist"));
      return {
        ...entry,
        selected: selected ? selected.checked : entry.selected,
        draft: {
          ...entry.draft,
          monitoringPrompt: monitoringPrompt ? monitoringPrompt.value : entry.draft.monitoringPrompt,
          displayTitle: displayTitle ? displayTitle.value : entry.draft.displayTitle,
          queries: ensureAtLeastOne(readSplitList(index, "queries")),
          domainAllowlist,
          limitToSelectedDomains: entry.draft.limitToSelectedDomains,
          languageFilter: ensureAtLeastOne(readSplitList(index, "languageFilter")),
          country: country ? country.value : entry.draft.country,
        },
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

  function listInputs(name, values, placeholder) {
    return ensureAtLeastOne(values).map((value, index) => `<div class="flex items-center gap-3">
      <input class="input" data-list="${name}" value="${context.utils.escapeHtml(value)}" placeholder="${context.utils.escapeHtml(placeholder)}">
      <button type="button" class="btn btn-outline btn-sm" data-remove-list="${name}" data-index="${index}">Remove</button>
    </div>`).join("");
  }

  function splitListInputs(splitIndex, name, values, placeholder) {
    return ensureAtLeastOne(values).map((value, index) => `<div class="flex items-center gap-3">
      <input class="input" data-split-list="${name}" data-split-index="${splitIndex}" value="${context.utils.escapeHtml(value)}" placeholder="${context.utils.escapeHtml(placeholder)}">
      <button type="button" class="btn btn-outline btn-sm" data-remove-split-list="${name}" data-split-index="${splitIndex}" data-index="${index}">Remove</button>
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
      ? "The requested topic is broad, so it was split into focused topic drafts below."
      : state.draft.topicWarning;
    if (!warning) return "";
    return `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p class="font-semibold text-amber-900">Topic warning</p>
      <p class="mt-1 leading-6">${context.utils.escapeHtml(warning)}</p>
    </div>`;
  }

  function renderReviewStage() {
    const canSuggestMoreDomains = state.draft.limitToSelectedDomains && normalizedDomains().length > 0 && normalizedDomains().length < 20;
    const feedback = feedbackItems();
    return `<div class="space-y-8">
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="space-y-2 lg:col-span-2">
          <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Monitoring topic</label>
          <input name="monitoringPrompt" class="input" value="${context.utils.escapeHtml(state.draft.monitoringPrompt)}">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-slate-500">Change the topic and rerun AI analysis before saving or testing again.</p>
            <button type="button" class="btn btn-outline btn-sm" data-action="organize" ${state.busy ? "disabled" : ""}>${state.busy === "organize" ? "Refreshing..." : "Refresh AI suggestions"}</button>
          </div>
          ${renderTopicWarning()}
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Topic title</label>
          <input name="displayTitle" class="input" value="${context.utils.escapeHtml(state.draft.displayTitle)}">
        </div>
        <div class="space-y-2 lg:col-span-2">
          <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Topic group</label>
          ${renderGroupField({ inputName: "groupName", listId: "topic-group-options" })}
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Query variations</label>
          <button type="button" class="btn btn-ghost btn-sm" data-add-list="queries">Add</button>
        </div>
        ${listInputs("queries", state.draft.queries, "English search query")}
      </div>

      <div class="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="space-y-1">
            <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Search scope</p>
            <p class="text-sm text-slate-600">${state.draft.limitToSelectedDomains ? "Only search the selected domains below." : "Search the broader web without a domain allowlist."}</p>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-sm ${state.draft.limitToSelectedDomains ? "btn-outline" : "btn-primary"}" data-domain-mode="off">All sites</button>
            <button type="button" class="btn btn-sm ${state.draft.limitToSelectedDomains ? "btn-primary" : "btn-outline"}" data-domain-mode="on">Selected domains</button>
          </div>
        </div>
        ${state.draft.limitToSelectedDomains ? `<div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Selected domains</label>
            <div class="flex items-center gap-2">
              ${state.draft.suggestedDomains.length ? '<button type="button" class="btn btn-ghost btn-sm" data-action="restore-domains">Use AI list</button>' : ""}
              <button type="button" class="btn btn-ghost btn-sm" data-add-list="domainAllowlist">Add</button>
            </div>
          </div>
          ${listInputs("domainAllowlist", state.draft.domainAllowlist, "example.org")}
          <div class="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-sm text-slate-500">${normalizedDomains().length}/20 selected domains</p>
            <button type="button" class="btn btn-outline btn-sm" data-action="suggest-domains" ${!canSuggestMoreDomains || state.busy ? "disabled" : ""}>${state.busy === "suggest-domains" ? "Suggesting..." : "Suggest more like this"}</button>
          </div>
        </div>` : ""}
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Languages</label>
            <button type="button" class="btn btn-ghost btn-sm" data-add-list="languageFilter">Add</button>
          </div>
          ${listInputs("languageFilter", state.draft.languageFilter, "en")}
        </div>
        <div class="space-y-2">
          <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Country</label>
          <select name="country" class="input">
            ${COUNTRY_OPTIONS.map(([value, label]) => `<option value="${value}" ${state.draft.country === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
      </div>

      ${state.previewHasRun ? renderPreview(feedback) : ""}
      ${state.error ? `<p class="text-sm text-red-600">${context.utils.escapeHtml(state.error)}</p>` : ""}

      <div class="flex items-center justify-between gap-3 pt-2">
        <div>${state.mode === "edit" ? '<button type="button" class="btn btn-ghost text-red-600" data-action="delete-topic">Delete topic</button>' : ""}</div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          ${state.mode === "create" ? '<button type="button" class="btn btn-outline" data-action="back-to-prompt">Back</button>' : ""}
          <a class="btn btn-outline" href="${state.mode === "edit" ? "/topics" : "/"}">Cancel</a>
          <button type="button" class="btn btn-outline" data-action="preview" ${state.busy ? "disabled" : ""}>${state.busy === "preview" ? "Testing..." : "Test run"}</button>
          ${feedback.length ? `<button type="button" class="btn btn-primary" data-action="refine" ${state.busy ? "disabled" : ""}>${state.busy === "refine" ? "Updating..." : "Update topic parameters"}</button>` : `<button type="button" class="btn btn-primary" data-action="save" ${state.busy ? "disabled" : ""}>${state.busy === "save" ? "Saving..." : state.mode === "edit" ? "Save topic" : "Create topic"}</button>`}
        </div>
      </div>
    </div>`;
  }

  function renderSplitStage() {
    const selectedCount = state.splitDrafts.filter((entry) => entry.selected).length;
    return `<div class="space-y-6">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div class="space-y-4">
          <div>
            <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Multiple topic review</p>
            <p class="mt-1 text-sm leading-6 text-slate-600">Select and edit the focused topics to create from this broad prompt.</p>
          </div>
          ${renderTopicWarning()}
          <div class="space-y-2">
            <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Topic group</label>
            ${renderGroupField({ inputName: "splitGroupName", listId: "split-topic-group-options", useSuggestion: true })}
          </div>
        </div>
        <p class="mt-3 text-sm font-medium text-slate-700">${selectedCount} of ${state.splitDrafts.length} topics selected</p>
      </div>

      <div class="space-y-4">
        ${state.splitDrafts.map((entry, index) => {
          const draft = entry.draft;
          return `<div class="rounded-2xl border ${entry.selected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"} p-5">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label class="flex items-center gap-3 text-sm font-semibold text-slate-900">
                <input type="checkbox" class="h-4 w-4" data-split-selected="${index}" ${entry.selected ? "checked" : ""}>
                <span>Topic ${index + 1}</span>
              </label>
              ${draft.topicWarning ? `<span class="text-xs font-medium text-amber-700">${context.utils.escapeHtml(draft.topicWarning)}</span>` : ""}
            </div>

            <div class="mt-4 grid gap-4 lg:grid-cols-2">
              <div class="space-y-2">
                <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Topic title</label>
                <input class="input" data-split-title="${index}" value="${context.utils.escapeHtml(draft.displayTitle)}">
              </div>
              <div class="space-y-2">
                <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Country</label>
                <select class="input" data-split-country="${index}">
                  ${COUNTRY_OPTIONS.map(([value, label]) => `<option value="${value}" ${draft.country === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="space-y-2 lg:col-span-2">
                <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Monitoring topic</label>
                <input class="input" data-split-prompt="${index}" value="${context.utils.escapeHtml(draft.monitoringPrompt)}">
              </div>
            </div>

            <div class="mt-4 grid gap-4 lg:grid-cols-3">
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Queries</label>
                  <button type="button" class="btn btn-ghost btn-sm" data-add-split-list="queries" data-split-index="${index}">Add</button>
                </div>
                ${splitListInputs(index, "queries", draft.queries, "English search query")}
              </div>
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Search scope</label>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="btn btn-sm ${draft.limitToSelectedDomains ? "btn-outline" : "btn-primary"}" data-split-domain-mode="all" data-split-index="${index}">All sites</button>
                  <button type="button" class="btn btn-sm ${draft.limitToSelectedDomains ? "btn-primary" : "btn-outline"}" data-split-domain-mode="limited" data-split-index="${index}">Selected domains</button>
                </div>
                ${draft.limitToSelectedDomains ? `<div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <p class="text-sm text-slate-500">${normalizeList(draft.domainAllowlist).length}/20 domains</p>
                    <button type="button" class="btn btn-ghost btn-sm" data-add-split-list="domainAllowlist" data-split-index="${index}">Add</button>
                  </div>
                  ${splitListInputs(index, "domainAllowlist", draft.domainAllowlist, "example.org")}
                </div>` : `<p class="text-sm leading-6 text-slate-500">No domain allowlist will be sent to Perplexity.</p>`}
              </div>
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-bold uppercase tracking-widest text-slate-500">Languages</label>
                  <button type="button" class="btn btn-ghost btn-sm" data-add-split-list="languageFilter" data-split-index="${index}">Add</button>
                </div>
                ${splitListInputs(index, "languageFilter", draft.languageFilter, "en")}
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>

      ${state.error ? `<p class="text-sm text-red-600">${context.utils.escapeHtml(state.error)}</p>` : ""}
      <div class="flex flex-wrap items-center justify-end gap-3">
        <button type="button" class="btn btn-outline" data-action="back-to-review" ${state.busy ? "disabled" : ""}>Back</button>
        <a class="btn btn-outline" href="/">Cancel</a>
        <button type="button" class="btn btn-primary" data-action="bulk-save" ${state.busy ? "disabled" : ""}>${state.busy === "bulk-save" ? "Creating..." : "Create selected topics"}</button>
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
    const pageDescription = state.stage === "split"
      ? "Review focused topic drafts, then create the selected topics in one step."
      : "Start with one topic. AI suggests the query set and domain strategy, then you can test the configuration before saving.";
    root.innerHTML = `<div class="h-full border-none bg-white shadow-none">
      <div class="px-6 pb-0 pt-8 md:px-10">
        <h2 class="text-3xl font-bold text-slate-900">${state.mode === "edit" ? "Edit monitoring topic" : "Create monitoring topic"}</h2>
        <p class="mt-2 max-w-2xl text-base text-slate-600">${pageDescription}</p>
      </div>
      <div class="space-y-8 px-6 py-8 md:px-10">
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
    if (!state.draft.monitoringPrompt.trim()) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    if (!state.draft.displayTitle.trim()) {
      setError("Topic title cannot be empty.");
      return;
    }
    if (!normalizedQueries().length) {
      setError("Add at least one query before saving.");
      return;
    }
    if (hasPendingPromptChanges()) {
      setError("Refresh AI suggestions after editing the monitoring prompt before saving.");
      return;
    }
    if (state.draft.limitToSelectedDomains && !normalizedDomains().length) {
      setError("Add at least one domain or turn off domain limiting.");
      return;
    }
    state.busy = "save";
    state.error = null;
    render();
    try {
      const resolvedGroupUuid = await resolveGroupUuid();
      const payload = buildTopicPayload(state.draft, {
        groupUuid: resolvedGroupUuid,
        isActive: topic ? topic.isActive : true,
      });
      const response = state.mode === "edit" && state.topicUuid
        ? await context.api.updateTopic(state.topicUuid, payload)
        : (await context.api.createTopic(payload)).topic;
      await context.reloadNavigation();
      const uuid = String(response.uuid);
      context.setSelection({ topicUuid: uuid, navigate: true });
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

  root.addEventListener("click", (event) => {
    const splitSelected = event.target.closest("[data-split-selected]");
    if (splitSelected) {
      collectSplitDraftsFromDom();
      render();
      return;
    }
    const splitDomainMode = event.target.closest("[data-split-domain-mode]");
    if (splitDomainMode) {
      collectSplitDraftsFromDom();
      const splitIndex = Number(splitDomainMode.dataset.splitIndex);
      state.splitDrafts[splitIndex].draft.limitToSelectedDomains = splitDomainMode.dataset.splitDomainMode === "limited";
      if (state.splitDrafts[splitIndex].draft.limitToSelectedDomains) {
        const nextDomains = normalizeList(state.splitDrafts[splitIndex].draft.domainAllowlist).length
          ? normalizeList(state.splitDrafts[splitIndex].draft.domainAllowlist)
          : normalizeList(state.splitDrafts[splitIndex].draft.suggestedDomains);
        state.splitDrafts[splitIndex].draft.domainAllowlist = ensureAtLeastOne(nextDomains);
      }
      render();
      return;
    }
    const addSplitList = event.target.closest("[data-add-split-list]");
    if (addSplitList) {
      collectSplitDraftsFromDom();
      const splitIndex = Number(addSplitList.dataset.splitIndex);
      const field = addSplitList.dataset.addSplitList;
      state.splitDrafts[splitIndex].draft[field] = [...state.splitDrafts[splitIndex].draft[field], ""];
      render();
      return;
    }
    const removeSplitList = event.target.closest("[data-remove-split-list]");
    if (removeSplitList) {
      collectSplitDraftsFromDom();
      const splitIndex = Number(removeSplitList.dataset.splitIndex);
      const field = removeSplitList.dataset.removeSplitList;
      const index = Number(removeSplitList.dataset.index);
      state.splitDrafts[splitIndex].draft[field] = ensureAtLeastOne(
        state.splitDrafts[splitIndex].draft[field].filter((_value, currentIndex) => currentIndex !== index)
      );
      render();
      return;
    }
    const addList = event.target.closest("[data-add-list]");
    if (addList) {
      collectDraftFromDom();
      state.draft[addList.dataset.addList] = [...state.draft[addList.dataset.addList], ""];
      render();
      return;
    }
    const removeList = event.target.closest("[data-remove-list]");
    if (removeList) {
      collectDraftFromDom();
      const field = removeList.dataset.removeList;
      const index = Number(removeList.dataset.index);
      state.draft[field] = ensureAtLeastOne(state.draft[field].filter((_value, currentIndex) => currentIndex !== index));
      render();
      return;
    }
    const domainMode = event.target.closest("[data-domain-mode]");
    if (domainMode) {
      collectDraftFromDom();
      const on = domainMode.dataset.domainMode === "on";
      state.draft.limitToSelectedDomains = on;
      if (on) {
        const nextDomains = normalizeList(state.draft.domainAllowlist).length ? normalizeList(state.draft.domainAllowlist) : normalizeList(state.draft.suggestedDomains);
        state.draft.domainAllowlist = ensureAtLeastOne(nextDomains);
      }
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
    if (name === "restore-domains") {
      collectDraftFromDom();
      state.draft.limitToSelectedDomains = true;
      state.draft.domainAllowlist = ensureAtLeastOne(normalizeList(state.draft.suggestedDomains));
      render();
    }
    if (name === "suggest-domains") suggestDomains();
    if (name === "preview") runPreview();
    if (name === "refine") refineTopic();
    if (name === "save") saveTopic();
    if (name === "bulk-save") saveSplitTopics();
    if (name === "delete-topic") deleteTopic();
    if (name === "back-to-review") {
      collectSplitDraftsFromDom();
      state.error = null;
      state.stage = "review";
      render();
    }
    if (name === "back-to-prompt") {
      collectDraftFromDom();
      state.stage = "prompt";
      render();
    }
  });

  context.subscribe(() => {
    render();
  });

  render();
}
