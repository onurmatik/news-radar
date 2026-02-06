import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createBookmark, deleteBookmark, getExecution, listContentByGroup, listContentFeed, runTopicScan, updateTopicGroup } from '@/lib/api';
import type { ApiContentFeedItem, NewsItem } from '@/lib/types';
import { ExternalLink, Clock, Share2, Filter, Star, PlusCircle, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Dashboard component serving as the main interface.
 * 
 * Displays:
 * - Intelligence feed of captured content.
 * - Read/edit views for topic groups and topics.
 * - Categorized filtering of the news radar.
 */
export default function Dashboard() {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const {
    selectedGroupId,
    selectedGroupName,
    selectedGroupTopicCount,
    selectedTopicUuid,
    setSelectedTopicUuid,
    groups,
    setGroups,
  } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilters, setDomainFilters] = useState<string[]>([]);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [domainMenuOpen, setDomainMenuOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupIsPublic, setGroupIsPublic] = useState(false);
  const [groupUpdateFrequency, setGroupUpdateFrequency] = useState<
    "day" | "week" | "manual"
  >("manual");
  const [groupLanguageInput, setGroupLanguageInput] = useState("");
  const [groupCountry, setGroupCountry] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [apiPanelOpen, setApiPanelOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const feedCache = useRef<Map<string, NewsItem[]>>(new Map());
  const latestRequestId = useRef(0);
  const pageTopRef = useRef<HTMLDivElement | null>(null);
  const domainMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedGroup = groups.find((group) => group.uuid === selectedGroupId) ?? null;
  const selectedTopic = selectedTopicUuid
    ? topics.find((topic) => topic.uuid === selectedTopicUuid) ?? null
    : null;
  const contentTitle = selectedTopic
    ? `${selectedGroupName} / ${selectedTopic.term}`
    : selectedGroupName;
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const topicEndpoint = selectedTopicUuid
    ? `${apiBaseUrl}/api/contents/topics/${selectedTopicUuid}`
    : null;
  const groupEndpoint = selectedGroupId
    ? `${apiBaseUrl}/api/contents/groups/${selectedGroupId}`
    : null;
  const topicRssEndpoint = selectedTopicUuid
    ? `${apiBaseUrl}/api/contents/topics/${selectedTopicUuid}/rss`
    : null;
  const groupRssEndpoint = selectedGroupId
    ? `${apiBaseUrl}/api/contents/groups/${selectedGroupId}/rss`
    : null;

  const buildShareUrl = (contentId: number) => {
    if (typeof window === "undefined") {
      return `/content/${contentId}/full`;
    }
    return `${window.location.origin}/content/${contentId}/full`;
  };

  const getSourceLabel = (item: ApiContentFeedItem) => {
    try {
      return new URL(item.url).hostname.replace(/^www\./, "");
    } catch {
      return item.source || "Unknown";
    }
  };

  const normalizeScore = (score: number | null) => {
    if (score === null || Number.isNaN(score)) return 0;
    if (score <= 1) return Math.round(score * 100);
    return Math.round(score);
  };

  const mapNewsItem = (item: ApiContentFeedItem): NewsItem => {
    const keywords = item.topic_queries?.length ? item.topic_queries : ["radar"];
    const timestamp = new Date(item.published_at || item.created_at);
    const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
    const fetchedAt = new Date(item.created_at);
    const safeFetchedAt = Number.isNaN(fetchedAt.getTime()) ? safeTimestamp : fetchedAt;
    return {
      id: item.id,
      title: item.title || item.url,
      summary: item.summary || "Summary not available.",
      source: getSourceLabel(item),
      timestamp: safeTimestamp,
      fetchedAt: safeFetchedAt,
      relevanceScore: normalizeScore(item.relevance_score),
      keywords,
      category: "general",
      url: item.url,
      isBookmarked: item.is_bookmarked,
    };
  };

  const parseCommaList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const getCacheKey = () => {
    if (selectedTopicUuid) {
      return `topic:${selectedTopicUuid}:${newOnly ? "new" : "all"}`;
    }
    if (selectedGroupId) {
      return `group:${selectedGroupId}`;
    }
    return "all";
  };

  const waitForExecutionCompletion = async (executionId: number) => {
    const maxAttempts = 30;
    const delayMs = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const execution = await getExecution(executionId);
      if (execution.status === "completed") {
        return execution;
      }
      if (execution.status === "failed") {
        throw new Error(execution.error_message || "Fetch failed.");
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }
    throw new Error("Timed out waiting for the fetch to finish.");
  };

  useEffect(() => {
    const filter = searchParams.get("filter");
    const shouldEnable = filter === "new";
    if (shouldEnable !== newOnly) {
      setNewOnly(shouldEnable);
    }
  }, [newOnly, searchParams]);

  useEffect(() => {
    if (selectedTopicUuid) return;
    if (!newOnly) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("filter");
    setSearchParams(nextParams, { replace: true });
    setNewOnly(false);
  }, [newOnly, searchParams, selectedTopicUuid, setSearchParams]);


  useEffect(() => {
    if (!selectedGroup) {
      setGroupName("");
      setGroupIsPublic(false);
      setGroupUpdateFrequency("manual");
      setGroupLanguageInput("");
      setGroupCountry("");
      setGroupError(null);
      return;
    }
    setGroupName(selectedGroup.name ?? "");
    setGroupIsPublic(selectedGroup.is_public);
    setGroupUpdateFrequency(selectedGroup.default_update_frequency ?? "manual");
    setGroupLanguageInput(selectedGroup.default_search_language_filter?.join(", ") ?? "");
    setGroupCountry(selectedGroup.default_country ?? "");
    setGroupError(null);
  }, [selectedGroup]);

  const loadFeed = async (cacheKey: string) => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = selectedTopicUuid
        ? await listContentFeed({ topicUuid: selectedTopicUuid, onlyNew: newOnly })
        : selectedGroupId
          ? await listContentByGroup(selectedGroupId)
          : await listContentFeed();
      if (requestId !== latestRequestId.current) return;
      const mapped = response.items
        .map(mapNewsItem)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      feedCache.current.set(cacheKey, mapped);
      setNews(mapped);
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      const message = error instanceof Error ? error.message : "Unable to load feed.";
      setError(message);
      setNews([]);
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated === null) return;
    const cacheKey = getCacheKey();
    const cached = feedCache.current.get(cacheKey);
    if (cached) {
      setNews(cached);
    } else {
      setNews([]);
    }
    setError(null);
    if (!isAuthenticated && !selectedGroupId && !selectedTopicUuid) {
      setLoading(false);
      return;
    }
    void loadFeed(cacheKey);
  }, [isAuthenticated, newOnly, selectedGroupId, selectedTopicUuid]);

  useEffect(() => {
    const handleScanCompleted = (
      event: Event
    ) => {
      const { topicUuid } = (event as CustomEvent<{ topicUuid: string }>).detail ?? {};
      if (!topicUuid) return;
      if (selectedTopicUuid && topicUuid !== selectedTopicUuid) return;

      if (selectedTopicUuid) {
        void loadFeed(getCacheKey());
        return;
      }

      const scannedTopic = topics.find((topic) => topic.uuid === topicUuid);
      if (selectedGroupId && scannedTopic?.groupUuid === selectedGroupId) {
        void loadFeed(getCacheKey());
        return;
      }

      if (!selectedGroupId && !selectedTopicUuid) {
        void loadFeed(getCacheKey());
      }
    };

    window.addEventListener("topic-scan-completed", handleScanCompleted);
    return () => {
      window.removeEventListener("topic-scan-completed", handleScanCompleted);
    };
  }, [newOnly, selectedGroupId, selectedTopicUuid, topics]);

  useEffect(() => {
    pageTopRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [newOnly, selectedGroupId, selectedTopicUuid]);

  useEffect(() => {
    if (!domainMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!domainMenuRef.current?.contains(event.target as Node)) {
        setDomainMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [domainMenuOpen]);

  const toggleBookmark = async (item: NewsItem) => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const nextValue = !item.isBookmarked;
    setNews((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, isBookmarked: nextValue } : entry
      )
    );
    try {
      if (nextValue) {
        await createBookmark(item.id);
      } else {
        await deleteBookmark(item.id);
      }
    } catch (error) {
      setNews((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, isBookmarked: item.isBookmarked } : entry
        )
      );
      const message = error instanceof Error ? error.message : "Unable to update bookmark.";
      setError(message);
    }
  };

  const filteredNews = useMemo(() => {
    return news.filter((item) => {
      if (domainFilters.length > 0 && !domainFilters.includes(item.source)) {
        return false;
      }
      if (bookmarkedOnly && !item.isBookmarked) {
        return false;
      }
      return true;
    });
  }, [bookmarkedOnly, domainFilters, news]);
  const hasActiveFilters = domainFilters.length > 0 || bookmarkedOnly || newOnly;
  const availableDomains = useMemo(
    () =>
      Array.from(new Set(news.map((item) => item.source).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [news]
  );
  const showEmptyState = filteredNews.length === 0 && !loading;
  const hasTopicsInGroup = selectedGroupTopicCount > 0 || Boolean(selectedTopic);
  const countsLabel = hasActiveFilters
    ? `${filteredNews.length} of ${news.length}`
    : `${news.length}`;
  const handleClearFilters = () => {
    setDomainFilters([]);
    setBookmarkedOnly(false);
    if (newOnly) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("filter");
      setSearchParams(nextParams, { replace: true });
      setNewOnly(false);
    }
  };
  const handleToggleDomain = (domain: string) => {
    setDomainFilters((prev) =>
      prev.includes(domain)
        ? prev.filter((entry) => entry !== domain)
        : [...prev, domain]
    );
  };

  const handleToggleNewOnly = () => {
    if (!selectedTopicUuid) return;
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const nextValue = !newOnly;
    const nextParams = new URLSearchParams(searchParams);
    if (nextValue) {
      nextParams.set("filter", "new");
    } else {
      nextParams.delete("filter");
    }
    setSearchParams(nextParams, { replace: true });
    setNewOnly(nextValue);
  };

  const handleAddTopic = () => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    navigate('/topics');
  };

  const handleShare = (item: NewsItem) => {
    const url = buildShareUrl(item.id);
    setShareUrl(url);
    setShareStatus(null);
    setShareDialogOpen(true);
  };

  const handleCopyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("Link copied to clipboard.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to copy the link.";
      setShareStatus(message);
    }
  };

  const handleFetchNow = async () => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const cacheKey = getCacheKey();
    if (!selectedTopicUuid) {
      void loadFeed(cacheKey);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { execution_id } = await runTopicScan(selectedTopicUuid);
      await waitForExecutionCompletion(execution_id);
      const scannedAt = new Date();
      setTopics((prev) =>
        prev.map((item) =>
          item.uuid === selectedTopicUuid ? { ...item, lastSearch: scannedAt } : item
        )
      );
      await loadFeed(cacheKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch content.";
      setError(message);
      setLoading(false);
    }
  };


  const handleSaveGroup = async () => {
    if (!selectedGroup) return;
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setGroupError("Topic group name is required.");
      return;
    }
    setGroupSaving(true);
    setGroupError(null);
    const normalizedLanguages = parseCommaList(groupLanguageInput);
    try {
      await updateTopicGroup(selectedGroup.uuid, {
        name: trimmedName,
        isPublic: groupIsPublic,
        defaultUpdateFrequency: groupUpdateFrequency,
        defaultLanguageFilter: normalizedLanguages.length ? normalizedLanguages : null,
        defaultCountry: groupCountry || null,
      });
      setGroups((prev) =>
        prev.map((group) =>
          group.uuid === selectedGroup.uuid
            ? {
                ...group,
                name: trimmedName,
                is_public: groupIsPublic,
                default_update_frequency: groupUpdateFrequency,
                default_search_language_filter: normalizedLanguages.length
                  ? normalizedLanguages
                  : null,
                default_country: groupCountry || null,
              }
            : group
        )
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update topic group.";
      setGroupError(message);
    } finally {
      setGroupSaving(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto space-y-3 p-4 md:p-6 lg:p-10" ref={pageTopRef}>
        
        {/* Dashboard Header Area */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-border/50 pb-8">
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight text-foreground">
              {selectedTopic ? (
                <span className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-foreground hover:text-primary transition-colors"
                    onClick={() => {
                      setSelectedTopicUuid(null);
                      navigate('/');
                    }}
                  >
                    {selectedGroupName}
                  </button>
                  <span className="text-muted-foreground/60">/</span>
                  <span>{selectedTopic.term}</span>
                </span>
              ) : (
                contentTitle
              )}
            </h2>
            {error && (
              <p className="text-sm text-destructive mt-3">{error}</p>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full px-5"
              onClick={() => setApiPanelOpen(true)}
            >
              API
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full px-5"
              onClick={() => {
                if (!isAuthenticated) {
                  openAuthDialog();
                  return;
                }
                if (selectedTopic) {
                  navigate(`/topics?edit=${selectedTopic.uuid}`);
                  return;
                }
                setConfigDialogOpen(true);
              }}
              title={selectedTopic ? "Edit topic details" : "Configure selection"}
            >
              {selectedTopic ? "Edit" : "Config"}
            </Button>
          </div>
        </div>

        <Dialog open={apiPanelOpen} onOpenChange={setApiPanelOpen}>
          <DialogContent className="sm:max-w-[680px] border-border bg-background">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-xl font-semibold">API & RSS</DialogTitle>
              <DialogDescription>
                Use these URLs to fetch content for the current selection.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  API endpoints
                </p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Topic group content
                  </p>
                  {groupEndpoint ? (
                    <div className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground">
                      {groupEndpoint}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a topic group to see the group endpoint.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Topic content
                  </p>
                  {topicEndpoint ? (
                    <div className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground">
                      {topicEndpoint}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a topic to see the topic endpoint.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  RSS feeds
                </p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Topic group RSS
                  </p>
                  {groupRssEndpoint ? (
                    <div className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground">
                      {groupRssEndpoint}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a topic group to see the RSS feed.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Topic RSS
                  </p>
                  {topicRssEndpoint ? (
                    <div className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground">
                      {topicRssEndpoint}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a topic to see the RSS feed.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
          <DialogContent className="sm:max-w-[520px] border-border bg-background">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-xl font-semibold">Share content</DialogTitle>
              <DialogDescription>
                Copy the link to the full content detail view.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground break-all">
                {shareUrl || "Select a content item to share."}
              </div>
              {shareStatus && (
                <p className="text-xs text-muted-foreground">{shareStatus}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => void handleCopyShare()}
                disabled={!shareUrl}
              >
                Copy link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogContent className="sm:max-w-[720px] border-border bg-background p-0">
            {selectedGroup ? (
              <Card className="border-none bg-transparent shadow-none">
                <CardHeader>
                  <CardTitle>Edit Topic Group</CardTitle>
                  <CardDescription>
                    Update default filters, visibility, and naming for this group.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Topic group name
                    </label>
                    <Input
                      placeholder="Enter topic group name"
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Default update frequency
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={groupUpdateFrequency}
                        onChange={(event) =>
                          setGroupUpdateFrequency(event.target.value as typeof groupUpdateFrequency)
                        }
                      >
                        <option value="manual">Manual</option>
                        <option value="day">Daily</option>
                        <option value="week">Weekly</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Visibility
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={groupIsPublic ? "public" : "private"}
                        onChange={(event) => setGroupIsPublic(event.target.value === "public")}
                      >
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Default languages
                      </label>
                      <Input
                        placeholder="en, fr, de"
                        value={groupLanguageInput}
                        onChange={(event) => setGroupLanguageInput(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Default country
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={groupCountry}
                        onChange={(event) => setGroupCountry(event.target.value)}
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

                  {groupError && (
                    <p className="text-sm text-destructive">{groupError}</p>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setConfigDialogOpen(false)}
                    >
                      Close
                    </Button>
                    <Button
                      onClick={() => void handleSaveGroup()}
                      disabled={groupSaving}
                    >
                      Save changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a topic group to update its configuration.
              </p>
            )}
          </DialogContent>
        </Dialog>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative" ref={domainMenuRef}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3 text-[11px]"
                onClick={() => setDomainMenuOpen((prev) => !prev)}
                aria-expanded={domainMenuOpen}
                aria-haspopup="true"
              >
                {domainFilters.length > 0
                  ? `Domains (${domainFilters.length})`
                  : `All domains (${availableDomains.length})`}
              </Button>
              {domainMenuOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg border border-border/70 bg-background p-3 shadow-lg"
                  role="menu"
                >
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                    <label className="flex items-center gap-2 text-xs text-foreground/80">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={domainFilters.length === 0}
                        onChange={() => setDomainFilters([])}
                      />
                      All domains
                    </label>
                    {availableDomains.length > 0 ? (
                      availableDomains.map((domain) => (
                        <label
                          key={domain}
                          className="flex items-center gap-2 text-xs text-foreground/80"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={domainFilters.includes(domain)}
                            onChange={() => handleToggleDomain(domain)}
                          />
                          {domain}
                        </label>
                      ))
                    ) : (
                      <span className="text-[11px] text-muted-foreground/70">
                        No domains yet.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedTopic && (
              <Button
                type="button"
                variant={newOnly ? "secondary" : "outline"}
                size="sm"
                className="h-8 rounded-full px-3 text-[11px] flex items-center gap-2"
                onClick={handleToggleNewOnly}
                aria-pressed={newOnly}
                disabled={isAuthenticated !== true}
                title={
                  isAuthenticated
                    ? "Show only new content in this topic."
                    : "Sign in to use the new filter."
                }
              >
                <Sparkles className={`h-3.5 w-3.5 ${newOnly ? "fill-current" : ""}`} />
                New
              </Button>
            )}

            <Button
              type="button"
              variant={bookmarkedOnly ? "secondary" : "outline"}
              size="sm"
              className="h-8 rounded-full px-3 text-[11px] flex items-center gap-2"
              onClick={() => setBookmarkedOnly((prev) => !prev)}
              aria-pressed={bookmarkedOnly}
              disabled={isAuthenticated !== true}
              title={
                isAuthenticated ? "Show only bookmarked content." : "Sign in to filter bookmarks."
              }
            >
              <Star className={`h-3.5 w-3.5 ${bookmarkedOnly ? "fill-current" : ""}`} />
              Bookmarked
            </Button>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground/70">
                {countsLabel} results
              </span>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  onClick={handleClearFilters}
                >
                  Clear all filters
                </Button>
              )}
            </div>
          </div>
            {filteredNews.length > 0 && (
              <div
                className={loading ? "pointer-events-none opacity-60" : ""}
                aria-busy={loading}
              >
                <AnimatePresence mode="popLayout">
                  {filteredNews.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
                    >
                      <Card className="group border-none bg-card/40 backdrop-blur-sm hover:bg-card/60 transition-all duration-300 relative overflow-hidden">
                        <div className="flex flex-col sm:flex-row p-6 gap-6">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                              <div className="flex items-center gap-3 flex-wrap">
                                <Badge className="text-[9px] font-medium border-border/50 text-muted-foreground bg-light hover:bg-muted">
                                  {item.source}
                                </Badge>
                                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
                                  <Clock className="h-3 w-3" />
                                  {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                                </span>
                                <div className="h-1 w-1 rounded-full bg-border"></div>
                                <span className="text-[11px] text-muted-foreground/60 lowercase italic">
                                  {item.keywords[0]}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                 <Button
                                   size="icon" variant="ghost"
                                   className={`h-8 w-8 rounded-full transition-colors hover:bg-emerald-500/10 ${item.isBookmarked ? 'text-yellow-500 bg-yellow-500/10' : 'text-muted-foreground hover:text-foreground'}`}
                                   onClick={() => toggleBookmark(item)}
                                 >
                                    <Star className={`h-3.5 w-3.5 ${item.isBookmarked ? 'fill-current' : ''}`} />
                                 </Button>
                                 <Button
                                   size="icon"
                                   variant="ghost"
                                   className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-emerald-500/10"
                                   onClick={() => handleShare(item)}
                                 >
                                    <Share2 className="h-3.5 w-3.5" />
                                 </Button>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-emerald-500/10"
                                   asChild
                                 >
                                   <a href={item.url} target="_blank" rel="noreferrer">
                                     <ExternalLink className="h-3.5 w-3.5" />
                                   </a>
                                 </Button>
                              </div>
                            </div>

                            <Link to={`/content/${item.id}/full`} className="contents">
                              <h3 className="text-xl font-bold leading-tight group-hover:text-primary transition-colors cursor-pointer">
                                {item.title}
                              </h3>
                              <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                                {item.summary}
                              </p>
                            </Link>

                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {showEmptyState && (
               <div className="text-center py-24 border border-dashed border-border/50 rounded-2xl bg-muted/5">
                  <div className="flex justify-center mb-4">
                     <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        {hasTopicsInGroup ? (
                          <Filter className="h-6 w-6 text-muted-foreground/40" />
                        ) : (
                          <PlusCircle className="h-6 w-6 text-muted-foreground/40" />
                        )}
                     </div>
                  </div>
                  <h4 className="text-lg font-bold">
                    {hasTopicsInGroup
                      ? selectedTopic
                        ? hasActiveFilters
                          ? "No filtered results"
                          : "No content found"
                        : "No signals found"
                      : "No topics created"}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1 mb-6">
                    {hasTopicsInGroup
                      ? selectedTopic
                        ? hasActiveFilters
                          ? "Clear filters to see all content in this topic."
                          : "Fetch now to populate this topic."
                        : "Adjust your filters or check back after the next scan."
                      : "Create a topic to start monitoring this group."}
                  </p>
                  {hasTopicsInGroup ? (
                    selectedTopic ? (
                      hasActiveFilters ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearFilters}
                          className="rounded-full"
                        >
                          Clear all filters
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleFetchNow()}
                          className="rounded-full"
                          disabled={loading}
                        >
                          Fetch now
                        </Button>
                      )
                    ) : hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClearFilters}
                        className="rounded-full"
                      >
                        Clear all filters
                      </Button>
                    ) : null
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddTopic}
                      className="rounded-full"
                    >
                      Add a new topic
                    </Button>
                  )}
               </div>
            )}
          </div>
      </div>
    </Layout>
  );
}
