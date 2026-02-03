import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Search, Bell, User, PlusCircle, Plus, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import {
  createTopicGroup,
  getExecution,
  listTopicGroups,
  listTopics,
  runTopicScan,
  searchAll,
  updateTopic,
} from '@/lib/api';
import type { ApiSearchResponse, ApiTopicListItem, TopicItem } from '@/lib/types';
import { AuthDialog } from '@/components/AuthDialog';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';

interface SidebarProps {
  children: React.ReactNode;
}

/**
 * The main Layout component for NewsRadar.
 * 
 * Features:
 * - 100% width top navbar with brand and controls.
 * - Split content area with a left topics column and main feed.
 * - Responsive design (sidebar collapses or hides on small screens).
 */
export function Layout({ children }: SidebarProps) {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    currentUser,
    authDialogOpen,
    openAuthDialog,
    setAuthDialogOpen,
    signOut,
  } = useAuthDialog();
  const {
    selectedGroupId,
    setSelectedGroupId,
    setSelectedGroupName,
    setSelectedGroupTopicCount,
    selectedTopicUuid,
    setSelectedTopicUuid,
    groups,
    setGroups,
  } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [topicMenuOpenId, setTopicMenuOpenId] = useState<string | null>(null);
  const topicMenuRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiSearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const requireAuth = () => {
    if (isAuthenticated) {
      return true;
    }
    openAuthDialog();
    return false;
  };

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
    updateFrequency: topic.update_frequency,
  });

  const loadTopics = async (groupUuid?: string | null) => {
    try {
      setTopicsError(null);
      const response = await listTopics(undefined, groupUuid ?? undefined);
      setTopics(response.topics.map(toTopicItem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load topics.";
      setTopicsError(message);
      setTopics([]);
    }
  };

  const loadGroups = async () => {
    try {
      setGroupsError(null);
      const response = await listTopicGroups();
      setGroups(response.groups);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load topic groups.";
      setGroupsError(message);
      setGroups([]);
    }
  };

  useEffect(() => {
    if (isAuthenticated === null) return;
    void loadGroups();
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated === null) return;
    if (isAuthenticated) {
      void loadTopics();
    }
  }, [isAuthenticated]);

  const handleGroupChange = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedTopicUuid(null);
    navigate('/');
  };

  useEffect(() => {
    if (!searchOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!searchContainerRef.current) return;
      if (searchContainerRef.current.contains(event.target as Node)) return;
      setSearchOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [searchOpen]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchError(null);
      setSearchLoading(false);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    const handle = window.setTimeout(() => {
      searchAll({
        query: trimmed,
        limit: 6,
      })
        .then((response) => {
          setSearchResults(response);
          setSearchError(null);
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Unable to load search results.";
          setSearchError(message);
          setSearchResults(null);
        })
        .finally(() => {
          setSearchLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    if (isAuthenticated !== false) return;
    if (!selectedGroupId) {
      setTopics([]);
      return;
    }
    void loadTopics(selectedGroupId);
  }, [isAuthenticated, selectedGroupId]);

  useEffect(() => {
    if (!selectedTopicUuid) return;
    if (!selectedGroupId) return;
    const matchesGroup = topics.some(
      (topic) => topic.uuid === selectedTopicUuid && topic.groupUuid === selectedGroupId
    );
    if (!matchesGroup) {
      setSelectedTopicUuid(null);
    }
  }, [selectedGroupId, selectedTopicUuid, setSelectedTopicUuid, topics]);

  const filteredTopics = useMemo(() => {
    if (isAuthenticated === false) return topics;
    if (!selectedGroupId) return topics;
    return topics.filter((topic) => topic.groupUuid === selectedGroupId);
  }, [isAuthenticated, selectedGroupId, topics]);

  useEffect(() => {
    setSelectedGroupTopicCount(filteredTopics.length);
  }, [filteredTopics, setSelectedGroupTopicCount]);

  const groupedOptions = useMemo(() => {
    const mapped = groups.map((group) => ({
      id: group.uuid,
      name: group.name,
      isPublic: group.is_public,
    }));
    if (isAuthenticated === false) {
      return {
        yours: [],
        publicGroups: mapped.filter((group) => group.isPublic),
      };
    }
    return {
      yours: mapped.filter((group) => !group.isPublic),
      publicGroups: mapped.filter((group) => group.isPublic),
    };
  }, [groups, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated === null) return;
    if (isAuthenticated === false) {
      const publicGroups = groups.filter((group) => group.is_public);
      if (publicGroups.length === 0) {
        setSelectedGroupId("");
        return;
      }
      const firstPublicId = publicGroups[0].uuid;
      const isValidSelection = publicGroups.some(
        (group) => group.uuid === selectedGroupId
      );
      if (!isValidSelection) {
        setSelectedGroupId(firstPublicId);
      }
      return;
    }
    if (!groups.some((group) => group.uuid === selectedGroupId)) {
      const firstGroup = groups[0];
      setSelectedGroupId(firstGroup ? firstGroup.uuid : "");
    }
  }, [groups, isAuthenticated, selectedGroupId]);

  useEffect(() => {
    let nextName = "Topics";
    if (isAuthenticated === false) {
      const group = groups.find((entry) => entry.uuid === selectedGroupId);
      nextName = group?.name ?? "Public topics";
    } else {
      const group = groups.find((entry) => entry.uuid === selectedGroupId);
      nextName = group?.name ?? "Topics";
    }
    setSelectedGroupName(nextName);
  }, [groups, isAuthenticated, selectedGroupId, setSelectedGroupName]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!topicMenuOpenId) return;
    const handleClick = (event: MouseEvent) => {
      if (!topicMenuRef.current?.contains(event.target as Node)) {
        setTopicMenuOpenId(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTopicMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [topicMenuOpenId]);

  const handleLogout = async () => {
    await signOut();
    setProfileMenuOpen(false);
  };

  const handleCreateGroup = async () => {
    if (!requireAuth()) {
      return;
    }
    if (creatingGroup) return;
    const name = window.prompt("Name the new topic group");
    if (!name || !name.trim()) return;
    const makePublic = window.confirm("Make this topic group public?");
    setCreatingGroup(true);
    try {
      const response = await createTopicGroup({
        name: name.trim(),
        isPublic: makePublic,
      });
      setGroups((prev) => [...prev, response.group]);
      setSelectedGroupId(response.group.uuid);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create topic group.";
      setGroupsError(message);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleAddTopicClick = () => {
    if (!requireAuth()) {
      return;
    }
    navigate('/topics');
  };

  const handleEditTopic = (topic: TopicItem) => {
    if (!requireAuth()) {
      return;
    }
    setSelectedTopicUuid(topic.uuid);
    navigate(`/topics?edit=${topic.uuid}`);
  };

  const formatRecency = (value: TopicItem["updateFrequency"]) => {
    switch (value) {
      case "day":
        return "daily";
      case "week":
        return "weekly";
      default:
        return "manually";
    }
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
        throw new Error(execution.error_message || "Scan failed.");
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }
    throw new Error("Timed out waiting for the scan to finish.");
  };

  const handleTopicScanNow = async (topic: TopicItem) => {
    if (!requireAuth()) {
      return;
    }
    setTopicsError(null);
    try {
      const { execution_id } = await runTopicScan(topic.uuid);
      await waitForExecutionCompletion(execution_id);
      const scannedAt = new Date();
      setTopics((prev) =>
        prev.map((item) =>
          item.uuid === topic.uuid ? { ...item, lastSearch: scannedAt } : item
        )
      );
      window.dispatchEvent(
        new CustomEvent("topic-scan-completed", {
          detail: { topicUuid: topic.uuid },
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start scan.";
      setTopicsError(message);
    } finally {
      setTopicMenuOpenId(null);
    }
  };

  const handleTopicFrequency = async (
    topic: TopicItem,
    frequency: TopicItem["updateFrequency"]
  ) => {
    if (!requireAuth()) {
      return;
    }
    setTopicsError(null);
    try {
      const updated = await updateTopic(topic.uuid, {
        updateFrequency: frequency,
        isActive: true,
      });
      const mapped = toTopicItem(updated);
      setTopics((prev) =>
        prev.map((item) => (item.uuid === mapped.uuid ? mapped : item))
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update scan cadence.";
      setTopicsError(message);
    } finally {
      setTopicMenuOpenId(null);
    }
  };

  const handleTopicPause = async (topic: TopicItem) => {
    if (!requireAuth()) {
      return;
    }
    setTopicsError(null);
    try {
      const updated = await updateTopic(topic.uuid, {
        isActive: false,
      });
      const mapped = toTopicItem(updated);
      setTopics((prev) =>
        prev.map((item) => (item.uuid === mapped.uuid ? mapped : item))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to pause topic.";
      setTopicsError(message);
    } finally {
      setTopicMenuOpenId(null);
    }
  };

  return (
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans flex-col">
        <AuthDialog isOpen={authDialogOpen} onOpenChange={setAuthDialogOpen} />
        {/* Top Navbar - 100% Width */}
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-6 z-20 sticky top-0 w-full shrink-0">
         <div className="flex items-center gap-4">
            <a href="#/" className="flex items-center gap-3 group">
               <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 group-hover:bg-primary/20 transition-all duration-300">
                  <Radio className="h-5 w-5 animate-pulse" />
                  <div className="absolute inset-0 rounded-lg ring-1 ring-primary/50 animate-ping opacity-10 duration-1000"></div>
               </div>
               <div className="flex flex-col">
                 <h1 className="font-bold text-base tracking-tight leading-none text-foreground">NewsRadar</h1>
                 <span className="text-[10px] text-muted-foreground font-mono mt-1 opacity-60 uppercase">Agenda Monitor</span>
               </div>
            </a>
         </div>
         
         <div className="flex items-center gap-4">
            <div className="relative hidden md:flex items-center" ref={searchContainerRef}>
              <div className="flex items-center bg-muted/30 border border-border/50 rounded-full px-4 py-1.5 gap-3">
                 <Search className="h-3.5 w-3.5 text-muted-foreground" />
                 <input
                    type="text"
                    placeholder="Search intelligence..."
                    className="bg-transparent border-none text-xs w-56 focus:outline-none placeholder:text-muted-foreground/50 text-foreground"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      if (!searchOpen) setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                  />
              </div>
              {searchOpen && (searchLoading || searchResults || searchError) && (
                <div className="absolute right-0 top-full mt-2 w-[28rem] rounded-2xl border border-border bg-background shadow-xl p-4 text-xs z-50">
                  {searchLoading && (
                    <p className="text-muted-foreground">Searching...</p>
                  )}
                  {searchError && (
                    <p className="text-destructive">{searchError}</p>
                  )}
                  {!searchLoading && !searchError && searchResults && (
                    <div className="space-y-4">
                      {[
                        { label: "Your Topics", items: searchResults.user_topics, type: "topic" as const },
                        { label: "Public Topics", items: searchResults.public_topics, type: "topic" as const },
                        { label: "Your Content", items: searchResults.user_contents, type: "content" as const },
                        { label: "Public Content", items: searchResults.public_contents, type: "content" as const },
                      ].map((section) => (
                        <div key={section.label} className="space-y-2">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                            {section.label}
                          </div>
                          {section.items.length === 0 ? (
                            <p className="text-muted-foreground">No results</p>
                          ) : (
                            <div className="space-y-1">
                              {section.items.map((item) => {
                                if (section.type === "topic") {
                                  const topic = item as ApiSearchResponse["user_topics"][number];
                                  return (
                                    <button
                                      key={`topic-${topic.uuid}`}
                                      type="button"
                                      className="w-full text-left px-3 py-2 rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
                                      onClick={() => {
                                        setSelectedTopicUuid(topic.uuid);
                                        if (topic.group_uuid) {
                                          setSelectedGroupId(topic.group_uuid);
                                        }
                                        navigate("/");
                                        setSearchOpen(false);
                                      }}
                                    >
                                      <div className="font-semibold text-foreground">
                                        {topic.queries?.[0] || "Untitled topic"}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground">
                                        {topic.group_name || "Private group"} · {topic.content_source_count} sources
                                      </div>
                                    </button>
                                  );
                                }
                                const content = item as ApiSearchResponse["user_contents"][number];
                                return (
                                  <button
                                    key={`content-${content.id}`}
                                    type="button"
                                    className="w-full text-left px-3 py-2 rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
                                    onClick={() => {
                                      navigate(`/content/${content.id}/full`);
                                      setSearchOpen(false);
                                    }}
                                  >
                                    <div className="font-semibold text-foreground">
                                      {content.title || content.url}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {content.source || "Unknown source"}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-l border-border pl-4">
              {isAuthenticated ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted relative"
                  >
                    <Bell className="h-4 w-4" />
                    <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-destructive animate-pulse"></span>
                  </Button>
                  <div className="relative" ref={profileMenuRef}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => setProfileMenuOpen((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={profileMenuOpen}
                    >
                      <User className="h-4 w-4" />
                    </Button>
                    {profileMenuOpen && (
                      <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-background shadow-lg p-2 z-50">
                        <p className="px-3 pt-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          Logged in as
                        </p>
                        <p className="px-3 pb-2 text-xs font-semibold text-foreground truncate">
                          {currentUser?.email || currentUser?.username || "User"}
                        </p>
                        <div className="h-px bg-border/70 my-2" />
                        <button
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                          onClick={() => void handleLogout()}
                          type="button"
                        >
                          Log out
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={openAuthDialog}>
                  Sign in
                </Button>
              )}
            </div>
         </div>
        </header>

        {/* Split Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Topics Column */}
          <aside className="w-80 border-r border-border bg-card/30 hidden lg:flex flex-col shrink-0">
          <div className="p-4 border-b border-border bg-background/50">
             <Select
               value={selectedGroupId || undefined}
               onValueChange={handleGroupChange}
             >
                <SelectTrigger className="w-full bg-muted/30 border-border/50 text-xs h-9 rounded-none font-bold tracking-widest">
                  <SelectValue placeholder="Select group" />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border">
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase text-muted-foreground/60 px-2 py-1.5">
                      Yours
                    </SelectLabel>
                    {groupedOptions.yours.length > 0 ? (
                      groupedOptions.yours.map((group) => (
                        <SelectItem
                          key={group.id}
                          value={group.id}
                          className="text-xs font-bold tracking-widest rounded-none"
                        >
                          {group.name}
                        </SelectItem>
                      ))
                    ) : (
                      <div className="px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
                        No topic groups yet
                      </div>
                    )}
                  </SelectGroup>
                  {groupedOptions.publicGroups.length > 0 && (
                    <>
                      <SelectSeparator className="bg-border/50" />
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase text-muted-foreground/60 px-2 py-1.5">
                          Public
                        </SelectLabel>
                        {groupedOptions.publicGroups.map((group) => (
                          <SelectItem
                            key={group.id}
                            value={group.id}
                            className="text-xs font-bold tracking-widest rounded-none"
                          >
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  <SelectSeparator className="bg-border/50" />
                  <button
                    className="w-full flex items-center gap-2 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/5 transition-colors"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleCreateGroup();
                    }}
                    type="button"
                  >
                    <Plus className="h-3 w-3" />
                    Create a topic group
                  </button>
                </SelectContent>
             </Select>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
             {filteredTopics.map((topic) => (
                <div 
                   key={topic.id} 
                   className={cn(
                      "group flex flex-col gap-1.5 px-3 py-3 rounded-lg text-sm transition-all duration-200 cursor-pointer relative border border-transparent",
                      topic.uuid === selectedTopicUuid ? "bg-muted/50 border-border/60" : "",
                      topic.isActive ? "hover:bg-muted/50 hover:border-border/50" : "bg-muted/20 border-border/40"
                   )}
                   onClick={() => {
                     setTopicMenuOpenId(null);
                     setSelectedTopicUuid(topic.uuid);
                     navigate('/');
                   }}
                >
                   <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "font-semibold text-foreground truncate max-w-[160px]",
                          topic.isActive ? "" : "text-muted-foreground/70"
                        )}
                      >
                        {topic.term}
                      </span>
                      {topic.hasNewItems && (
                         <span
                           className={cn(
                             "flex h-1.5 w-1.5 rounded-full",
                             topic.isActive
                               ? "bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"
                               : "bg-muted-foreground/40"
                           )}
                         ></span>
                      )}
                   </div>
                   <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "text-[10px] text-muted-foreground/60 font-mono tabular-nums",
                          topic.isActive ? "" : "text-muted-foreground/50"
                        )}
                      >
                        {topic.lastSearch
                          ? `Scanned ${formatDistanceToNowStrict(topic.lastSearch, { addSuffix: true })}`
                          : "Never scanned"}
                        ; updates {formatRecency(topic.updateFrequency)}
                      </span>
                      <div
                        className="relative"
                        ref={topic.uuid === topicMenuOpenId ? topicMenuRef : null}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-muted/50"
                          onClick={(event) => {
                            event.stopPropagation();
                            setTopicMenuOpenId((prev) =>
                              prev === topic.uuid ? null : topic.uuid
                            );
                          }}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={topicMenuOpenId === topic.uuid}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                        {topicMenuOpenId === topic.uuid && (
                          <div
                            className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-background shadow-lg p-2 z-50"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <p className="px-3 pt-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                              Scan
                            </p>
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => void handleTopicScanNow(topic)}
                              type="button"
                            >
                              Now
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => void handleTopicFrequency(topic, "day")}
                              type="button"
                            >
                              Daily
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => void handleTopicFrequency(topic, "week")}
                              type="button"
                            >
                              Weekly
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => void handleTopicFrequency(topic, "manual")}
                              type="button"
                            >

                              Manually
                            </button>
                            <div className="h-px bg-border/70 my-2" />
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => void handleTopicPause(topic)}
                              type="button"
                            >
                              Pause
                            </button>
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                              onClick={() => {
                                setTopicMenuOpenId(null);
                                handleEditTopic(topic);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                     </div>
                </div>
             ))}

             {topicsError && (
                <div className="px-3 py-2 text-[11px] text-destructive">
                  {topicsError}
                </div>
             )}
             {groupsError && (
                <div className="px-3 py-2 text-[11px] text-destructive">
                  {groupsError}
                </div>
             )}
             
             <button
               className="w-full flex items-center justify-center gap-2 py-3 mt-4 text-muted-foreground hover:text-primary border border-dashed border-border/50 hover:border-primary/30 rounded-lg transition-all text-xs font-medium group bg-muted/10"
               onClick={handleAddTopicClick}
               type="button"
             >
               <PlusCircle className="h-4 w-4 group-hover:scale-110 transition-transform" />
               <span>Add Topic</span>
             </button>
          </nav>


          </aside>

          {/* Main Content Area */}
          <main className="flex-1 overflow-auto bg-muted/5 custom-scrollbar relative">
            <div className="h-full w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
  );
}
