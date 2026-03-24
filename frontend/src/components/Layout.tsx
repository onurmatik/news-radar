import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Radio, Bell, User, PlusCircle, Plus, MoreVertical, Pencil, Check, Sparkles, KeyRound } from 'lucide-react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { formatDistanceToNowStrict } from 'date-fns';
import {
  createTopicGroup,
  deleteTopicGroup,
  getExecution,
  getNotifications,
  getSharedTopic,
  getSharedTopicGroup,
  listTopicGroups,
  listSharedTopicsByGroup,
  listTopics,
  runTopicScan,
  updateTopicGroup,
  updateTopic,
} from '@/lib/api';
import type { ApiNotificationsResponse, ApiTopicGroupItem, ApiTopicListItem, TopicItem } from '@/lib/types';
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
  const ALL_TOPICS_VALUE = "all-topics";
  const navigate = useNavigate();
  const location = useLocation();
  const sharedTopicMatch = location.pathname.match(/^\/shared\/topics\/([0-9a-f-]+)\/?$/i);
  const sharedGroupMatch = location.pathname.match(/^\/shared\/groups\/([0-9a-f-]+)\/?$/i);
  const sharedTopicUuid = sharedTopicMatch?.[1] ?? null;
  const sharedGroupUuid = sharedGroupMatch?.[1] ?? null;
  const isSharedView = Boolean(sharedTopicUuid || sharedGroupUuid);
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const linkedGroupUuid = queryParams.get("group");
  const linkedTopicUuid = queryParams.get("topic");
  const clearLinkedQueryParams = () => {
    if (!linkedGroupUuid && !linkedTopicUuid) return;
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("group");
    nextParams.delete("topic");
    const nextSearch = nextParams.toString();
    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
    navigate(nextUrl, { replace: true });
  };
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
  const [topicsLoaded, setTopicsLoaded] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupName, setCreateGroupName] = useState("");
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [groupSelectOpen, setGroupSelectOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotificationsResponse | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const [topicMenuOpenId, setTopicMenuOpenId] = useState<string | null>(null);
  const topicMenuRef = useRef<HTMLDivElement | null>(null);
  const [changeGroupOpen, setChangeGroupOpen] = useState(false);
  const [changeGroupTopic, setChangeGroupTopic] = useState<TopicItem | null>(null);
  const [changeGroupValue, setChangeGroupValue] = useState("");
  const [changeGroupSaving, setChangeGroupSaving] = useState(false);
  const [changeGroupError, setChangeGroupError] = useState<string | null>(null);
  const [groupEditOpen, setGroupEditOpen] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState<ApiTopicGroupItem | null>(null);
  const [groupEditName, setGroupEditName] = useState("");
  const [groupEditPaused, setGroupEditPaused] = useState(false);
  const [groupEditSaving, setGroupEditSaving] = useState(false);
  const [groupEditDeleting, setGroupEditDeleting] = useState(false);
  const [groupEditError, setGroupEditError] = useState<string | null>(null);
  const groupSelectValue = useMemo(() => {
    if (selectedGroupId) return selectedGroupId;
    if (isAuthenticated === false) return undefined;
    return ALL_TOPICS_VALUE;
  }, [ALL_TOPICS_VALUE, isAuthenticated, selectedGroupId]);

  const notificationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    notifications?.topics.forEach((topic) => {
      counts[topic.topic_uuid] = topic.new_count;
    });
    return counts;
  }, [notifications]);
  const notificationTotal = notifications?.total_new ?? 0;
  const hasNewNotifications = notificationTotal > 0;

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
    hasNewItems:
      notificationCounts[topic.uuid] !== undefined
        ? notificationCounts[topic.uuid] > 0
        : topic.content_source_count > 0,
    groupUuid: topic.group_uuid,
    groupName: topic.group_name,
    ownerUsername: topic.owner_username,
    isOwner: topic.is_owner,
    domainAllowlist: topic.search_domain_allowlist,
    domainBlocklist: topic.search_domain_blocklist,
    languageFilter: topic.search_language_filter,
    country: topic.country,
    updateFrequency: topic.update_frequency,
    additionalQueriesMode: topic.additional_queries_mode ?? "auto",
  });

  const loadTopics = async (groupUuid?: string | null) => {
    try {
      setTopicsLoaded(false);
      setTopicsError(null);
      const response = await listTopics(undefined, groupUuid ?? undefined);
      setTopics(response.topics.map(toTopicItem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load topics.";
      setTopicsError(message);
      setTopics([]);
    } finally {
      setTopicsLoaded(true);
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

  const loadSharedScope = async () => {
    if (!isSharedView) return;
    setTopicsError(null);
    setGroupsError(null);
    setTopicsLoaded(false);
    setGroupsLoaded(false);

    try {
      if (sharedTopicUuid) {
        const topic = await getSharedTopic(sharedTopicUuid);
        const mappedTopic = toTopicItem(topic);
        if (topic.group_uuid) {
          const group = await getSharedTopicGroup(topic.group_uuid);
          setGroups([group]);
          setSelectedGroupId(group.uuid);
          setSelectedGroupName(group.name);
        } else {
          setGroups([]);
          setSelectedGroupId("");
          setSelectedGroupName("Shared topic");
        }
        setTopics([mappedTopic]);
        setSelectedTopicUuid(mappedTopic.uuid);
        setSelectedGroupTopicCount(1);
      } else if (sharedGroupUuid) {
        const [group, topicsResponse] = await Promise.all([
          getSharedTopicGroup(sharedGroupUuid),
          listSharedTopicsByGroup(sharedGroupUuid),
        ]);
        const mappedTopics = topicsResponse.topics.map(toTopicItem);
        setGroups([group]);
        setTopics(mappedTopics);
        setSelectedGroupId(group.uuid);
        setSelectedGroupName(group.name);
        setSelectedGroupTopicCount(mappedTopics.length);
        const nextSelectedTopicUuid =
          selectedTopicUuid && mappedTopics.some((topic) => topic.uuid === selectedTopicUuid)
            ? selectedTopicUuid
            : null;
        setSelectedTopicUuid(nextSelectedTopicUuid);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load shared view.";
      setGroupsError(message);
      setTopicsError(message);
      setGroups([]);
      setTopics([]);
      setSelectedGroupId("");
      setSelectedTopicUuid(null);
    } finally {
      setGroupsLoaded(true);
      setTopicsLoaded(true);
    }
  };

  const loadNotifications = async () => {
    if (!isAuthenticated) return;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await getNotifications();
      setNotifications(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load notifications.";
      setNotificationsError(message);
      setNotifications(null);
    } finally {
      setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    if (!isSharedView) return;
    void loadSharedScope();
  }, [isSharedView, sharedGroupUuid, sharedTopicUuid]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated === null) return;
    setGroupsLoaded(false);
  }, [isAuthenticated, isSharedView]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated === null) return;
    if (groupsLoaded) return;
    setGroupsLoaded(true);
    void loadGroups();
  }, [groupsLoaded, isAuthenticated, isSharedView]);

  useEffect(() => {
    if (isAuthenticated !== true) {
      setNotifications(null);
      setNotificationsError(null);
      setNotificationsLoading(false);
      setNotificationsOpen(false);
      return;
    }
    void loadNotifications();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!notificationsOpen) return;
    void loadNotifications();
  }, [notificationsOpen]);

  useEffect(() => {
    if (isAuthenticated !== true) return;
    const handleNotificationRefresh = () => {
      void loadNotifications();
    };
    window.addEventListener("topic-scan-completed", handleNotificationRefresh);
    return () => {
      window.removeEventListener("topic-scan-completed", handleNotificationRefresh);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!notifications) return;
    setTopics((prev) =>
      prev.map((topic) => ({
        ...topic,
        hasNewItems: (notificationCounts[topic.uuid] ?? 0) > 0,
      }))
    );
  }, [notificationCounts, notifications, setTopics]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated === null) return;
    setTopicsLoaded(false);
  }, [isAuthenticated, isSharedView]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated === null) return;
    if (!isAuthenticated) return;
    if (topicsLoaded) return;
    void loadTopics();
  }, [isAuthenticated, topicsLoaded, isSharedView]);

  const handleGroupChange = (groupId: string) => {
    if (isSharedView) return;
    const nextGroupId = groupId === ALL_TOPICS_VALUE ? "" : groupId;
    setSelectedGroupId(nextGroupId);
    setSelectedTopicUuid(null);
    navigate('/');
  };

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated !== false) return;
    if (!selectedGroupId) {
      setTopics([]);
      setTopicsError(null);
      return;
    }
    const canLoadSelectedGroup = groups.some(
      (group) => group.uuid === selectedGroupId && group.is_public
    );
    if (!canLoadSelectedGroup) {
      setTopics([]);
      setTopicsError(null);
      return;
    }
    void loadTopics(selectedGroupId);
  }, [groups, isAuthenticated, selectedGroupId, isSharedView]);

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

  useEffect(() => {
    if (isSharedView) return;
    if (!topicsLoaded) return;
    if (isAuthenticated !== true) return;
    if (topicsError) return;
    if (topics.length > 0) return;
    if (location.pathname !== "/") return;
    navigate("/topics");
  }, [isAuthenticated, isSharedView, location.pathname, navigate, topics.length, topicsError, topicsLoaded]);

  const filteredTopics = useMemo(() => {
    if (isAuthenticated === false) return topics;
    if (!selectedGroupId) return topics;
    return topics.filter((topic) => topic.groupUuid === selectedGroupId);
  }, [isAuthenticated, selectedGroupId, topics]);

  const groupTopicCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    topics.forEach((topic) => {
      if (!topic.groupUuid) return;
      counts[topic.groupUuid] = (counts[topic.groupUuid] ?? 0) + 1;
    });
    return counts;
  }, [topics]);

  useEffect(() => {
    setSelectedGroupTopicCount(filteredTopics.length);
  }, [filteredTopics, setSelectedGroupTopicCount]);

  const groupedOptions = useMemo(() => {
    const mapped = groups.map((group) => ({
      id: group.uuid,
      name: group.name,
      isPublic: group.is_public,
      isOwner: group.is_owner,
      group,
    }));
    if (isSharedView) {
      return {
        yours: mapped,
        publicGroups: [],
      };
    }
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
  }, [groups, isAuthenticated, isSharedView]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated === null) return;
    if (isAuthenticated === false) {
      const publicGroups = groups.filter((group) => group.is_public);
      if (publicGroups.length === 0) {
        setSelectedGroupId("");
        return;
      }
      if (!selectedGroupId) {
        setSelectedGroupId(publicGroups[0].uuid);
        return;
      }
      const isValidSelection = publicGroups.some(
        (group) => group.uuid === selectedGroupId
      );
      if (!isValidSelection) {
        setSelectedGroupId(publicGroups[0].uuid);
      }
      return;
    }
    if (selectedGroupId && !groups.some((group) => group.uuid === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, isAuthenticated, isSharedView, selectedGroupId]);

  useEffect(() => {
    if (isSharedView) return;
    if (isAuthenticated !== true) return;
    if (!linkedGroupUuid && !linkedTopicUuid) return;
    if (!groupsLoaded || !topicsLoaded) return;

    const linkedGroupExists = linkedGroupUuid
      ? groups.some((group) => group.uuid === linkedGroupUuid)
      : false;

    if (linkedTopicUuid) {
      const linkedTopic = topics.find((topic) => topic.uuid === linkedTopicUuid);
      if (linkedTopic) {
        const nextGroupId = linkedTopic.groupUuid ?? linkedGroupUuid ?? "";
        if (selectedGroupId !== nextGroupId) {
          setSelectedGroupId(nextGroupId);
        }
        if (selectedTopicUuid !== linkedTopic.uuid) {
          setSelectedTopicUuid(linkedTopic.uuid);
        }
        clearLinkedQueryParams();
        return;
      }

      if (linkedGroupUuid && linkedGroupExists) {
        if (selectedGroupId !== linkedGroupUuid) {
          setSelectedGroupId(linkedGroupUuid);
        }
        if (selectedTopicUuid !== null) {
          setSelectedTopicUuid(null);
        }
      }

      clearLinkedQueryParams();
      return;
    }

    if (!linkedGroupUuid) return;
    if (!linkedGroupExists) {
      clearLinkedQueryParams();
      return;
    }
    if (selectedGroupId !== linkedGroupUuid) {
      setSelectedGroupId(linkedGroupUuid);
    }
    if (selectedTopicUuid !== null) {
      setSelectedTopicUuid(null);
    }
    clearLinkedQueryParams();
  }, [
    groups,
    groupsLoaded,
    isAuthenticated,
    isSharedView,
    linkedGroupUuid,
    linkedTopicUuid,
    selectedGroupId,
    selectedTopicUuid,
    setSelectedGroupId,
    setSelectedTopicUuid,
    topics,
    topicsLoaded,
  ]);

  useEffect(() => {
    if (isSharedView) return;
    if (!selectedGroupId) {
      setSelectedGroupName(isAuthenticated === false ? "Featured topics" : "All topics");
      return;
    }
    const group = groups.find((entry) => entry.uuid === selectedGroupId);
    const fallback = isAuthenticated === false ? "Featured topics" : "Topics";
    setSelectedGroupName(group?.name ?? fallback);
  }, [groups, isAuthenticated, isSharedView, selectedGroupId, setSelectedGroupName]);

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
    if (!notificationsOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [notificationsOpen]);

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

  const handleUpgradeClick = () => {
    setProfileMenuOpen(false);
    navigate('/upgrade');
  };

  const handleApiAccessClick = () => {
    setProfileMenuOpen(false);
    navigate('/developer-access');
  };

  const handleCreateGroupOpen = (open: boolean) => {
    setCreateGroupOpen(open);
    if (!open) {
      setCreateGroupName("");
      setCreateGroupError(null);
    }
  };

  const handleCreateGroup = () => {
    if (!requireAuth()) {
      return;
    }
    if (creatingGroup) return;
    setCreateGroupError(null);
    setCreateGroupName("");
    setCreateGroupOpen(true);
  };

  const handleCreateGroupSubmit = async () => {
    if (!requireAuth()) {
      return;
    }
    if (creatingGroup) return;
    const trimmedName = createGroupName.trim();
    if (!trimmedName) {
      setCreateGroupError("Enter a topic group name.");
      return;
    }
    setCreatingGroup(true);
    setCreateGroupError(null);
    try {
      const response = await createTopicGroup({
        name: trimmedName,
        isPublic: false,
      });
      setGroups((prev) => [...prev, response.group]);
      setSelectedGroupId(response.group.uuid);
      handleCreateGroupOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create topic group.";
      setGroupsError(message);
      setCreateGroupError(message);
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

  const handleChangeGroupOpen = (open: boolean) => {
    setChangeGroupOpen(open);
    if (!open) {
      setChangeGroupTopic(null);
      setChangeGroupValue("");
      setChangeGroupError(null);
    }
  };

  const handleChangeGroupClick = (topic: TopicItem) => {
    if (!requireAuth()) {
      return;
    }
    setChangeGroupTopic(topic);
    setChangeGroupValue(topic.groupName ?? "");
    setChangeGroupError(null);
    setChangeGroupOpen(true);
    setTopicMenuOpenId(null);
  };

  const handleChangeGroupSave = async () => {
    if (!changeGroupTopic) {
      return;
    }
    if (!requireAuth()) {
      return;
    }
    const trimmedValue = changeGroupValue.trim();
    if (!trimmedValue) {
      setChangeGroupError("Enter a topic group name.");
      return;
    }
    const normalizedValue = trimmedValue.toLowerCase();
    const currentName = changeGroupTopic.groupName?.trim().toLowerCase() ?? "";
    if (currentName && normalizedValue === currentName) {
      setChangeGroupError("This topic is already in that group.");
      return;
    }
    const existingGroup = groups.find(
      (group) => group.name.trim().toLowerCase() === normalizedValue
    );
    setChangeGroupSaving(true);
    setChangeGroupError(null);
    try {
      let targetGroupId = existingGroup?.uuid ?? "";
      if (!targetGroupId) {
        const response = await createTopicGroup({
          name: trimmedValue,
          isPublic: false,
        });
        setGroups((prev) => [...prev, response.group]);
        targetGroupId = response.group.uuid;
      }
      const updated = await updateTopic(changeGroupTopic.uuid, {
        groupUuid: targetGroupId,
      });
      const mapped = toTopicItem(updated);
      setTopics((prev) =>
        prev.map((item) => (item.uuid === mapped.uuid ? mapped : item))
      );
      handleChangeGroupOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to change the topic group.";
      setChangeGroupError(message);
    } finally {
      setChangeGroupSaving(false);
    }
  };

  const handleGroupEditOpen = (open: boolean) => {
    setGroupEditOpen(open);
    if (!open) {
      setGroupEditTarget(null);
      setGroupEditName("");
      setGroupEditPaused(false);
      setGroupEditError(null);
      setGroupEditSaving(false);
      setGroupEditDeleting(false);
    }
  };

  const handleGroupEditClick = (group: ApiTopicGroupItem) => {
    if (!requireAuth()) {
      return;
    }
    setGroupSelectOpen(false);
    setGroupEditTarget(group);
    setGroupEditName(group.name);
    setGroupEditPaused(group.is_paused);
    setGroupEditError(null);
    setGroupEditOpen(true);
  };

  const handleGroupEditSave = async () => {
    if (!groupEditTarget) return;
    if (!requireAuth()) {
      return;
    }
    const trimmedName = groupEditName.trim();
    if (!trimmedName) {
      setGroupEditError("Group name is required.");
      return;
    }
    if (
      trimmedName === groupEditTarget.name &&
      groupEditPaused === groupEditTarget.is_paused
    ) {
      setGroupEditError("No changes to save.");
      return;
    }
    setGroupEditSaving(true);
    setGroupEditError(null);
    try {
      await updateTopicGroup(groupEditTarget.uuid, {
        name: trimmedName,
        isPaused: groupEditPaused,
      });
      setGroups((prev) =>
        prev.map((group) =>
          group.uuid === groupEditTarget.uuid
            ? { ...group, name: trimmedName, is_paused: groupEditPaused }
            : group
        )
      );
      setTopics((prev) =>
        prev.map((topic) =>
          topic.groupUuid === groupEditTarget.uuid
            ? { ...topic, groupName: trimmedName }
            : topic
        )
      );
      handleGroupEditOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update topic group.";
      setGroupEditError(message);
    } finally {
      setGroupEditSaving(false);
    }
  };

  const handleGroupDelete = async () => {
    if (!groupEditTarget) return;
    if (!requireAuth()) {
      return;
    }
    setGroupEditDeleting(true);
    setGroupEditError(null);
    try {
      await deleteTopicGroup(groupEditTarget.uuid);
      setGroups((prev) => prev.filter((group) => group.uuid !== groupEditTarget.uuid));
      setTopics((prev) =>
        prev.map((topic) =>
          topic.groupUuid === groupEditTarget.uuid
            ? { ...topic, groupUuid: null, groupName: null }
            : topic
        )
      );
      if (selectedGroupId === groupEditTarget.uuid) {
        setSelectedGroupId("");
      }
      handleGroupEditOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete topic group.";
      setGroupEditError(message);
    } finally {
      setGroupEditDeleting(false);
    }
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

  const isTopicGroupPaused = (topic: TopicItem) => {
    if (!topic.groupUuid) {
      return false;
    }
    return groups.some((group) => group.uuid === topic.groupUuid && group.is_paused);
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
    if (isTopicGroupPaused(topic)) {
      setTopicsError("Scanning is paused for this topic group.");
      setTopicMenuOpenId(null);
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

  const handleNotificationSelect = (
    item: ApiNotificationsResponse["topics"][number]
  ) => {
    if (!requireAuth()) {
      return;
    }
    const nextGroupId = item.group_uuid ?? "";
    setSelectedGroupId(nextGroupId);
    setSelectedTopicUuid(item.topic_uuid);
    setNotificationsOpen(false);
    navigate("/?filter=new");
  };

  const changeGroupDisabled =
    !changeGroupTopic ||
    !changeGroupValue.trim() ||
    changeGroupSaving;

  return (
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans flex-col">
        <AuthDialog isOpen={authDialogOpen} onOpenChange={setAuthDialogOpen} />
        <Dialog open={createGroupOpen} onOpenChange={handleCreateGroupOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create a topic group</DialogTitle>
              <DialogDescription>
                Give your group a name to organize related topics.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateGroupSubmit();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label
                  htmlFor="create-group-name"
                  className="text-[10px] uppercase tracking-widest text-muted-foreground/70"
                >
                  Group name
                </Label>
                <Input
                  id="create-group-name"
                  value={createGroupName}
                  onChange={(event) => setCreateGroupName(event.target.value)}
                  placeholder="e.g. Market alerts"
                  className="h-9 text-sm"
                  disabled={creatingGroup}
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  You can edit the name later.
                </p>
              </div>
              {createGroupError && (
                <p className="text-sm text-destructive">{createGroupError}</p>
              )}
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => handleCreateGroupOpen(false)}
                  type="button"
                  disabled={creatingGroup}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creatingGroup}>
                  {creatingGroup ? "Creating..." : "Create group"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={changeGroupOpen} onOpenChange={handleChangeGroupOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Change topic group</DialogTitle>
              <DialogDescription>
                {changeGroupTopic
                  ? `Move "${changeGroupTopic.term}" to another group.`
                  : "Choose a group for this topic."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="change-group-input"
                  className="text-[10px] uppercase tracking-widest text-muted-foreground/70"
                >
                  Topic group
                </Label>
                <Input
                  id="change-group-input"
                  list="change-group-options"
                  value={changeGroupValue}
                  onChange={(event) => setChangeGroupValue(event.target.value)}
                  placeholder="Select or type a new group name"
                  className="h-9 text-sm"
                  disabled={changeGroupSaving}
                />
                <datalist id="change-group-options">
                  {groups.map((group) => (
                    <option key={group.uuid} value={group.name} />
                  ))}
                </datalist>
                <p className="text-[11px] text-muted-foreground">
                  Pick an existing group or type a new name to create it.
                </p>
              </div>
              {changeGroupError && (
                <p className="text-sm text-destructive">{changeGroupError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => handleChangeGroupOpen(false)}
                type="button"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleChangeGroupSave()}
                disabled={changeGroupDisabled}
                type="button"
              >
                {changeGroupSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={groupEditOpen} onOpenChange={handleGroupEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit topic group</DialogTitle>
              <DialogDescription>
                Update the group name or delete the group. Topics will remain, but their
                group will be cleared.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-edit-name">Group name</Label>
                <Input
                  id="group-edit-name"
                  value={groupEditName}
                  onChange={(event) => setGroupEditName(event.target.value)}
                  placeholder="Topic group name"
                  disabled={groupEditSaving || groupEditDeleting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-edit-status">Scanning status</Label>
                <select
                  id="group-edit-status"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={groupEditPaused ? "paused" : "active"}
                  onChange={(event) => setGroupEditPaused(event.target.value === "paused")}
                  disabled={groupEditSaving || groupEditDeleting}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Paused groups skip both manual and scheduled scans until resumed.
                </p>
              </div>
              {groupEditError && (
                <p className="text-sm text-destructive">{groupEditError}</p>
              )}
            </div>
            <DialogFooter>
              <div className="flex w-full items-center justify-between gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  type="button"
                  onClick={() => void handleGroupDelete()}
                  disabled={groupEditDeleting || groupEditSaving}
                >
                  {groupEditDeleting ? "Deleting..." : "Delete group"}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => handleGroupEditOpen(false)}
                    type="button"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleGroupEditSave()}
                    disabled={groupEditSaving || groupEditDeleting || !groupEditName.trim()}
                    type="button"
                  >
                    {groupEditSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Top Navbar - 100% Width */}
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-6 z-20 sticky top-0 w-full shrink-0">
         <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3 group">
               <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 group-hover:bg-primary/20 transition-all duration-300">
                  <Radio className="h-5 w-5 animate-pulse" />
                  <div className="absolute inset-0 rounded-lg ring-1 ring-primary/50 animate-ping opacity-10 duration-1000"></div>
               </div>
               <div className="flex flex-col">
                 <h1 className="font-bold text-base tracking-tight leading-none text-foreground">NewsRadar</h1>
                 <span className="text-[10px] text-muted-foreground font-mono mt-1 opacity-60 uppercase">Agenda Monitor</span>
               </div>
            </Link>
         </div>
         
         <div className="flex items-center gap-4">
            <Link
              to="/developer-access"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <KeyRound className="h-3.5 w-3.5" />
              API
            </Link>

            <div className="flex items-center gap-2 border-l border-border pl-4">
              {isAuthenticated ? (
                <>
                  <div className="relative" ref={notificationsRef}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted relative"
                      onClick={() => setNotificationsOpen((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={notificationsOpen}
                    >
                      <Bell className="h-4 w-4" />
                      {hasNewNotifications && (
                        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-destructive animate-pulse"></span>
                      )}
                    </Button>
                    {notificationsOpen && (
                      <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-background shadow-lg p-3 z-50">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                            Notifications
                          </p>
                          {notificationTotal > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {notificationTotal} new
                            </span>
                          )}
                        </div>
                        <div className="mt-3 space-y-2">
                          {notificationsLoading && (
                            <p className="text-xs text-muted-foreground">Loading...</p>
                          )}
                          {notificationsError && (
                            <p className="text-xs text-destructive">{notificationsError}</p>
                          )}
                          {!notificationsLoading &&
                            !notificationsError &&
                            notifications &&
                            notifications.topics.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                No new content.
                              </p>
                            )}
                          {!notificationsLoading &&
                            !notificationsError &&
                            notifications &&
                            notifications.topics.length > 0 && (
                              <div className="space-y-1">
                                {notifications.topics.map((item) => (
                                  <button
                                    key={item.topic_uuid}
                                    type="button"
                                    className="w-full text-left px-3 py-2 rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
                                    onClick={() => handleNotificationSelect(item)}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-foreground">
                                        {item.topic_queries?.[0] || "Untitled topic"}
                                      </span>
                                      <span className="text-[10px] font-mono text-primary">
                                        {item.new_count}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {item.group_name || "Private group"}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      </div>
                    )}
                  </div>
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
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors flex items-center gap-2"
                          onClick={handleApiAccessClick}
                          type="button"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          API Access
                        </button>
                        {!currentUser?.is_pro && (
                          <>
                            <div className="h-px bg-border/70 my-2" />
                            <button
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-primary hover:text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2"
                              onClick={handleUpgradeClick}
                              type="button"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Upgrade to Pro
                            </button>
                          </>
                        )}
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
               value={groupSelectValue}
               onValueChange={handleGroupChange}
               open={groupSelectOpen}
               onOpenChange={setGroupSelectOpen}
               disabled={isSharedView}
             >
                <SelectTrigger className="w-full bg-muted/30 border-border/50 text-xs h-9 rounded-none font-bold tracking-widest">
                  <SelectValue
                    placeholder={isAuthenticated === false ? "Topic groups" : "All content"}
                  />
                </SelectTrigger>
                <SelectContent className="rounded-none border-border">
                  {isAuthenticated !== false && (
                    <>
                      <SelectGroup>
                        <SelectItem
                          value={ALL_TOPICS_VALUE}
                          className="text-xs font-bold tracking-widest rounded-none"
                        >
                          All topics
                        </SelectItem>
                      </SelectGroup>
                      <SelectSeparator className="bg-border/50" />
                    </>
                  )}
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase text-muted-foreground/60 px-2 py-1.5">
                      {isSharedView ? "Shared" : "Yours"}
                    </SelectLabel>
                    {groupedOptions.yours.length > 0 ? (
                      groupedOptions.yours.map((group) => (
                        <SelectPrimitive.Item
                          key={group.id}
                          value={group.id}
                          textValue={group.name}
                          className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-xs font-bold tracking-widest outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 rounded-none"
                        >
                          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                            <SelectPrimitive.ItemIndicator>
                              <Check className="h-4 w-4" />
                            </SelectPrimitive.ItemIndicator>
                          </span>
                          <SelectPrimitive.ItemText className="flex-1 truncate">
                            {group.name}
                          </SelectPrimitive.ItemText>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground/70">
                              {groupTopicCounts[group.id] ?? 0}
                            </span>
                            {group.group.is_paused && (
                              <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Paused
                              </span>
                            )}
                            {isSharedView !== true && isAuthenticated !== false && group.isOwner && (
                              <button
                                type="button"
                                className="rounded-md p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50"
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleGroupEditClick(group.group);
                                }}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                aria-label={`Edit ${group.name}`}
                                title="Edit group"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </SelectPrimitive.Item>
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
                          Featured
                        </SelectLabel>
                        {groupedOptions.publicGroups.map((group) => (
                          <SelectPrimitive.Item
                            key={group.id}
                            value={group.id}
                            textValue={group.name}
                            className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-xs font-bold tracking-widest outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 rounded-none"
                          >
                            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                              <SelectPrimitive.ItemIndicator>
                                <Check className="h-4 w-4" />
                              </SelectPrimitive.ItemIndicator>
                            </span>
                            <SelectPrimitive.ItemText className="flex-1 truncate">
                              {group.name}
                            </SelectPrimitive.ItemText>
                            <div className="ml-auto flex items-center gap-2">
                              <span className="text-[10px] font-mono text-muted-foreground/70">
                                {groupTopicCounts[group.id] ?? 0}
                              </span>
                              {group.group.is_paused && (
                                <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Paused
                                </span>
                              )}
                              {isSharedView !== true && isAuthenticated !== false && group.isOwner && (
                                <button
                                  type="button"
                                  className="rounded-md p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50"
                                  onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleGroupEditClick(group.group);
                                  }}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  aria-label={`Edit ${group.name}`}
                                  title="Edit group"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </SelectPrimitive.Item>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  {!isSharedView && (
                    <>
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
                      <button
                        className="w-full flex items-center gap-2 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/5 transition-colors"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleAddTopicClick();
                        }}
                        type="button"
                      >
                        <PlusCircle className="h-3 w-3" />
                        Create a topic
                      </button>
                    </>
                  )}
                </SelectContent>
             </Select>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
             {filteredTopics.map((topic) => {
               const topicGroupPaused = isTopicGroupPaused(topic);
               return (
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
                     if (!isSharedView) {
                       navigate('/');
                     }
                   }}
                 >
                   <div className="flex items-center gap-2">
                     <span
                       className={cn(
                         "flex-1 min-w-0 font-semibold text-foreground truncate",
                         topic.isActive ? "" : "text-muted-foreground/70"
                       )}
                     >
                       {topic.term}
                     </span>
                     {topicGroupPaused && (
                       <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                         Paused
                       </span>
                     )}
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
                       {topicGroupPaused
                         ? "; group paused"
                         : `; updates ${formatRecency(topic.updateFrequency)}`}
                     </span>
                     {!isSharedView && (
                       <div
                         className="relative"
                         ref={topic.uuid === topicMenuOpenId ? topicMenuRef : null}
                       >
                         <Button
                           variant="ghost"
                           size="icon"
                           className={cn(
                             "h-6 w-6 rounded-full text-muted-foreground/70",
                             "hover:text-foreground hover:bg-muted/50"
                           )}
                           onClick={(event) => {
                             event.stopPropagation();
                             setTopicMenuOpenId((prev) =>
                               prev === topic.uuid ? null : topic.uuid
                             );
                           }}
                           type="button"
                           aria-haspopup="menu"
                           aria-expanded={topicMenuOpenId === topic.uuid}
                           title="Manage topic"
                         >
                           <MoreVertical className="h-3.5 w-3.5" />
                         </Button>
                         {topicMenuOpenId === topic.uuid && (
                           <div
                             className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-background shadow-lg p-2 z-50"
                             onClick={(event) => event.stopPropagation()}
                           >
                             <button
                               className={cn(
                                 "w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors",
                                 topicGroupPaused
                                   ? "cursor-not-allowed text-muted-foreground/50"
                                   : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                               )}
                               onClick={() => void handleTopicScanNow(topic)}
                               type="button"
                               disabled={topicGroupPaused}
                             >
                               Scan now
                             </button>
                             {topicGroupPaused && (
                               <p className="px-3 pb-2 text-[10px] text-muted-foreground/70">
                                 Resume this topic group to run scans again.
                               </p>
                             )}
                             <div className="h-px bg-border/70 my-2" />
                             <p className="px-3 pt-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                               Scan frequency
                             </p>
                             <button
                               className={cn(
                                 "w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-colors",
                                 topic.updateFrequency === "day"
                                   ? "text-foreground"
                                   : "text-muted-foreground",
                                 "hover:text-foreground hover:bg-muted/60"
                               )}
                               onClick={() => void handleTopicFrequency(topic, "day")}
                               type="button"
                             >
                               <span
                                 className={cn(
                                   "h-1.5 w-1.5 rounded-full",
                                   topic.updateFrequency === "day"
                                     ? "bg-primary"
                                     : "bg-transparent opacity-0"
                                 )}
                               />
                               Daily
                             </button>
                             <button
                               className={cn(
                                 "w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-colors",
                                 topic.updateFrequency === "week"
                                   ? "text-foreground"
                                   : "text-muted-foreground",
                                 "hover:text-foreground hover:bg-muted/60"
                               )}
                               onClick={() => void handleTopicFrequency(topic, "week")}
                               type="button"
                             >
                               <span
                                 className={cn(
                                   "h-1.5 w-1.5 rounded-full",
                                   topic.updateFrequency === "week"
                                     ? "bg-primary"
                                     : "bg-transparent opacity-0"
                                 )}
                               />
                               Weekly
                             </button>
                             <button
                               className={cn(
                                 "w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-colors",
                                 topic.updateFrequency === "manual"
                                   ? "text-foreground"
                                   : "text-muted-foreground",
                                 "hover:text-foreground hover:bg-muted/60"
                               )}
                               onClick={() => void handleTopicFrequency(topic, "manual")}
                               type="button"
                             >
                               <span
                                 className={cn(
                                   "h-1.5 w-1.5 rounded-full",
                                   topic.updateFrequency === "manual"
                                     ? "bg-primary"
                                     : "bg-transparent opacity-0"
                                 )}
                               />
                               Manual
                             </button>
                             <div className="h-px bg-border/70 my-2" />
                             <button
                               className="w-full text-left px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                               onClick={() => handleChangeGroupClick(topic)}
                               type="button"
                             >
                               Change group
                             </button>
                             <div className="h-px bg-border/70 my-2" />
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
                     )}
                   </div>
                 </div>
               );
             })}

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
             
             {!isSharedView && (
               <button
                 className={cn(
                   "w-full flex items-center justify-center gap-2 py-3 mt-4 text-muted-foreground border border-dashed border-border/50 rounded-lg transition-all text-xs font-medium group bg-muted/10",
                   "hover:text-primary hover:border-primary/30"
                 )}
                 onClick={handleAddTopicClick}
                 type="button"
                 title="Add a topic"
               >
                 <PlusCircle className="h-4 w-4 group-hover:scale-110 transition-transform" />
                 <span>Add Topic</span>
               </button>
             )}
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
