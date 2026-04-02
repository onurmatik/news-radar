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
import { createTopic, deleteTopic, organizeTopic, updateTopic } from "@/lib/api";
import type { ApiTopicListItem, TopicDraft, TopicItem } from "@/lib/types";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
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
  primaryQuery: "",
  queryVariations: [""],
  domainAllowlist: [""],
  sourceSuggestions: [],
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
  return {
    monitoringPrompt: topic.monitoringPrompt,
    displayTitle: topic.displayTitle,
    primaryQuery: topic.queries[0] ?? "",
    queryVariations: topic.queries.slice(1).length ? topic.queries.slice(1) : [""],
    domainAllowlist: topic.domainAllowlist?.length ? topic.domainAllowlist : [""],
    sourceSuggestions: [],
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

export function TopicForm({
  mode,
  topicUuid,
  onCancel,
  onSaved,
  className,
  variant = "full",
}: TopicFormProps) {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const { selectedGroupId, groups, setSelectedTopicUuid } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const isEditing = mode === "edit";
  const isDialog = variant === "dialog";
  const activeTopic = isEditing
    ? topics.find((entry) => entry.uuid === topicUuid) ?? null
    : null;
  const selectedGroup = selectedGroupId
    ? groups.find((entry) => entry.uuid === selectedGroupId) ?? null
    : null;
  const isReadOnlyGroup = selectedGroup ? !selectedGroup.is_owner : false;
  const [stage, setStage] = useState<TopicFormStage>(isEditing ? "review" : "prompt");
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_DRAFT);
  const [groupUuid, setGroupUuid] = useState<string>(selectedGroupId || "");
  const [loading, setLoading] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [lastOrganizedPrompt, setLastOrganizedPrompt] = useState("");

  const requireAuth = () => {
    if (isAuthenticated) return true;
    openAuthDialog();
    return false;
  };

  useEffect(() => {
    if (!isEditing) {
      setStage("prompt");
      setDraft(EMPTY_DRAFT);
      setGroupUuid(selectedGroupId || "");
      setError(null);
      setLastOrganizedPrompt("");
      return;
    }
    if (activeTopic) {
      const nextDraft = toDraftFromTopic(activeTopic);
      setDraft(nextDraft);
      setStage("review");
      setGroupUuid(activeTopic.groupUuid || "");
      setError(null);
      setLastOrganizedPrompt(activeTopic.monitoringPrompt);
    }
  }, [activeTopic, isEditing, selectedGroupId]);

  const hasPendingPromptChanges = useMemo(() => {
    return draft.monitoringPrompt.trim() !== lastOrganizedPrompt.trim();
  }, [draft.monitoringPrompt, lastOrganizedPrompt]);

  const updateListField = (
    field: "queryVariations" | "domainAllowlist" | "languageFilter",
    index: number,
    value: string
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: (prev[field] as string[]).map((entry, i) => (i === index ? value : entry)),
    }));
  };

  const addListField = (field: "queryVariations" | "domainAllowlist" | "languageFilter") => {
    setDraft((prev) => ({
      ...prev,
      [field]: [...prev[field], ""],
    }));
  };

  const removeListField = (
    field: "queryVariations" | "domainAllowlist" | "languageFilter",
    index: number
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: ensureAtLeastOne(prev[field].filter((_, currentIndex) => currentIndex !== index)),
    }));
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
        groupUuid: groupUuid || null,
      });
      setDraft({
        monitoringPrompt: prompt,
        displayTitle: response.display_title,
        primaryQuery: response.primary_query,
        queryVariations: response.query_variations.length ? response.query_variations : [""],
        domainAllowlist: response.search_domain_allowlist?.length
          ? response.search_domain_allowlist
          : [""],
        sourceSuggestions: response.source_suggestions,
        languageFilter: response.search_language_filter?.length
          ? response.search_language_filter
          : [""],
        country: response.country ?? "",
        updateFrequency: response.update_frequency,
        autoEffectiveIntervalHours: response.suggested_interval_hours,
      });
      setLastOrganizedPrompt(prompt);
      setStage("review");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to organize this topic.";
      setError(message);
    } finally {
      setOrganizing(false);
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
    if (!draft.primaryQuery.trim()) {
      setError("Primary query cannot be empty.");
      return;
    }
    if (hasPendingPromptChanges) {
      setError("Refresh AI suggestions after editing the monitoring prompt before saving.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        monitoringPrompt: draft.monitoringPrompt.trim(),
        displayTitle: draft.displayTitle.trim(),
        primaryQuery: draft.primaryQuery.trim(),
        queryVariations: normalizeList(draft.queryVariations),
        groupUuid: groupUuid || null,
        domainAllowlist: normalizeList(draft.domainAllowlist),
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

  if (isEditing && !activeTopic) {
    return (
      <Card className={cn("border border-border/60 bg-card/40", className)}>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Select a topic to edit.
        </CardContent>
      </Card>
    );
  }

  if (!isEditing && isReadOnlyGroup) {
    return (
      <Card className={cn("border border-border/60 bg-card/40", className)}>
        <CardHeader>
          <CardTitle>Read-only group</CardTitle>
          <CardDescription>
            This group belongs to {selectedGroup?.owner_username || "another user"}.
          </CardDescription>
        </CardHeader>
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
          Start with one prompt. The AI organizer will turn it into a clean monitoring setup you can still edit before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-8", isDialog ? "p-6" : "px-6 py-8 md:px-10")}>
        {stage === "prompt" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                What topics do you want to monitor?
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

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Topic group (optional)
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
                  Monitoring prompt
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
                    Change the prompt and rerun the organizer to refresh title, queries, domains, and locality suggestions.
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

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Primary query
                </label>
                <Input
                  value={draft.primaryQuery}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, primaryQuery: event.target.value }))
                  }
                  className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Scan frequency
                </label>
                <select
                  value={draft.updateFrequency}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      updateFrequency: event.target.value as TopicDraft["updateFrequency"],
                    }))
                  }
                  className="flex h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"
                >
                  <option value="auto">Auto</option>
                  <option value="hour">Hourly</option>
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="manual">Manual</option>
                </select>
                {draft.updateFrequency === "auto" && (
                  <p className="text-xs text-slate-500">
                    Currently every {draft.autoEffectiveIntervalHours ?? 24} hours.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Query variations
                </label>
                <Button variant="ghost" size="sm" onClick={() => addListField("queryVariations")}>
                  Add
                </Button>
              </div>
              {draft.queryVariations.map((value, index) => (
                <div key={`variation-${index}`} className="flex items-center gap-3">
                  <Input
                    value={value}
                    onChange={(event) =>
                      updateListField("queryVariations", index, event.target.value)
                    }
                    placeholder="Additional query variation"
                    className="h-11 rounded-xl border-slate-200 px-4 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeListField("queryVariations", index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Source domains
                </label>
                <Button variant="ghost" size="sm" onClick={() => addListField("domainAllowlist")}>
                  Add
                </Button>
              </div>
              {draft.domainAllowlist.map((value, index) => (
                <div key={`domain-${index}`} className="flex items-center gap-3">
                  <Input
                    value={value}
                    onChange={(event) => updateListField("domainAllowlist", index, event.target.value)}
                    placeholder="example.org"
                    className="h-11 rounded-xl border-slate-200 px-4 text-sm"
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
              {draft.sourceSuggestions.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    AI source suggestions
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    {draft.sourceSuggestions.map((item) => (
                      <div key={item.domain}>
                        <span className="font-semibold text-slate-900">{item.domain}</span>
                        {item.rationale ? ` - ${item.rationale}` : ""}
                      </div>
                    ))}
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
                      onChange={(event) => updateListField("languageFilter", index, event.target.value)}
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
              <div className="flex items-center gap-3">
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
                <Button onClick={() => void saveTopic()} disabled={loading || organizing}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isEditing ? "Save topic" : "Create topic"}
                </Button>
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
