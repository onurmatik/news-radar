import React, { useEffect, useMemo, useState } from "react";
import { useAuthDialog } from "@/components/AuthDialogContext";
import { useTopicGroup } from "@/components/TopicGroupContext";
import { useTopics } from "@/components/TopicsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTopic,
  deleteTopic,
  organizeTopic,
  previewTopic,
  refineTopic,
  suggestMoreDomains,
  updateTopic,
} from "@/lib/api";
import type {
  ApiTopicListItem,
  ApiTopicOrganizerResponse,
  ApiTopicPreviewResult,
  TopicDraft,
  TopicItem,
  TopicPreviewReaction,
} from "@/lib/types";
import { AlertTriangle, Loader2, Search, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type TopicFormMode = "create" | "edit";
type TopicFormStage = "prompt" | "review";

type TopicFormProps = {
  mode: TopicFormMode;
  topicUuid?: string | null;
  onCancel?: () => void;
  onSaved?: (topic: TopicItem, mode: TopicFormMode) => void;
  className?: string;
  variant?: "full" | "dialog";
};

const COUNTRY_OPTIONS = [
  { value: "", label: "All countries" },
  { value: "AU", label: "Australia" },
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
  { value: "CN", label: "China" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "IN", label: "India" },
  { value: "JP", label: "Japan" },
  { value: "SG", label: "Singapore" },
  { value: "TR", label: "Turkey" },
  { value: "US", label: "United States" },
];

const EMPTY_DRAFT: TopicDraft = {
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

function mapTopic(topic: ApiTopicListItem): TopicItem {
  return {
    id: topic.id,
    uuid: topic.uuid,
    monitoringPrompt: topic.monitoring_prompt,
    displayTitle: topic.display_title,
    queries: topic.queries ?? [],
    term: topic.display_title || topic.queries?.[0] || "Untitled",
    isActive: topic.is_active,
    lastSearch: topic.last_fetched_at ? new Date(topic.last_fetched_at) : null,
    hasNewItems: topic.content_source_count > 0,
    groupUuid: topic.group_uuid,
    groupName: topic.group_name,
    ownerUsername: topic.owner_username,
    isOwner: topic.is_owner,
    domainAllowlist: topic.search_domain_allowlist,
    languageFilter: topic.search_language_filter,
    country: topic.country,
    updateFrequency: topic.update_frequency,
    autoEffectiveIntervalHours: topic.auto_effective_interval_hours,
    autoIntervalUpdatedAt: topic.auto_interval_updated_at
      ? new Date(topic.auto_interval_updated_at)
      : null,
  };
}

function toDraftFromTopic(topic: TopicItem): TopicDraft {
  const existingDomains = topic.domainAllowlist?.length ? topic.domainAllowlist : [""];
  return {
    monitoringPrompt: topic.monitoringPrompt,
    displayTitle: topic.displayTitle,
    queries: topic.queries.length ? topic.queries : [""],
    suggestedDomains: topic.domainAllowlist?.length ? topic.domainAllowlist : [],
    topicWarning: null,
    limitToSelectedDomains: Boolean(topic.domainAllowlist?.length),
    domainAllowlist: existingDomains,
    languageFilter: topic.languageFilter?.length ? topic.languageFilter : [""],
    country: topic.country ?? "",
    updateFrequency: topic.updateFrequency,
    autoEffectiveIntervalHours: topic.autoEffectiveIntervalHours ?? 24,
  };
}

function normalizeList(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function ensureAtLeastOne(values: string[]) {
  return values.length ? values : [""];
}

function buildFeedbackItems(
  previewResults: ApiTopicPreviewResult[],
  reactions: Record<string, TopicPreviewReaction>
) {
  return previewResults.flatMap((item) => {
    const reaction = reactions[item.url];
    if (reaction !== "up" && reaction !== "down") {
      return [];
    }
    return [
      {
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        domain: item.domain,
        reaction,
      },
    ];
  });
}

export function TopicForm({
  mode,
  topicUuid,
  onCancel,
  onSaved,
  className,
  variant = "full",
}: TopicFormProps) {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const { groups, setSelectedTopicUuid } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const isEditing = mode === "edit";
  const isDialog = variant === "dialog";
  const activeTopic = isEditing
    ? topics.find((entry) => entry.uuid === topicUuid) ?? null
    : null;
  const [stage, setStage] = useState<TopicFormStage>(isEditing ? "review" : "prompt");
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_DRAFT);
  const [groupUuid, setGroupUuid] = useState("");
  const [loading, setLoading] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [suggestingDomains, setSuggestingDomains] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [lastOrganizedPrompt, setLastOrganizedPrompt] = useState("");
  const [previewResults, setPreviewResults] = useState<ApiTopicPreviewResult[]>([]);
  const [previewReactions, setPreviewReactions] = useState<Record<string, TopicPreviewReaction>>({});
  const [previewHasRun, setPreviewHasRun] = useState(false);

  const requireAuth = () => {
    if (isAuthenticated) return true;
    openAuthDialog();
    return false;
  };

  useEffect(() => {
    if (!isEditing) {
      setStage("prompt");
      setDraft(EMPTY_DRAFT);
      setGroupUuid("");
      setError(null);
      setLastOrganizedPrompt("");
      setPreviewResults([]);
      setPreviewReactions({});
      setPreviewHasRun(false);
      return;
    }
    if (activeTopic) {
      setDraft(toDraftFromTopic(activeTopic));
      setStage("review");
      setGroupUuid(activeTopic.groupUuid || "");
      setError(null);
      setLastOrganizedPrompt(activeTopic.monitoringPrompt);
      setPreviewResults([]);
      setPreviewReactions({});
      setPreviewHasRun(false);
    }
  }, [activeTopic, isEditing]);

  const hasPendingPromptChanges = useMemo(() => {
    return draft.monitoringPrompt.trim() !== lastOrganizedPrompt.trim();
  }, [draft.monitoringPrompt, lastOrganizedPrompt]);

  const normalizedQueries = useMemo(() => normalizeList(draft.queries), [draft.queries]);
  const normalizedDomainAllowlist = useMemo(
    () => (draft.limitToSelectedDomains ? normalizeList(draft.domainAllowlist) : []),
    [draft.domainAllowlist, draft.limitToSelectedDomains]
  );
  const canSuggestMoreDomains = useMemo(() => {
    return draft.limitToSelectedDomains
      && normalizedDomainAllowlist.length > 0
      && normalizedDomainAllowlist.length < 20;
  }, [draft.limitToSelectedDomains, normalizedDomainAllowlist.length]);
  const feedbackItems = useMemo(
    () => buildFeedbackItems(previewResults, previewReactions),
    [previewResults, previewReactions]
  );
  const hasPreviewFeedback = feedbackItems.length > 0;

  const updateListField = (
    field: "queries" | "domainAllowlist" | "languageFilter",
    index: number,
    value: string
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: (prev[field] as string[]).map((entry, currentIndex) =>
        currentIndex === index ? value : entry
      ),
    }));
  };

  const addListField = (field: "queries" | "domainAllowlist" | "languageFilter") => {
    setDraft((prev) => ({
      ...prev,
      [field]: [...prev[field], ""],
    }));
  };

  const removeListField = (
    field: "queries" | "domainAllowlist" | "languageFilter",
    index: number
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: ensureAtLeastOne(prev[field].filter((_, currentIndex) => currentIndex !== index)),
    }));
  };

  const applyOrganizerResponse = (
    response: ApiTopicOrganizerResponse,
    prompt: string,
    options?: {
      preserveTitle?: boolean;
    }
  ) => {
    const nextQueries = response.query_variations.length ? response.query_variations : [prompt];
    const nextDomains = response.suggested_domains.length ? response.suggested_domains : [];
    setDraft((prev) => ({
      ...prev,
      monitoringPrompt: prompt,
      displayTitle: options?.preserveTitle && prev.displayTitle.trim()
        ? prev.displayTitle
        : response.display_title || prompt,
      queries: nextQueries,
      suggestedDomains: nextDomains,
      topicWarning: response.topic_warning ?? null,
      limitToSelectedDomains: nextDomains.length > 0,
      domainAllowlist: ensureAtLeastOne(nextDomains),
      languageFilter: response.search_language_filter?.length
        ? response.search_language_filter
        : [""],
      country: response.country ?? "",
      updateFrequency: prev.updateFrequency || "auto",
      autoEffectiveIntervalHours: prev.autoEffectiveIntervalHours ?? 24,
    }));
    setLastOrganizedPrompt(prompt);
    setPreviewResults([]);
    setPreviewReactions({});
    setPreviewHasRun(false);
    setStage("review");
  };

  const setDomainLimiting = (nextValue: boolean) => {
    setDraft((prev) => {
      if (!nextValue) {
        return {
          ...prev,
          limitToSelectedDomains: false,
        };
      }
      const nextDomains = normalizeList(prev.domainAllowlist).length
        ? normalizeList(prev.domainAllowlist)
        : normalizeList(prev.suggestedDomains);
      return {
        ...prev,
        limitToSelectedDomains: true,
        domainAllowlist: ensureAtLeastOne(nextDomains),
      };
    });
  };

  const restoreSuggestedDomains = () => {
    setDraft((prev) => ({
      ...prev,
      limitToSelectedDomains: true,
      domainAllowlist: ensureAtLeastOne(normalizeList(prev.suggestedDomains)),
    }));
  };

  const handleSuggestMoreDomains = async () => {
    if (!requireAuth()) return;
    if (!draft.monitoringPrompt.trim()) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    if (!canSuggestMoreDomains) {
      return;
    }
    setSuggestingDomains(true);
    setError(null);
    try {
      const response = await suggestMoreDomains({
        monitoringPrompt: draft.monitoringPrompt.trim(),
        selectedDomains: normalizedDomainAllowlist,
      });
      setDraft((prev) => {
        const currentDomains = normalizeList(prev.domainAllowlist);
        const mergedDomains = normalizeList([...currentDomains, ...response.domains]).slice(0, 20);
        const mergedSuggestedDomains = normalizeList([
          ...prev.suggestedDomains,
          ...response.domains,
        ]).slice(0, 20);
        return {
          ...prev,
          domainAllowlist: ensureAtLeastOne(mergedDomains),
          suggestedDomains: mergedSuggestedDomains,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to suggest more domains.";
      setError(message);
    } finally {
      setSuggestingDomains(false);
    }
  };

  const runOrganizer = async () => {
    if (!requireAuth()) return;
    const prompt = draft.monitoringPrompt.trim();
    if (!prompt) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    setOrganizing(true);
    setError(null);
    try {
      const response = await organizeTopic({
        monitoringPrompt: prompt,
      });
      applyOrganizerResponse(response, prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to analyze this topic.";
      setError(message);
    } finally {
      setOrganizing(false);
    }
  };

  const runPreview = async () => {
    if (!requireAuth()) return;
    if (hasPendingPromptChanges) {
      setError("Refresh AI suggestions after editing the monitoring prompt before running a test.");
      return;
    }
    if (!normalizedQueries.length) {
      setError("Add at least one query before running a test.");
      return;
    }
    if (draft.limitToSelectedDomains && !normalizedDomainAllowlist.length) {
      setError("Add at least one domain or turn off domain limiting.");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const response = await previewTopic({
        queries: normalizedQueries,
        domainAllowlist: draft.limitToSelectedDomains ? normalizedDomainAllowlist : null,
        languageFilter: normalizeList(draft.languageFilter),
        country: draft.country.trim() || null,
      });
      setPreviewResults(response.items);
      setPreviewReactions({});
      setPreviewHasRun(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to run a test search.";
      setError(message);
    } finally {
      setPreviewing(false);
    }
  };

  const updateTopicParameters = async () => {
    if (!requireAuth()) return;
    if (hasPendingPromptChanges) {
      setError("Refresh AI suggestions after editing the monitoring prompt before updating parameters.");
      return;
    }
    if (!normalizedQueries.length) {
      setError("Add at least one query before updating parameters.");
      return;
    }
    if (!feedbackItems.length) {
      setError("Rate at least one test result before updating topic parameters.");
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const response = await refineTopic({
        monitoringPrompt: draft.monitoringPrompt.trim(),
        queries: normalizedQueries,
        domainAllowlist: draft.limitToSelectedDomains ? normalizedDomainAllowlist : null,
        languageFilter: normalizeList(draft.languageFilter),
        country: draft.country.trim() || null,
        feedback: feedbackItems,
      });
      applyOrganizerResponse(response, draft.monitoringPrompt.trim(), { preserveTitle: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update topic parameters.";
      setError(message);
    } finally {
      setRefining(false);
    }
  };

  const saveTopic = async () => {
    if (!requireAuth()) return;
    if (!draft.monitoringPrompt.trim()) {
      setError("Monitoring prompt cannot be empty.");
      return;
    }
    if (!draft.displayTitle.trim()) {
      setError("Topic title cannot be empty.");
      return;
    }
    if (!normalizedQueries.length) {
      setError("Add at least one query before saving.");
      return;
    }
    if (hasPendingPromptChanges) {
      setError("Refresh AI suggestions after editing the monitoring prompt before saving.");
      return;
    }
    if (draft.limitToSelectedDomains && !normalizedDomainAllowlist.length) {
      setError("Add at least one domain or turn off domain limiting.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        monitoringPrompt: draft.monitoringPrompt.trim(),
        displayTitle: draft.displayTitle.trim(),
        primaryQuery: normalizedQueries[0],
        queryVariations: normalizedQueries.slice(1),
        groupUuid: groupUuid || null,
        domainAllowlist: draft.limitToSelectedDomains ? normalizedDomainAllowlist : null,
        languageFilter: normalizeList(draft.languageFilter),
        country: draft.country.trim() || null,
        updateFrequency: draft.updateFrequency,
        autoEffectiveIntervalHours: draft.autoEffectiveIntervalHours ?? null,
        isActive: activeTopic?.isActive ?? true,
      };
      const response = isEditing && topicUuid
        ? await updateTopic(topicUuid, payload)
        : (await createTopic(payload)).topic;
      const mapped = mapTopic(response);
      setTopics((prev) => {
        const next = prev.filter((item) => item.uuid !== mapped.uuid);
        return [mapped, ...next];
      });
      setSelectedTopicUuid(mapped.uuid);
      onSaved?.(mapped, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save topic.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!activeTopic) return;
    if (!requireAuth()) return;
    setDeleteSaving(true);
    setError(null);
    try {
      await deleteTopic(activeTopic.uuid);
      setTopics((prev) => prev.filter((item) => item.uuid !== activeTopic.uuid));
      setSelectedTopicUuid((prev) => (prev === activeTopic.uuid ? null : prev));
      setDeleteDialogOpen(false);
      onCancel?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete topic.";
      setError(message);
    } finally {
      setDeleteSaving(false);
    }
  };

  const togglePreviewReaction = (url: string, reaction: Exclude<TopicPreviewReaction, null>) => {
    setPreviewReactions((prev) => ({
      ...prev,
      [url]: prev[url] === reaction ? null : reaction,
    }));
  };

  if (isEditing && !activeTopic) {
    return (
      <Card className={cn("border border-border/60 bg-card/40", className)}>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Select a topic to edit.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full border-none bg-white shadow-none", className)}>
      <CardHeader className={cn(isDialog ? "border-b border-border/60" : "px-6 pb-0 pt-8 md:px-10")}>
        <CardTitle className="text-3xl font-bold text-slate-900">
          {isEditing ? "Edit monitoring topic" : "Create monitoring topic"}
        </CardTitle>
        <CardDescription className="max-w-2xl text-base text-slate-600">
          Start with one topic. AI suggests the query set and domain strategy, then you can test the configuration before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-8", isDialog ? "p-6" : "px-6 py-8 md:px-10")}>
        {stage === "prompt" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                What topic do you want to monitor?
              </label>
              <Input
                value={draft.monitoringPrompt}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, monitoringPrompt: event.target.value }))
                }
                placeholder="Enter the topic you want to monitor"
                className="h-12 rounded-xl border-slate-200 px-4 text-sm"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center justify-end gap-3">
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button onClick={() => void runOrganizer()} disabled={organizing}>
                {organizing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Analyze topic
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2 lg:col-span-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Monitoring topic
                </label>
                <Input
                  value={draft.monitoringPrompt}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, monitoringPrompt: event.target.value }))
                  }
                  className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Change the topic and rerun AI analysis before saving or testing again.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runOrganizer()}
                    disabled={organizing || !draft.monitoringPrompt.trim()}
                  >
                    {organizing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Refresh AI suggestions
                  </Button>
                </div>
                {draft.topicWarning && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                      <div>
                        <p className="font-semibold text-amber-900">Topic warning</p>
                        <p className="mt-1 leading-6">{draft.topicWarning}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Topic title
                </label>
                <Input
                  value={draft.displayTitle}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, displayTitle: event.target.value }))
                  }
                  className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Topic group
                </label>
                <select
                  value={groupUuid}
                  onChange={(event) => setGroupUuid(event.target.value)}
                  className="flex h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"
                >
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group.uuid} value={group.uuid}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Query variations
                </label>
                <Button variant="ghost" size="sm" onClick={() => addListField("queries")}>
                  Add
                </Button>
              </div>
              {draft.queries.map((value, index) => (
                <div key={`query-${index}`} className="flex items-center gap-3">
                  <Input
                    value={value}
                    onChange={(event) => updateListField("queries", index, event.target.value)}
                    placeholder="English search query"
                    className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeListField("queries", index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Limit to selected domains
                  </p>
                  <p className="text-sm text-slate-600">
                    {draft.suggestedDomains.length
                      ? `AI suggested ${draft.suggestedDomains.length} trustworthy domains for this topic.`
                      : "Leave this off to search the broader web, or turn it on to curate a domain list."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={draft.limitToSelectedDomains ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDomainLimiting(true)}
                  >
                    Yes
                  </Button>
                  <Button
                    variant={!draft.limitToSelectedDomains ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDomainLimiting(false)}
                  >
                    No
                  </Button>
                </div>
              </div>

              {draft.limitToSelectedDomains && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Selected domains
                    </label>
                    <div className="flex items-center gap-2">
                      {draft.suggestedDomains.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={restoreSuggestedDomains}>
                          Use AI list
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => addListField("domainAllowlist")}>
                        Add
                      </Button>
                    </div>
                  </div>
                  {draft.domainAllowlist.map((value, index) => (
                    <div key={`domain-${index}`} className="flex items-center gap-3">
                      <Input
                        value={value}
                        onChange={(event) =>
                          updateListField("domainAllowlist", index, event.target.value)
                        }
                        placeholder="example.org"
                        className="h-11 rounded-xl border-slate-200 bg-white px-4 text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeListField("domainAllowlist", index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-500">
                      {normalizedDomainAllowlist.length}/20 selected domains
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSuggestMoreDomains()}
                      disabled={!canSuggestMoreDomains || suggestingDomains}
                    >
                      {suggestingDomains ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      Suggest more like this
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Languages
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => addListField("languageFilter")}>
                    Add
                  </Button>
                </div>
                {draft.languageFilter.map((value, index) => (
                  <div key={`language-${index}`} className="flex items-center gap-3">
                    <Input
                      value={value}
                      onChange={(event) =>
                        updateListField("languageFilter", index, event.target.value)
                      }
                      placeholder="en"
                      className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeListField("languageFilter", index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Country
                </label>
                <select
                  value={draft.country}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, country: event.target.value }))
                  }
                  className="flex h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"
                >
                  {COUNTRY_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {previewHasRun && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Test run results
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Rate strong or weak results, then update the topic parameters if the mix looks off.
                    </p>
                  </div>
                  {hasPreviewFeedback && (
                    <span className="text-sm font-medium text-slate-700">
                      {feedbackItems.length} rated result{feedbackItems.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {previewResults.length > 0 ? (
                  <div className="space-y-3">
                    {previewResults.map((item) => {
                      const reaction = previewReactions[item.url];
                      return (
                        <div
                          key={item.url}
                          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                <span>{item.domain || "Unknown domain"}</span>
                                {item.published_at && (
                                  <span>
                                    {new Date(item.published_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-base font-semibold text-slate-900 hover:text-slate-700"
                              >
                                {item.title || item.url}
                              </a>
                              {item.snippet && (
                                <p className="text-sm leading-6 text-slate-600">{item.snippet}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                variant={reaction === "up" ? "default" : "outline"}
                                size="sm"
                                onClick={() => togglePreviewReaction(item.url, "up")}
                              >
                                <ThumbsUp className="mr-2 h-4 w-4" />
                                Good
                              </Button>
                              <Button
                                variant={reaction === "down" ? "default" : "outline"}
                                size="sm"
                                onClick={() => togglePreviewReaction(item.url, "down")}
                              >
                                <ThumbsDown className="mr-2 h-4 w-4" />
                                Bad
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                    No results returned for this test run. Try broader queries or turn off domain limiting.
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-2">
              <div>
                {isEditing && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete topic
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {!isEditing && (
                  <Button variant="outline" onClick={() => setStage("prompt")}>
                    Back
                  </Button>
                )}
                {onCancel && (
                  <Button variant="outline" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => void runPreview()}
                  disabled={previewing || organizing || refining || loading}
                >
                  {previewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Test run
                </Button>
                {hasPreviewFeedback ? (
                  <Button
                    onClick={() => void updateTopicParameters()}
                    disabled={refining || organizing || previewing || loading}
                  >
                    {refining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Update topic parameters
                  </Button>
                ) : (
                  <Button
                    onClick={() => void saveTopic()}
                    disabled={loading || organizing || previewing || refining}
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isEditing ? "Save topic" : "Create topic"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete topic</DialogTitle>
            <DialogDescription>
              Delete this topic permanently? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleteSaving}>
              {deleteSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete topic
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
