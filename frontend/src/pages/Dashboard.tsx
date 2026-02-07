import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  createBookmark,
  deleteContentItem,
  deleteBookmark,
  emptyTrashContent,
  getExecution,
  listTrashContent,
  listContentByGroup,
  listContentFeed,
  requestContentAIResponse,
  restoreContentItem,
  runTopicScan,
  updateTopicGroup,
} from '@/lib/api';
import type { ApiAIInteractionResponse, ApiContentFeedItem, ApiTrashContentItem, NewsItem } from '@/lib/types';
import {
  ExternalLink,
  Clock,
  Share2,
  Search,
  Filter,
  Star,
  PlusCircle,
  Sparkles,
  Bookmark,
  Play,
  RotateCcw,
  Trash2,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type AIPresetInstruction = {
  label: string;
  instruction: string;
};

type DeleteToastState = {
  contentId: number;
  title: string;
} | null;

const AI_PRESET_INSTRUCTIONS = [
  {
    label: "Summarize",
    instruction: "Summarize the key developments in these news items.",
  },
  {
    label: "List facts",
    instruction: "List the most important facts from these items as bullet points.",
  },
  {
    label: "List entities",
    instruction: "List named entities (people, organizations, locations) and why each matters.",
  },
  {
    label: "Risks & opportunities",
    instruction: "Highlight risks, opportunities, and open questions based on this context.",
  },
];
const AI_SAVED_INSTRUCTIONS_STORAGE_KEY = "newsradar.ai.saved_instructions.v1";
const AI_PRESET_INSTRUCTION_KEYS = new Set(
  AI_PRESET_INSTRUCTIONS.map((entry) => entry.instruction.trim().toLowerCase())
);

function toInstructionLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "Custom";
  const words = normalized.split(" ").slice(0, 4).join(" ");
  if (words.length < normalized.length) {
    return `${words}...`;
  }
  return words;
}

