import React, { useEffect, useState } from 'react';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createTopic, deleteTopic, updateTopic } from '@/lib/api';
import type { ApiTopicListItem, TopicItem } from '@/lib/types';
import { Plus, X, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type TopicFormMode = "create" | "edit";

const MAX_TOPIC_QUERIES = 5;
const MAX_ADDITIONAL_QUERIES = MAX_TOPIC_QUERIES - 1;

type TopicFormProps = {
  mode: TopicFormMode;
  topicUuid?: string | null;
  onCancel?: () => void;
  onSaved?: (topic: TopicItem, mode: TopicFormMode) => void;
  className?: string;
  variant?: "full" | "dialog";
};

export function TopicForm({
  mode,
  topicUuid,
  onCancel,
  onSaved,
  className,
  variant = "full",
}: TopicFormProps) {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const { selectedGroupId, selectedGroupName, groups, setSelectedTopicUuid } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const isEditing = mode === "edit";
  const isDialog = variant === "dialog";
  const hasExistingTopics = topics.length > 0;
  const activeTopic = isEditing
    ? topics.find((entry) => entry.uuid === topicUuid) ?? null
    : null;
  const selectedGroup = selectedGroupId
    ? groups.find((entry) => entry.uuid === selectedGroupId) ?? null
    : null;
  const isReadOnlyGroup =
    !!selectedGroupId && selectedGroup ? !selectedGroup.is_owner : false;
  const [topicName, setTopicName] = useState("");
  const [queries, setQueries] = useState<string[]>([""]);
  const [domainInputs, setDomainInputs] = useState<string[]>([""]);
  const [domainMode, setDomainMode] = useState<"allow" | "block">("allow");
  const [languageSelections, setLanguageSelections] = useState<string[]>([""]);
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const languageOptions = [
    { value: "en", label: "English" },
    { value: "de", label: "German" },
    { value: "fr", label: "French" },
    { value: "es", label: "Spanish" },
    { value: "pt", label: "Portuguese" },
    { value: "it", label: "Italian" },
    { value: "nl", label: "Dutch" },
    { value: "sv", label: "Swedish" },
    { value: "no", label: "Norwegian" },
    { value: "da", label: "Danish" },
    { value: "fi", label: "Finnish" },
    { value: "pl", label: "Polish" },
    { value: "tr", label: "Turkish" },
    { value: "ru", label: "Russian" },
    { value: "ar", label: "Arabic" },
    { value: "zh", label: "Chinese" },
    { value: "ja", label: "Japanese" },
    { value: "ko", label: "Korean" },
    { value: "hi", label: "Hindi" },
    { value: "id", label: "Indonesian" },
    { value: "th", label: "Thai" },
    { value: "vi", label: "Vietnamese" },
  ];

  const toTopicItem = (topic: ApiTopicListItem): TopicItem => ({
    id: topic.id,
    uuid: topic.uuid,
    queries: topic.queries ?? [],
    term: topic.queries?.[0] || "Untitled",
    category: "General",
    isActive: topic.is_active,
    lastSearch: topic.last_fetched_at ? new Date(topic.last_fetched_at) : null,
    hasNewItems: topic.content_source_count > 0,
    groupUuid: topic.group_uuid,
    groupName: topic.group_name,
    ownerUsername: topic.owner_username,
    isOwner: topic.is_owner,
    domainAllowlist: topic.search_domain_allowlist,
    domainBlocklist: topic.search_domain_blocklist,
    languageFilter: topic.search_language_filter,
    country: topic.country,
    updateFrequency: topic.update_frequency,
  });

  const normalizeList = (values: string[]) =>
    Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));

  const requireAuth = () => {
    if (isAuthenticated) {
      return true;
    }
    openAuthDialog();
    return false;
  };

  const resetForm = () => {
    setTopicName("");
    setQueries([""]);
    setDomainInputs([""]);
    setDomainMode("allow");
    setLanguageSelections([""]);
    setCountry("");
    setError(null);
  };

  const applyTopicToForm = (topic: TopicItem) => {
    setTopicName(topic.queries[0] ?? "");
    const additionalQueries = topic.queries.slice(1, MAX_TOPIC_QUERIES);
    setQueries(additionalQueries.length ? additionalQueries : [""]);
    if (topic.domainAllowlist?.length) {
      setDomainMode("allow");
      setDomainInputs(topic.domainAllowlist.length ? topic.domainAllowlist : [""]);
    } else if (topic.domainBlocklist?.length) {
      setDomainMode("block");
      setDomainInputs(topic.domainBlocklist.length ? topic.domainBlocklist : [""]);
    } else {
      setDomainMode("allow");
      setDomainInputs([""]);
    }
    setLanguageSelections(
      topic.languageFilter?.length ? topic.languageFilter : [""]
    );
    setCountry(topic.country ?? "");
    setError(null);
  };

  useEffect(() => {
    if (!isEditing) {
      resetForm();
      return;
    }
    if (activeTopic) {
      applyTopicToForm(activeTopic);
    }
  }, [activeTopic, isEditing]);

  const updateQuery = (index: number, value: string) => {
    setQueries((prev) => prev.map((query, i) => (i === index ? value : query)));
  };

  const addQueryField = () => {
    setQueries((prev) =>
      prev.length < MAX_ADDITIONAL_QUERIES ? [...prev, ""] : prev
    );
  };

  const removeQueryField = (index: number) => {
    setQueries((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const updateDomainInput = (index: number, value: string) => {
    setDomainInputs((prev) => prev.map((entry, i) => (i === index ? value : entry)));
  };

  const addDomainInput = () => {
    setDomainInputs((prev) => [...prev, ""]);
  };

  const removeDomainInput = (index: number) => {
    setDomainInputs((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );
  };

  const updateLanguageSelection = (index: number, value: string) => {
    setLanguageSelections((prev) => prev.map((entry, i) => (i === index ? value : entry)));
  };

  const addLanguageSelection = () => {
    setLanguageSelections((prev) => [...prev, ""]);
  };

  const removeLanguageSelection = (index: number) => {
    setLanguageSelections((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );
  };

  const addTopic = async () => {
    const normalizedQueries = [topicName, ...queries]
      .map((query) => query.trim())
      .filter(Boolean);
    if (!normalizedQueries.length) return;
    if (normalizedQueries.length > MAX_TOPIC_QUERIES) {
      setError(`Add up to ${MAX_TOPIC_QUERIES} queries total.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const domainList = normalizeList(domainInputs);
      const languageList = normalizeList(languageSelections);
      const response = await createTopic(normalizedQueries, {
        groupUuid: selectedGroupId || null,
        domainAllowlist: domainMode === "allow" ? domainList : null,
        domainBlocklist: domainMode === "block" ? domainList : null,
        languageFilter: languageList,
        country: country ? country : null,
      });
      const created = toTopicItem(response.topic);
      setTopics((prev) => [created, ...prev]);
      resetForm();
      onSaved?.(created, "create");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add topic.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const saveTopic = async () => {
    if (!topicUuid) return;
    const normalizedQueries = [topicName, ...queries]
      .map((query) => query.trim())
      .filter(Boolean);
    if (!normalizedQueries.length) return;
    if (normalizedQueries.length > MAX_TOPIC_QUERIES) {
      setError(`Add up to ${MAX_TOPIC_QUERIES} queries total.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const domainList = normalizeList(domainInputs);
      const languageList = normalizeList(languageSelections);
      const response = await updateTopic(topicUuid, {
        queries: normalizedQueries,
        domainAllowlist: domainMode === "allow" ? domainList : null,
        domainBlocklist: domainMode === "block" ? domainList : null,
        languageFilter: languageList,
        country: country ? country : null,
      });
      const updated = toTopicItem(response);
      setTopics((prev) =>
        prev.map((item) => (item.uuid === updated.uuid ? updated : item))
      );
      onSaved?.(updated, "edit");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update topic.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDialogOpen = (open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      setDeleteError(null);
      setDeleteSaving(false);
    }
  };

  const openDeleteDialog = () => {
    if (!activeTopic) return;
    if (!requireAuth()) return;
    setDeleteError(null);
    handleDeleteDialogOpen(true);
  };

  const handleDeleteTopicConfirm = async () => {
    if (!activeTopic) return;
    if (!requireAuth()) return;
    setDeleteError(null);
    setDeleteSaving(true);
    try {
      await deleteTopic(activeTopic.uuid);
      setTopics((prev) => prev.filter((item) => item.uuid !== activeTopic.uuid));
      setSelectedTopicUuid((prev) => (prev === activeTopic.uuid ? null : prev));
      handleDeleteDialogOpen(false);
      onCancel?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete topic.";
      setDeleteError(message);
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

  if (isEditing && activeTopic && !activeTopic.isOwner) {
    return (
      <Card className={cn("border border-border/60 bg-card/40", className)}>
        <CardHeader>
          <CardTitle>Read-only topic</CardTitle>
          <CardDescription>
            This topic was created by {activeTopic.ownerUsername || "another user"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          )}
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
            This public group belongs to {selectedGroup?.owner_username || "another user"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const groupLabel = selectedGroup?.name ?? selectedGroupName ?? "this group";
  const heroTitle = isEditing
    ? "Edit topic details"
    : hasExistingTopics
      ? "Create a topic"
      : "Create your first topic";
  const heroDescription = isEditing
    ? "Update the topic queries and filters for this group."
    : `Topics are the lifeblood of NewsRadar. A topic consists of a primary term and optional variations to capture a wider range of relevant signals.`;

  return (
    <Card
      className={cn(
        "flex h-full flex-col border-none bg-white shadow-none rounded-none font-satoshi",
        className
      )}
    >
      {!isDialog ? (
        <div className="border-b border-slate-100 bg-slate-50/30 p-6 md:p-8 lg:p-12">
          <div className="max-w-3xl flex justify-between items-start gap-8">
            <div>
              <h2 className="text-3xl font-display font-bold text-slate-900 mb-4">
                {heroTitle}
              </h2>
              <p className="text-slate-600 text-lg leading-relaxed">
                {isEditing ? (
                  heroDescription
                ) : (
                  <>
                    Topics are the lifeblood of NewsRadar. A topic consists of a primary term and optional
                    variations to capture a wider range of relevant signals.
                  </>
                )}
              </p>
            </div>
            {!isEditing && onCancel && hasExistingTopics && (
              <button
                className="h-10 w-10 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                onClick={onCancel}
                type="button"
              >
                <span className="sr-only">Close</span>
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <CardHeader className="border-b border-border/60">
          <CardTitle>{isEditing ? "Edit Topic" : "Add New Topic"}</CardTitle>
          <CardDescription>
            {isEditing
              ? "Update the topic queries and filters for this group."
              : "Configure a new topic for the AI radar to monitor."}
          </CardDescription>
        </CardHeader>
      )}

      <CardContent className={cn("flex-1", isDialog ? "p-6" : "p-6 md:p-8 lg:p-12")}>
        <div className={cn("space-y-10", isDialog ? "" : "max-w-4xl")}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Topic primary term
              </label>
              <Input
                placeholder="e.g. Electric Vehicle Infrastructure"
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                className="h-11 rounded-lg border-slate-200 bg-white px-4 text-sm focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Additional queries to extend the search</p>
            </div>
            <div className="space-y-4">
              {queries.map((query, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Input
                    placeholder="Query variation or keyword"
                    value={query}
                    onChange={(event) => updateQuery(index, event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && void (isEditing ? saveTopic() : addTopic())
                    }
                    className="h-11 rounded-lg border-slate-200 bg-white px-4 text-sm focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
                  />
                  <button
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    onClick={() => removeQueryField(index)}
                    type="button"
                    disabled={queries.length === 1}
                  >
                    <span className="sr-only">Remove query</span>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                className="flex items-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 px-1 py-1 rounded transition-colors w-fit uppercase tracking-widest disabled:opacity-50"
                onClick={addQueryField}
                type="button"
                disabled={queries.length >= MAX_ADDITIONAL_QUERIES}
              >
                <PlusCircle className="h-4 w-4" />
                Add another query variation
              </button>
            </div>
          </div>

          <div className="pt-1 border-slate-100 space-y-6">
            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-slate-400">
              <span className="shrink-0">Domain filters</span>
              <div className="h-px flex-1 bg-slate-100"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Mode
                </label>
                <select
                  className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all appearance-none cursor-pointer"
                  value={domainMode}
                  onChange={(event) => setDomainMode(event.target.value as "allow" | "block")}
                >
                  <option value="allow">Restrict to these domains</option>
                  <option value="block">Exclude these domains</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Domains
                </label>
                <div className="space-y-3">
                  {domainInputs.map((domain, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <Input
                        placeholder="e.g. bloomberg.com"
                        value={domain}
                        onChange={(event) => updateDomainInput(index, event.target.value)}
                        className="h-11 rounded-lg border-slate-200 bg-white px-4 text-sm focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
                      />
                      <button
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        onClick={() => removeDomainInput(index)}
                        type="button"
                        disabled={domainInputs.length === 1}
                      >
                        <span className="sr-only">Remove domain</span>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    className="flex items-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 px-1 py-1 rounded transition-colors w-fit uppercase tracking-widest"
                    onClick={addDomainInput}
                    type="button"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Add another domain
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-slate-400">
              <span className="shrink-0">Locality filters</span>
              <div className="h-px flex-1 bg-slate-100"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Country
                </label>
                <select
                  className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all appearance-none cursor-pointer"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                >
                  <option value="">All countries</option>
                  <option value="AU">Australia</option>
                  <option value="BR">Brazil</option>
                  <option value="CA">Canada</option>
                  <option value="CN">China</option>
                  <option value="FR">France</option>
                  <option value="DE">Germany</option>
                  <option value="IN">India</option>
                  <option value="IE">Ireland</option>
                  <option value="IL">Israel</option>
                  <option value="IT">Italy</option>
                  <option value="JP">Japan</option>
                  <option value="MX">Mexico</option>
                  <option value="NL">Netherlands</option>
                  <option value="NZ">New Zealand</option>
                  <option value="NO">Norway</option>
                  <option value="PL">Poland</option>
                  <option value="SG">Singapore</option>
                  <option value="ZA">South Africa</option>
                  <option value="ES">Spain</option>
                  <option value="SE">Sweden</option>
                  <option value="CH">Switzerland</option>
                  <option value="TR">Turkey</option>
                  <option value="AE">United Arab Emirates</option>
                  <option value="GB">United Kingdom</option>
                  <option value="US">United States</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Languages
                </label>
                <div className="space-y-3">
                  {languageSelections.map((language, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <select
                        className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all appearance-none cursor-pointer"
                        value={language}
                        onChange={(event) => updateLanguageSelection(index, event.target.value)}
                      >
                        <option value="">Select language</option>
                        {languageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        onClick={() => removeLanguageSelection(index)}
                        type="button"
                        disabled={languageSelections.length === 1}
                      >
                        <span className="sr-only">Remove language</span>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    className="flex items-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 px-1 py-1 rounded transition-colors w-fit uppercase tracking-widest"
                    onClick={addLanguageSelection}
                    type="button"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Add another language
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          <div className="flex items-center gap-3 pt-4">
            {isEditing && activeTopic && (
              <button
                className="px-6 py-2.5 text-sm font-semibold text-destructive hover:text-destructive/90 hover:bg-destructive/10 rounded-lg transition-colors"
                onClick={openDeleteDialog}
                type="button"
                disabled={deleteSaving}
              >
                Delete topic
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              {onCancel && (isEditing || hasExistingTopics) && (
                <button
                  className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                  onClick={onCancel}
                  type="button"
                >
                  Cancel
                </button>
              )}
              <Button
                onClick={() => void (isEditing ? saveTopic() : addTopic())}
                className="px-10 py-3 h-auto bg-emerald-600 text-white rounded-lg text-base font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 hover:-translate-y-0.5 transition-all gap-2"
                disabled={loading}
              >
                <Plus className="h-4 w-4" /> {isEditing ? "Save" : "Create Topic"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      {isEditing && activeTopic && (
        <Dialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete topic</DialogTitle>
              <DialogDescription>
                Delete "{activeTopic.term}"? This will permanently remove the topic.
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => handleDeleteDialogOpen(false)}
                disabled={deleteSaving}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDeleteTopicConfirm()}
                disabled={deleteSaving}
              >
                {deleteSaving ? "Deleting..." : "Delete topic"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
