import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createBookmark, deleteBookmark, listContentByGroup, listContentFeed, runTopicScan, updateTopicGroup } from '@/lib/api';
import type { ApiContentFeedItem, NewsItem } from '@/lib/types';
import { TopicForm } from '@/components/TopicForm';
import { ExternalLink, Clock, Share2, Filter, Star, PlusCircle } from 'lucide-react';
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
  const { topics } = useTopics();
  const navigate = useNavigate();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [groupName, setGroupName] = useState("");
  const [groupIsPublic, setGroupIsPublic] = useState(false);
  const [groupUpdateFrequency, setGroupUpdateFrequency] = useState<
    "" | "day" | "week" | "manual"
  >("");
  const [groupLanguageInput, setGroupLanguageInput] = useState("");
  const [groupCountry, setGroupCountry] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [apiPanelOpen, setApiPanelOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

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
    ? `${apiBaseUrl}/contents/topics/${selectedTopicUuid}/rss`
    : null;
  const groupRssEndpoint = selectedGroupId
    ? `${apiBaseUrl}/contents/groups/${selectedGroupId}/rss`
    : null;

  const buildShareUrl = (contentId: number) => {
    if (typeof window === "undefined") {
      return `#/content/${contentId}/full`;
    }
    return `${window.location.origin}${window.location.pathname}#/content/${contentId}/full`;
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
    return {
      id: item.id,
      title: item.title || item.url,
      summary: item.summary || "Summary not available.",
      source: getSourceLabel(item),
      timestamp: safeTimestamp,
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

  useEffect(() => {
    if (!selectedGroup) {
      setGroupName("");
      setGroupIsPublic(false);
      setGroupUpdateFrequency("");
      setGroupLanguageInput("");
      setGroupCountry("");
      setGroupError(null);
      return;
    }
    setGroupName(selectedGroup.name ?? "");
    setGroupIsPublic(selectedGroup.is_public);
    setGroupUpdateFrequency(selectedGroup.default_update_frequency ?? "");
    setGroupLanguageInput(selectedGroup.default_search_language_filter?.join(", ") ?? "");
    setGroupCountry(selectedGroup.default_country ?? "");
    setGroupError(null);
  }, [selectedGroup]);

  const loadFeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = selectedTopicUuid
        ? await listContentFeed({ topicUuid: selectedTopicUuid })
        : selectedGroupId
          ? await listContentByGroup(selectedGroupId)
          : await listContentFeed();
      setNews(response.items.map(mapNewsItem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load feed.";
      setError(message);
      setNews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadFeed();
    } else if (isAuthenticated === false) {
      setNews([]);
      setLoading(false);
    }
  }, [isAuthenticated, selectedGroupId, selectedTopicUuid]);

  const toggleBookmark = async (item: NewsItem) => {
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

  const filteredNews = filter === "all" ? news : news.filter(item => item.category === filter);
  const hasTopicsInGroup = selectedGroupTopicCount > 0 || Boolean(selectedTopic);

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
    if (!selectedTopicUuid) {
      void loadFeed();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await runTopicScan(selectedTopicUuid);
      await loadFeed();
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
        defaultUpdateFrequency: groupUpdateFrequency || null,
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
                default_update_frequency: groupUpdateFrequency || null,
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
      <div className="mx-auto space-y-3 p-4 md:p-6 lg:p-10">
        
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
                setConfigDialogOpen(true);
              }}
            >
              Config
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
          <DialogContent className="sm:max-w-[720px] border-border bg-background">
            {selectedTopic ? (
              <TopicForm
                mode="edit"
                topicUuid={selectedTopic.uuid}
                onCancel={() => setConfigDialogOpen(false)}
                onSaved={() => setConfigDialogOpen(false)}
                className="border-none bg-transparent shadow-none"
              />
            ) : selectedGroup ? (
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
                        <option value="">Manual</option>
                        <option value="day">Daily</option>
                        <option value="week">Weekly</option>
                        <option value="month">Monthly</option>
                        <option value="year">Yearly</option>
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

        <div className="space-y-1">
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
            
            {filteredNews.length === 0 && !loading && (
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
                        ? "No content found"
                        : "No signals found"
                      : "No topics created"}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1 mb-6">
                    {hasTopicsInGroup
                      ? selectedTopic
                        ? "Fetch now to populate this topic."
                        : "Adjust your filters or check back after the next scan."
                      : "Create a topic to start monitoring this group."}
                  </p>
                  {hasTopicsInGroup ? (
                    selectedTopic ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleFetchNow()}
                        className="rounded-full"
                        disabled={loading}
                      >
                        Fetch now
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFilter("all")}
                        className="rounded-full"
                      >
                        Clear all filters
                      </Button>
                    )
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
