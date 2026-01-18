import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTopic, updateTopic } from '@/lib/api';
import type { ApiTopicListItem, TopicItem } from '@/lib/types';
import { Plus, X, PlusCircle } from 'lucide-react';

export default function Topics() {
  const { selectedGroupName, selectedGroupId } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const [searchParams, setSearchParams] = useSearchParams();
  const editingTopicId = searchParams.get("edit");
  const [isEditing, setIsEditing] = useState(false);
  const [queries, setQueries] = useState<string[]>([""]);
  const [domainInput, setDomainInput] = useState("");
  const [domainMode, setDomainMode] = useState<"allow" | "block">("allow");
  const [languageInput, setLanguageInput] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    domainAllowlist: topic.search_domain_allowlist,
    domainBlocklist: topic.search_domain_blocklist,
    languageFilter: topic.search_language_filter,
    country: topic.country,
    searchRecencyFilter: topic.search_recency_filter,
  });

  const updateQuery = (index: number, value: string) => {
    setQueries((prev) => prev.map((query, i) => (i === index ? value : query)));
  };

  const addQueryField = () => {
    setQueries((prev) => [...prev, ""]);
  };

  const removeQueryField = (index: number) => {
    setQueries((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const parseCommaList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const resetForm = () => {
    setQueries([""]);
    setDomainInput("");
    setDomainMode("allow");
    setLanguageInput("");
    setCountry("");
  };

  const applyTopicToForm = (topic: TopicItem) => {
    setQueries(topic.queries.length ? topic.queries : [""]);
    if (topic.domainAllowlist?.length) {
      setDomainMode("allow");
      setDomainInput(topic.domainAllowlist.join(", "));
    } else if (topic.domainBlocklist?.length) {
      setDomainMode("block");
      setDomainInput(topic.domainBlocklist.join(", "));
    } else {
      setDomainMode("allow");
      setDomainInput("");
    }
    setLanguageInput(topic.languageFilter?.join(", ") ?? "");
    setCountry(topic.country ?? "");
  };

  const clearEditMode = () => {
    setIsEditing(false);
    resetForm();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("edit");
    setSearchParams(nextParams);
  };

  useEffect(() => {
    if (!editingTopicId) {
      if (isEditing) {
        resetForm();
      }
      setIsEditing(false);
      return;
    }
    const topic = topics.find((entry) => entry.uuid === editingTopicId);
    if (topic) {
      setIsEditing(true);
      applyTopicToForm(topic);
    }
  }, [editingTopicId, isEditing, topics]);

  const addTopic = async () => {
    const normalizedQueries = queries.map((query) => query.trim()).filter(Boolean);
    if (!normalizedQueries.length) return;
    setError(null);
    setLoading(true);
    try {
      const domainList = parseCommaList(domainInput);
      const languageList = parseCommaList(languageInput);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add topic.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const saveTopic = async () => {
    if (!editingTopicId) return;
    const normalizedQueries = queries.map((query) => query.trim()).filter(Boolean);
    if (!normalizedQueries.length) return;
    setError(null);
    setLoading(true);
    try {
      const domainList = parseCommaList(domainInput);
      const languageList = parseCommaList(languageInput);
      const response = await updateTopic(editingTopicId, {
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
      clearEditMode();
      resetForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update topic.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto space-y-8 p-4 md:p-6 lg:p-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{selectedGroupName}</h2>
          <p className="text-muted-foreground mt-1">Manage monitoring targets and AI search parameters.</p>
        </div>

        <Card>
           <CardHeader>
              <CardTitle>{isEditing ? "Edit Topic" : "Add New Topic"}</CardTitle>
              <CardDescription>
                {isEditing
                  ? "Update the topic queries and filters for this group."
                  : "Configure a new topic for the AI radar to monitor."}
              </CardDescription>
           </CardHeader>
           <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Queries</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={addQueryField}
                    type="button"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Add another
                  </Button>
                </div>
                <div className="space-y-3">
                  {queries.map((query, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <Input
                        placeholder="Enter a topic query"
                        value={query}
                        onChange={(e) => updateQuery(index, e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && void (isEditing ? saveTopic() : addTopic())
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-destructive"
                        onClick={() => removeQueryField(index)}
                        type="button"
                        disabled={queries.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border/60 pt-6 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    Advanced options
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
                <div className="grid gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Domains
                      </label>
                      <Input
                        placeholder="example.com, news.site"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Domain mode
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={domainMode}
                        onChange={(e) => setDomainMode(e.target.value as "allow" | "block")}
                      >
                        <option value="allow">Restrict to domains</option>
                        <option value="block">Exclude domains</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Languages
                      </label>
                      <Input
                        placeholder="en, fr, de"
                        value={languageInput}
                        onChange={(e) => setLanguageInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Country
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
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
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                {isEditing && (
                  <Button variant="outline" onClick={clearEditMode} disabled={loading}>
                    Cancel
                  </Button>
                )}
                <Button
                  onClick={() => void (isEditing ? saveTopic() : addTopic())}
                  className="gap-2"
                  disabled={loading}
                >
                  <Plus className="h-4 w-4" /> {isEditing ? "Save" : "Add"}
                </Button>
              </div>
           </CardContent>
        </Card>
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}
      </div>
    </Layout>
  );
}
