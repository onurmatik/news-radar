import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createBookmark, deleteBookmark, listContentFeed, updateTopicGroup } from '@/lib/api';
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
    contentViewMode,
    setContentViewMode,
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
  const [groupRecency, setGroupRecency] = useState<"" | "day" | "week" | "month" | "year">("");
  const [groupLanguageInput, setGroupLanguageInput] = useState("");
  const [groupCountry, setGroupCountry] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const selectedGroup = groups.find((group) => group.uuid === selectedGroupId) ?? null;
  const selectedTopic = selectedTopicUuid
    ? topics.find((topic) => topic.uuid === selectedTopicUuid) ?? null
    : null;
  const contentTitle = selectedTopic
    ? `${selectedGroupName} / ${selectedTopic.term}`
    : selectedGroupName;

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
      setGroupRecency("");
      setGroupLanguageInput("");
      setGroupCountry("");
      setGroupError(null);
      return;
    }
    setGroupName(selectedGroup.name ?? "");
    setGroupIsPublic(selectedGroup.is_public);
    setGroupRecency(selectedGroup.default_search_recency_filter ?? "");
    setGroupLanguageInput(selectedGroup.default_search_language_filter?.join(", ") ?? "");
    setGroupCountry(selectedGroup.default_country ?? "");
    setGroupError(null);
  }, [selectedGroup]);

  useEffect(() => {
    if (isAuthenticated === false && contentViewMode === "edit") {
      setContentViewMode("read");
    }
  }, [contentViewMode, isAuthenticated, setContentViewMode]);

  const loadFeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listContentFeed(
        selectedTopicUuid ? { topicUuid: selectedTopicUuid } : undefined
      );
      let items = response.items;
      if (!selectedTopicUuid && selectedGroupId) {
        const groupTopicUuids = new Set(
          topics
            .filter((topic) => topic.groupUuid === selectedGroupId)
            .map((topic) => topic.uuid)
        );
        if (groupTopicUuids.size > 0) {
          items = items.filter((item) => groupTopicUuids.has(item.topic_uuid));
        } else {
          items = [];
        }
      }
      setNews(items.map(mapNewsItem));
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
  }, [isAuthenticated, selectedGroupId, selectedTopicUuid, topics]);

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

  const handleViewModeChange = (mode: "read" | "edit") => {
    if (mode === contentViewMode) return;
    if (mode === "edit" && !isAuthenticated) {
      openAuthDialog();
      return;
    }
    setContentViewMode(mode);
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
        defaultRecencyFilter: groupRecency || null,
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
                default_search_recency_filter: groupRecency || null,
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
              {contentTitle}
            </h2>
            {error && (
              <p className="text-sm text-destructive mt-3">{error}</p>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-1">
              <Button
                size="sm"
                variant={contentViewMode === "read" ? "secondary" : "ghost"}
                className="rounded-full px-4"
                onClick={() => handleViewModeChange("read")}
              >
                Read
              </Button>
              <Button
                size="sm"
                variant={contentViewMode === "edit" ? "secondary" : "ghost"}
                className="rounded-full px-4"
                onClick={() => handleViewModeChange("edit")}
              >
                Edit
              </Button>
            </div>
          </div>
        </div>

        {contentViewMode === "read" ? (
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
                             <Button size="icon" variant="ghost"
                                     className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-emerald-500/10">
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
                        
                        <h3 className="text-xl font-bold leading-tight group-hover:text-primary transition-colors cursor-pointer decoration-primary/30 decoration-2 underline-offset-4 hover:underline">
                          {item.title}
                        </h3>
                        <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                          {item.summary}
                        </p>
                        
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
                    {hasTopicsInGroup ? "No signals found" : "No topics created"}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1 mb-6">
                    {hasTopicsInGroup
                      ? "Adjust your filters or check back after the next scan."
                      : "Create a topic to start monitoring this group."}
                  </p>
                  {hasTopicsInGroup ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFilter("all")}
                      className="rounded-full"
                    >
                      Clear all filters
                    </Button>
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
        ) : (
          <div className="space-y-6">
            {selectedTopic ? (
              <TopicForm mode="edit" topicUuid={selectedTopic.uuid} />
            ) : selectedGroup ? (
              <Card className="border border-border/60 bg-card/40">
                <CardContent className="space-y-6 p-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Topic group name
                    </label>
                    <Input
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      placeholder="Enter topic group name"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Default update frequency
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={groupRecency}
                        onChange={(event) =>
                          setGroupRecency(event.target.value as "" | "day" | "week" | "month" | "year")
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
                        value={groupLanguageInput}
                        onChange={(event) => setGroupLanguageInput(event.target.value)}
                        placeholder="en, fr, de"
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

                  <div className="flex justify-end">
                    <Button onClick={() => void handleSaveGroup()} disabled={groupSaving}>
                      Save changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-sm text-muted-foreground">
                No topic group selected.
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