function normalizeCustomInstructions(raw: unknown): AIPresetInstruction[] {
  if (!Array.isArray(raw)) return [];
  const defaultSet = new Set(
    AI_PRESET_INSTRUCTIONS.map((entry) => entry.instruction.trim().toLowerCase())
  );
  const seen = new Set<string>();
  const normalized: AIPresetInstruction[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const instructionValue = (entry as { instruction?: unknown }).instruction;
    const labelValue = (entry as { label?: unknown }).label;
    if (typeof instructionValue !== "string") return;
    const instruction = instructionValue.trim();
    if (!instruction) return;
    const key = instruction.toLowerCase();
    if (defaultSet.has(key) || seen.has(key)) return;
    seen.add(key);
    normalized.push({
      label:
        typeof labelValue === "string" && labelValue.trim()
          ? labelValue.trim()
          : toInstructionLabel(instruction),
      instruction,
    });
  });
  return normalized;
}

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
  const location = useLocation();
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
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
  const [showRecentDeleteIndicator, setShowRecentDeleteIndicator] = useState(false);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<ApiTrashContentItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [restoringTrashId, setRestoringTrashId] = useState<number | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [deleteToast, setDeleteToast] = useState<DeleteToastState>(null);
  const [deletingContentId, setDeletingContentId] = useState<number | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState(
    AI_PRESET_INSTRUCTIONS[0].instruction
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<ApiAIInteractionResponse | null>(null);
  const [aiCustomInstructions, setAiCustomInstructions] = useState<AIPresetInstruction[]>([]);
  const [aiInstructionMenuOpen, setAiInstructionMenuOpen] = useState(false);
  const [aiSaveFeedback, setAiSaveFeedback] = useState<"idle" | "saved">("idle");
  const feedCache = useRef<Map<string, NewsItem[]>>(new Map());
  const latestRequestId = useRef(0);
  const pageTopRef = useRef<HTMLDivElement | null>(null);
  const domainMenuRef = useRef<HTMLDivElement | null>(null);
  const aiInstructionMenuRef = useRef<HTMLDivElement | null>(null);
  const aiSaveFeedbackTimerRef = useRef<number | null>(null);
  const deleteToastTimerRef = useRef<number | null>(null);

  const selectedGroup = groups.find((group) => group.uuid === selectedGroupId) ?? null;
  const selectedTopic = selectedTopicUuid
    ? topics.find((topic) => topic.uuid === selectedTopicUuid) ?? null
    : null;
  const contentTitle = selectedTopic
    ? `${selectedGroupName} / ${selectedTopic.term}`
    : selectedGroupName;
  const isAllTopicsView = !selectedTopicUuid && !selectedGroupId;
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
    const searchKey = debouncedSearchTerm.toLowerCase();
    if (selectedTopicUuid) {
      return `topic:${selectedTopicUuid}:${newOnly ? "new" : "all"}:${searchKey}`;
    }
    if (selectedGroupId) {
      return `group:${selectedGroupId}:${newOnly ? "new" : "all"}:${searchKey}`;
    }
    return `all:${newOnly ? "new" : "all"}:${searchKey}`;
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
    const handle = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [searchTerm]);

  useEffect(() => {
    const filter = searchParams.get("filter");
    const shouldEnable = filter === "new";
    if (shouldEnable !== newOnly) {
      setNewOnly(shouldEnable);
    }
  }, [newOnly, searchParams]);

  useEffect(() => {
    if (selectedTopicUuid || selectedGroupId || isAuthenticated === true) return;
    if (!newOnly) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("filter");
    setSearchParams(nextParams, { replace: true });
    setNewOnly(false);
  }, [isAuthenticated, newOnly, searchParams, selectedGroupId, selectedTopicUuid, setSearchParams]);


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
  }, [debouncedSearchTerm, isAuthenticated, newOnly, selectedGroupId, selectedTopicUuid]);

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
  }, [debouncedSearchTerm, newOnly, selectedGroupId, selectedTopicUuid, topics]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawValue = window.localStorage.getItem(AI_SAVED_INSTRUCTIONS_STORAGE_KEY);
      if (!rawValue) return;
      const parsed = JSON.parse(rawValue);
      setAiCustomInstructions(normalizeCustomInstructions(parsed));
    } catch {
      // ignore malformed localStorage payloads
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      AI_SAVED_INSTRUCTIONS_STORAGE_KEY,
      JSON.stringify(aiCustomInstructions)
    );
  }, [aiCustomInstructions]);

  useEffect(() => {
    if (!aiInstructionMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!aiInstructionMenuRef.current?.contains(event.target as Node)) {
        setAiInstructionMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [aiInstructionMenuOpen]);

  useEffect(
    () => () => {
      if (aiSaveFeedbackTimerRef.current !== null) {
        window.clearTimeout(aiSaveFeedbackTimerRef.current);
        aiSaveFeedbackTimerRef.current = null;
      }
      if (deleteToastTimerRef.current !== null) {
        window.clearTimeout(deleteToastTimerRef.current);
        deleteToastTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (isAuthenticated !== true) {
      setTrashItems([]);
      setTrashError(null);
      setTrashDialogOpen(false);
      return;
    }
    void loadTrash();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!trashDialogOpen || isAuthenticated !== true) return;
    void loadTrash();
  }, [isAuthenticated, trashDialogOpen]);

  useEffect(() => {
    setShowRecentDeleteIndicator(false);
  }, [location.pathname, selectedGroupId, selectedTopicUuid]);

  useEffect(() => {
    if (apiPanelOpen || shareDialogOpen || trashDialogOpen || configDialogOpen) {
      setShowRecentDeleteIndicator(false);
    }
  }, [apiPanelOpen, shareDialogOpen, trashDialogOpen, configDialogOpen]);

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
  const aiContextIds = useMemo(() => filteredNews.map((item) => item.id), [filteredNews]);
  const allSavedInstructions = useMemo(
    () => [...AI_PRESET_INSTRUCTIONS, ...aiCustomInstructions],
    [aiCustomInstructions]
  );
  const hasActiveFilters =
    domainFilters.length > 0 ||
    bookmarkedOnly ||
    newOnly ||
    searchTerm.trim().length > 0;
  const availableDomains = useMemo(
    () =>
      Array.from(new Set(news.map((item) => item.source).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [news]
  );
  const isFeedLoading = loading || isAuthenticated === null;
  const showEmptyState = filteredNews.length === 0 && !isFeedLoading;
  const activityMessage = isFeedLoading ? "Loading..." : null;
  const hasTopicsInGroup = selectedGroupTopicCount > 0 || Boolean(selectedTopic);
  const countsLabel = hasActiveFilters
    ? `${filteredNews.length} of ${news.length}`
    : `${news.length}`;
  const handleClearFilters = () => {
    setSearchTerm("");
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

  const handleSelectInstruction = (instruction: string) => {
    setAiInstruction(instruction);
    setAiError(null);
    setAiSaveFeedback("idle");
    setAiInstructionMenuOpen(false);
  };

  const triggerAiSaveFeedback = () => {
    setAiSaveFeedback("saved");
    if (aiSaveFeedbackTimerRef.current !== null) {
      window.clearTimeout(aiSaveFeedbackTimerRef.current);
    }
    aiSaveFeedbackTimerRef.current = window.setTimeout(() => {
      setAiSaveFeedback("idle");
      aiSaveFeedbackTimerRef.current = null;
    }, 1200);
  };

  const handleSaveInstruction = () => {
    const trimmed = aiInstruction.trim();
    if (!trimmed) {
      setAiError("Instruction cannot be empty.");
      return;
    }
    const normalized = trimmed.replace(/\s+/g, " ");
    const instructionKey = normalized.toLowerCase();
    const existingInstructions = new Set(
      [...AI_PRESET_INSTRUCTIONS, ...aiCustomInstructions].map((entry) =>
        entry.instruction.trim().toLowerCase()
      )
    );
    if (existingInstructions.has(instructionKey)) {
      setAiError(null);
      triggerAiSaveFeedback();
      return;
    }
    const nextInstruction = {
      label: toInstructionLabel(normalized),
      instruction: normalized,
    };
    setAiCustomInstructions((prev) => [nextInstruction, ...prev]);
    setAiError(null);
    triggerAiSaveFeedback();
  };

  const handleDeleteCustomInstruction = (instruction: string) => {
    const target = instruction.trim().toLowerCase();
    setAiCustomInstructions((prev) =>
      prev.filter((entry) => entry.instruction.trim().toLowerCase() !== target)
    );
    setAiSaveFeedback("idle");
    setAiError(null);
  };

  const handleRunAI = async () => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const instruction = aiInstruction.trim();
    if (!instruction) {
      setAiError("Instruction cannot be empty.");
      return;
    }
    if (aiContextIds.length === 0) {
      setAiError("No content in the current list to analyze.");
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const response = await requestContentAIResponse({
        contentIds: aiContextIds,
        instruction,
      });
      setAiResponse(response);
    } catch (aiCallError) {
      const message =
        aiCallError instanceof Error ? aiCallError.message : "Unable to generate AI response.";
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const canRunAI = !aiLoading && aiContextIds.length > 0 && Boolean(aiInstruction.trim());

  const handleToggleNewOnly = () => {
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

  const dismissDeleteToast = () => {
    if (deleteToastTimerRef.current !== null) {
      window.clearTimeout(deleteToastTimerRef.current);
      deleteToastTimerRef.current = null;
    }
    setDeleteToast(null);
  };

  const showDeleteToast = (contentId: number, title: string) => {
    if (deleteToastTimerRef.current !== null) {
      window.clearTimeout(deleteToastTimerRef.current);
    }
    setDeleteToast({ contentId, title });
    deleteToastTimerRef.current = window.setTimeout(() => {
      setDeleteToast(null);
      deleteToastTimerRef.current = null;
    }, 6000);
  };

  const loadTrash = async () => {
    if (!isAuthenticated) return;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const response = await listTrashContent({ limit: 100 });
      setTrashItems(response.items);
    } catch (trashLoadError) {
      const message =
        trashLoadError instanceof Error ? trashLoadError.message : "Unable to load trash.";
      setTrashError(message);
      setTrashItems([]);
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestoreFromTrash = async (contentId: number) => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    setRestoringTrashId(contentId);
    setTrashError(null);
    try {
      await restoreContentItem(contentId);
      setTrashItems((prev) => prev.filter((item) => item.id !== contentId));
      if (deleteToast?.contentId === contentId) {
        dismissDeleteToast();
      }
      await loadFeed(getCacheKey());
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : "Unable to restore content.";
      setTrashError(message);
    } finally {
      setRestoringTrashId((prev) => (prev === contentId ? null : prev));
    }
  };

  const handleUndoDelete = async () => {
    if (!deleteToast) return;
    await handleRestoreFromTrash(deleteToast.contentId);
    setShowRecentDeleteIndicator(false);
  };

  const handleEmptyTrash = async () => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    setEmptyingTrash(true);
    setTrashError(null);
    try {
      await emptyTrashContent();
      setTrashItems([]);
      dismissDeleteToast();
    } catch (emptyError) {
      const message =
        emptyError instanceof Error ? emptyError.message : "Unable to empty trash.";
      setTrashError(message);
    } finally {
      setEmptyingTrash(false);
    }
  };

  const handleDeleteContent = async (item: NewsItem) => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }

    setDeletingContentId(item.id);
    setError(null);
    try {
      await deleteContentItem(item.id);
      setNews((prev) => prev.filter((entry) => entry.id !== item.id));
      feedCache.current.forEach((items, key) => {
        feedCache.current.set(
          key,
          items.filter((entry) => entry.id !== item.id)
        );
      });
      setShowRecentDeleteIndicator(true);
      showDeleteToast(item.id, item.title);
      void loadTrash();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Unable to delete content.";
      setError(message);
    } finally {
      setDeletingContentId((prev) => (prev === item.id ? null : prev));
    }
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
                isAllTopicsView ? "All content" : contentTitle
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
            {!isAllTopicsView && (
              <Button
                size="sm"
                variant="outline"
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
            )}
            <Button
              size="sm"
              variant="secondary"
              className="relative rounded-full px-5"
              onClick={() => {
                if (!isAuthenticated) {
                  openAuthDialog();
                  return;
                }
                setTrashDialogOpen(true);
              }}
            >
              Trash
              {showRecentDeleteIndicator && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
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

        <Dialog
          open={trashDialogOpen}
          onOpenChange={(open) => {
            setTrashDialogOpen(open);
            if (!open) {
              setTrashError(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-[640px] border-border bg-background">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-xl font-semibold">Trash</DialogTitle>
              <DialogDescription>
                Deleted items can be restored from here.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto custom-scrollbar">
              {trashLoading && (
                <p className="text-sm text-muted-foreground">Loading trash...</p>
              )}
              {trashError && (
                <p className="text-sm text-destructive">{trashError}</p>
              )}
              {!trashLoading && !trashError && trashItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">Trash is empty</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Content you delete appears here for restore.
                  </p>
                </div>
              )}
              {!trashLoading &&
                !trashError &&
                trashItems.map((trashItem) => {
                  const deletedAt = new Date(trashItem.deleted_at);
                  const deletedLabel = Number.isNaN(deletedAt.getTime())
                    ? "Deleted recently"
                    : `Deleted ${formatDistanceToNow(deletedAt, { addSuffix: true })}`;
                  return (
                    <div
                      key={trashItem.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {trashItem.title || trashItem.url}
                        </p>
                        <p className="text-xs text-muted-foreground">{deletedLabel}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-full px-3 text-[11px]"
                        disabled={restoringTrashId === trashItem.id}
                        onClick={() => void handleRestoreFromTrash(trashItem.id)}
                      >
                        {restoringTrashId === trashItem.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        )}
                        Restore
                      </Button>
                    </div>
                  );
                })}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleEmptyTrash()}
                disabled={trashLoading || emptyingTrash || trashItems.length === 0}
              >
                {emptyingTrash ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Empty trash
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadTrash()}
                disabled={trashLoading || emptyingTrash}
              >
                Refresh
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search title, snippet, or URL"
                  className="h-8 rounded-full border-border/70 bg-background pl-9 pr-3 text-xs"
                />
              </div>

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
                    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
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

              <Button
                type="button"
                variant={newOnly ? "secondary" : "outline"}
                size="sm"
                className="flex h-8 items-center gap-2 rounded-full px-3 text-[11px]"
                onClick={handleToggleNewOnly}
                aria-pressed={newOnly}
                disabled={isAuthenticated !== true}
                title={
                  isAuthenticated
                    ? `Show only new content in this ${
                        selectedTopic ? "topic" : selectedGroupId ? "group" : "all-topics view"
                      }.`
                    : "Sign in to use the new filter."
                }
              >
                <Clock className="h-3.5 w-3.5" />
                New
              </Button>

              <Button
                type="button"
                variant={bookmarkedOnly ? "secondary" : "outline"}
                size="sm"
                className="flex h-8 items-center gap-2 rounded-full px-3 text-[11px]"
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

              {activityMessage && (
                <span
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {activityMessage}
                </span>
              )}

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
              <div aria-busy={loading}>
                {filteredNews.map((item) => (
                  <div key={item.id}>
                      <Card className="group relative overflow-hidden border-0 bg-card/40 backdrop-blur-sm transition-all duration-300 hover:bg-card/60">
                        <div className="flex flex-col gap-6 py-6 sm:flex-row">
                          <div className="flex-1 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <div className="flex flex-wrap items-center gap-3">
                                <Badge className="bg-light text-[9px] font-medium text-muted-foreground border-border/50 hover:bg-muted">
                                  {item.source}
                                </Badge>
                                <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                                </span>
                                <div className="h-1 w-1 rounded-full bg-border" />
                                <span className="text-[11px] lowercase italic text-muted-foreground/60">
                                  {item.keywords[0]}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={`h-8 w-8 rounded-full transition-colors hover:bg-emerald-500/10 ${item.isBookmarked ? 'bg-yellow-500/10 text-yellow-500' : 'text-muted-foreground hover:text-foreground'}`}
                                  onClick={() => toggleBookmark(item)}
                                >
                                  <Star className={`h-3.5 w-3.5 ${item.isBookmarked ? 'fill-current' : ''}`} />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 rounded-full text-muted-foreground hover:bg-emerald-500/10 hover:text-foreground"
                                  onClick={() => handleShare(item)}
                                >
                                  <Share2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 rounded-full text-muted-foreground hover:bg-emerald-500/10 hover:text-foreground"
                                  asChild
                                >
                                  <a href={item.url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                                {isAuthenticated && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                    onClick={() => void handleDeleteContent(item)}
                                    disabled={deletingContentId === item.id}
                                    title="Delete content item"
                                  >
                                    {deletingContentId === item.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>

                            <Link to={`/content/${item.id}/full`} className="contents">
                              <h3 className="cursor-pointer text-xl font-bold leading-tight transition-colors group-hover:text-primary">
                                {item.title}
                              </h3>
                              <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                                {item.summary}
                              </p>
                            </Link>
                          </div>
                        </div>
                      </Card>
                  </div>
                ))}
              </div>
            )}

            {showEmptyState && (
              <div className="rounded-2xl border border-dashed border-border/50 bg-muted/5 py-24 text-center">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
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
                <p className="mb-6 mt-1 text-sm text-muted-foreground">
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

          <Card className="flex min-h-[560px] flex-col border-border/60 bg-card/55 backdrop-blur-sm xl:sticky xl:top-24 xl:h-[calc(100vh-11rem)]">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Analyze
              </CardTitle>
              <CardDescription className="text-xs">
                Analyze the currently listed content items with AI.
                Filter the list to adjust the context.
              </CardDescription>
              <div className="text-[11px] text-muted-foreground">
                Context: {aiContextIds.length} item{aiContextIds.length === 1 ? "" : "s"}
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="custom-scrollbar flex-1 overflow-y-auto text-muted-foreground border-t border-border/60 pt-3">
                {aiLoading ? (
                  <p className="text-sm text-muted-foreground">Generating response...</p>
                ) : aiResponse ? (
                  <ReactMarkdown
                    className="space-y-3 text-sm leading-relaxed text-muted-foreground"
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ node, ...props }) => (
                        <h1 className="text-lg font-semibold text-foreground" {...props} />
                      ),
                      h2: ({ node, ...props }) => (
                        <h2 className="text-base font-semibold text-foreground" {...props} />
                      ),
                      h3: ({ node, ...props }) => (
                        <h3 className="text-sm font-semibold text-foreground" {...props} />
                      ),
                      p: ({ node, ...props }) => (
                        <p className="text-sm leading-relaxed text-muted-foreground" {...props} />
                      ),
                      ul: ({ node, ...props }) => (
                        <ul className="list-disc space-y-1 pl-5" {...props} />
                      ),
                      ol: ({ node, ...props }) => (
                        <ol className="list-decimal space-y-1 pl-5" {...props} />
                      ),
                      li: ({ node, ...props }) => (
                        <li className="text-sm text-muted-foreground" {...props} />
                      ),
                      a: ({ node, ...props }) => (
                        <a
                          className="text-primary underline-offset-4 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                          {...props}
                        />
                      ),
                      code: ({ node, ...props }) => (
                        <code
                          className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground"
                          {...props}
                        />
                      ),
                      pre: ({ node, ...props }) => (
                        <pre
                          className="overflow-x-auto rounded-lg border border-border/60 bg-background p-3 text-[12px]"
                          {...props}
                        />
                      ),
                    }}
                  >
                    {aiResponse.answer}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm">
                    Run an instruction to see the response here.
                  </p>
                )}
              </div>

              {aiError && <p className="text-xs text-destructive">{aiError}</p>}

              <div className="mt-auto space-y-3 border-t border-border/60 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {AI_PRESET_INSTRUCTIONS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={preset.instruction === aiInstruction ? "secondary" : "outline"}
                      size="sm"
                      className="h-auto rounded-full px-3 py-1 text-[11px]"
                      onClick={() => handleSelectInstruction(preset.instruction)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <div className="relative ml-auto" ref={aiInstructionMenuRef}>
                    <Button
                      type="button"
                      variant={aiInstructionMenuOpen ? "secondary" : "outline"}
                      size="sm"
                      className="h-auto rounded-full px-2 py-1 text-[11px]"
                      aria-haspopup="true"
                      aria-expanded={aiInstructionMenuOpen}
                      onClick={() => setAiInstructionMenuOpen((prev) => !prev)}
                      title="Browse saved instructions"
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                    </Button>
                    {aiInstructionMenuOpen && (
                      <div className="custom-scrollbar absolute bottom-full right-0 z-30 mb-2 max-h-72 w-72 overflow-y-auto rounded-lg border border-border/70 bg-background p-2 shadow-lg">
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Saved instructions
                        </p>
                        <div className="space-y-1">
                          {allSavedInstructions.map((preset) => (
                            <div
                              key={`${preset.label}-${preset.instruction}`}
                              className="flex items-center gap-1"
                            >
                              <button
                                type="button"
                                className={`w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/70 ${
                                  preset.instruction === aiInstruction
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground"
                                }`}
                                onClick={() => handleSelectInstruction(preset.instruction)}
                              >
                                <p className="text-xs font-medium text-foreground">{preset.label}</p>
                                <p className="line-clamp-2 text-[11px]">{preset.instruction}</p>
                              </button>
                              {!AI_PRESET_INSTRUCTION_KEYS.has(
                                preset.instruction.trim().toLowerCase()
                              ) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  title="Delete saved instruction"
                                  aria-label={`Delete ${preset.label} instruction`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteCustomInstruction(preset.instruction);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    className="h-28 w-full resize-none rounded-md border border-input bg-background px-2 py-2 pb-11 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="Ask anything about the current content list..."
                    value={aiInstruction}
                    onChange={(event) => {
                      setAiInstruction(event.target.value);
                      setAiSaveFeedback("idle");
                      if (aiError) {
                        setAiError(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (canRunAI) {
                          void handleRunAI();
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`absolute bottom-1.5 left-0 shadow-none hover:text-green-600 hover:bg-transparent ${
                      aiSaveFeedback === "saved" ? "text-green-600" : ""
                    }`}
                    onClick={handleSaveInstruction}
                    disabled={!aiInstruction.trim()}
                    title={aiSaveFeedback === "saved" ? "Saved" : "Save instruction"}
                    aria-label={aiSaveFeedback === "saved" ? "Instruction saved" : "Save instruction"}
                  >
                    <Bookmark className={`h-3.5 w-3.5 ${aiSaveFeedback === "saved" ? "fill-current" : ""}`} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute bottom-1.5 right-0 shadow-none hover:text-green-600 hover:bg-transparent"
                    onClick={() => void handleRunAI()}
                    disabled={!canRunAI}
                    title="Run instruction (Enter)"
                    aria-label="Run instruction"
                  >
                    {aiLoading ? (
                      <span className="text-[10px] leading-none">...</span>
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {deleteToast && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-xl border border-border/70 bg-card/95 p-3 shadow-xl backdrop-blur">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Moved to trash
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            {deleteToast.title}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-[11px]"
              onClick={() => void handleUndoDelete()}
            >
              Undo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-3 text-[11px]"
              onClick={() => {
                dismissDeleteToast();
                setTrashDialogOpen(true);
              }}
            >
              View trash
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 rounded-full px-3 text-[11px] text-muted-foreground"
              onClick={dismissDeleteToast}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
