import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Star,
  Trash2,
  RefreshCw,
  Pencil,
} from "lucide-react";

import { Layout } from "@/components/Layout";
import { useAuthDialog } from "@/components/AuthDialogContext";
import { useTopicGroup } from "@/components/TopicGroupContext";
import { useTopics } from "@/components/TopicsContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createBookmark,
  deleteBookmark,
  deleteContentItem,
  getExecution,
  listContentByGroup,
  listContentFeed,
  requestContentAIResponse,
  runTopicScan,
} from "@/lib/api";
import type { ApiAIInteractionResponse, ApiContentFeedItem, NewsItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const AI_PRESETS = [
  "Summarize the most important developments in this feed.",
  "List the most actionable facts as bullet points.",
  "Highlight risks, opportunities, and open questions.",
];

function mapNewsItem(item: ApiContentFeedItem): NewsItem {
  const timestamp = new Date(item.published_at || item.created_at);
  const fetchedAt = new Date(item.created_at);
  return {
    id: item.id,
    title: item.title || item.url,
    summary: item.summary || "Summary not available.",
    source: item.source || "Unknown",
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    fetchedAt: Number.isNaN(fetchedAt.getTime()) ? new Date() : fetchedAt,
    relevanceScore: item.relevance_score ?? 0,
    keywords: item.topic_queries ?? [],
    url: item.url,
    isBookmarked: item.is_bookmarked,
  };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const {
    selectedGroupId,
    selectedGroupName,
    selectedTopicUuid,
  } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const selectedTopic = selectedTopicUuid
    ? topics.find((topic) => topic.uuid === selectedTopicUuid) ?? null
    : null;

  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [domainFilters, setDomainFilters] = useState<string[]>([]);
  const [aiInstruction, setAiInstruction] = useState(AI_PRESETS[0]);
  const [aiResponse, setAiResponse] = useState<ApiAIInteractionResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (isAuthenticated === null) return;
    if (isAuthenticated !== true && (selectedTopicUuid || selectedGroupId)) {
      openAuthDialog();
      return;
    }
    if (isAuthenticated !== true) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const request = selectedTopicUuid
      ? listContentFeed({
          topicUuid: selectedTopicUuid,
          onlyNew: newOnly,
          search: debouncedSearchTerm || undefined,
        })
      : selectedGroupId
        ? listContentByGroup(selectedGroupId, {
            onlyNew: newOnly,
            search: debouncedSearchTerm || undefined,
          })
        : listContentFeed({
            onlyNew: newOnly,
            search: debouncedSearchTerm || undefined,
          });

    request
      .then((response) => {
        setItems(response.items.map(mapNewsItem));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Unable to load content feed.";
        setError(message);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [debouncedSearchTerm, isAuthenticated, newOnly, openAuthDialog, selectedGroupId, selectedTopicUuid]);

  const availableDomains = useMemo(
    () => Array.from(new Set(items.map((item) => item.source).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (domainFilters.length && !domainFilters.includes(item.source)) return false;
      if (bookmarkedOnly && !item.isBookmarked) return false;
      return true;
    });
  }, [bookmarkedOnly, domainFilters, items]);

  const selectedTopicLabel = selectedTopic?.term;
  const heading = selectedTopicLabel || selectedGroupName || "All topics";

  const requireAuth = () => {
    if (isAuthenticated) return true;
    openAuthDialog();
    return false;
  };

  const waitForExecutionCompletion = async (executionId: number) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const execution = await getExecution(executionId);
      if (execution.status === "completed") return execution;
      if (execution.status === "failed") {
        throw new Error(execution.error_message || "Scan failed.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Timed out waiting for the scan to finish.");
  };

  const reloadFeed = async () => {
    const response = selectedTopicUuid
      ? await listContentFeed({
          topicUuid: selectedTopicUuid,
          onlyNew: newOnly,
          search: debouncedSearchTerm || undefined,
        })
      : selectedGroupId
        ? await listContentByGroup(selectedGroupId, {
            onlyNew: newOnly,
            search: debouncedSearchTerm || undefined,
          })
        : await listContentFeed({
            onlyNew: newOnly,
            search: debouncedSearchTerm || undefined,
          });
    setItems(response.items.map(mapNewsItem));
  };

  const handleScanNow = async () => {
    if (!selectedTopicUuid) return;
    if (!requireAuth()) return;
    setScanning(true);
    setError(null);
    try {
      const { execution_id } = await runTopicScan(selectedTopicUuid);
      await waitForExecutionCompletion(execution_id);
      const scannedAt = new Date();
      setTopics((prev) =>
        prev.map((topic) =>
          topic.uuid === selectedTopicUuid
            ? { ...topic, lastSearch: scannedAt }
            : topic
        )
      );
      await reloadFeed();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to scan this topic.";
      setError(message);
    } finally {
      setScanning(false);
    }
  };

  const toggleBookmark = async (item: NewsItem) => {
    if (!requireAuth()) return;
    const nextValue = !item.isBookmarked;
    setItems((prev) =>
      prev.map((entry) => (entry.id === item.id ? { ...entry, isBookmarked: nextValue } : entry))
    );
    try {
      if (nextValue) {
        await createBookmark(item.id);
      } else {
        await deleteBookmark(item.id);
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((entry) => (entry.id === item.id ? { ...entry, isBookmarked: item.isBookmarked } : entry))
      );
      const message = err instanceof Error ? err.message : "Unable to update bookmark.";
      setError(message);
    }
  };

  const handleDelete = async (item: NewsItem) => {
    if (!requireAuth()) return;
    setDeletingId(item.id);
    setError(null);
    try {
      await deleteContentItem(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete content.";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRunAI = async () => {
    if (!requireAuth()) return;
    const contentIds = filteredItems.map((item) => item.id);
    if (!contentIds.length) {
      setError("No content in the current feed to analyze.");
      return;
    }
    setAiLoading(true);
    setError(null);
    try {
      const response = await requestContentAIResponse({
        contentIds,
        instruction: aiInstruction,
      });
      setAiResponse(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to run AI analysis.";
      setError(message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-6 lg:p-10">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-600">
              Intelligence feed
            </p>
            <h2 className="mt-2 text-4xl font-bold text-slate-900">{heading}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {selectedTopic
                ? `Monitoring prompt: ${selectedTopic.monitoringPrompt}`
                : "Browse the latest saved search results across your monitoring topics."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {selectedTopic && (
              <>
                <Button variant="outline" onClick={() => navigate(`/topics?edit=${selectedTopic.uuid}`)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit topic
                </Button>
                <Button onClick={() => void handleScanNow()} disabled={scanning}>
                  {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Scan now
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search titles, snippets, URLs"
                  className="h-10 rounded-full border-slate-200 pl-10"
                />
              </div>

              <Button
                variant={newOnly ? "secondary" : "outline"}
                onClick={() => {
                  if (!requireAuth()) return;
                  setNewOnly((prev) => !prev);
                }}
              >
                New only
              </Button>
              <Button
                variant={bookmarkedOnly ? "secondary" : "outline"}
                onClick={() => {
                  if (!requireAuth()) return;
                  setBookmarkedOnly((prev) => !prev);
                }}
              >
                Bookmarked
              </Button>
            </div>

            {availableDomains.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={domainFilters.length === 0 ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setDomainFilters([])}
                >
                  All domains
                </Button>
                {availableDomains.map((domain) => {
                  const active = domainFilters.includes(domain);
                  return (
                    <Button
                      key={domain}
                      variant={active ? "secondary" : "outline"}
                      size="sm"
                      onClick={() =>
                        setDomainFilters((prev) =>
                          active ? prev.filter((entry) => entry !== domain) : [...prev, domain]
                        )
                      }
                    >
                      {domain}
                    </Button>
                  );
                })}
              </div>
            )}

            {error && (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
              </Card>
            )}

            {loading ? (
              <Card>
                <CardContent className="flex items-center gap-3 p-6 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading content feed...
                </CardContent>
              </Card>
            ) : filteredItems.length === 0 ? (
              <Card className="border-dashed border-slate-200">
                <CardContent className="p-10 text-center">
                  <p className="text-base font-semibold text-slate-900">No matching content</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Try changing filters or run a new scan for the selected topic.
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredItems.map((item) => (
                <Card key={item.id} className="border-slate-200 shadow-sm">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{item.source}</Badge>
                          <span className="text-xs text-slate-500">
                            {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate(`/content/${item.id}/full`)}
                          className="text-left text-2xl font-bold leading-tight text-slate-900 transition-colors hover:text-emerald-700"
                        >
                          {item.title}
                        </button>
                        <p className="text-sm leading-relaxed text-slate-600">{item.summary}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void toggleBookmark(item)}
                          className={cn(item.isBookmarked ? "text-amber-500" : "text-slate-400")}
                        >
                          <Star className={cn("h-4 w-4", item.isBookmarked ? "fill-current" : "")} />
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <a href={item.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDelete(item)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {item.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {item.keywords.slice(0, 5).map((keyword) => (
                          <Badge key={`${item.id}-${keyword}`} variant="outline">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="space-y-4">
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                  AI analysis
                </CardTitle>
                <CardDescription>
                  Run an instruction across the current filtered feed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {AI_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      variant={preset === aiInstruction ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setAiInstruction(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <textarea
                  value={aiInstruction}
                  onChange={(event) => setAiInstruction(event.target.value)}
                  className="min-h-[140px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
                />
                <Button onClick={() => void handleRunAI()} disabled={aiLoading}>
                  {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Run AI analysis
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle>AI output</CardTitle>
                <CardDescription>
                  Responses are generated from the current filtered content set.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {aiResponse ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    className="space-y-3 text-sm leading-relaxed text-slate-700"
                  >
                    {aiResponse.answer}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm text-slate-500">
                    Run an AI instruction to see the result here.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
