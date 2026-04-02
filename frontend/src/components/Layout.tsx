import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Loader2, FolderPlus } from "lucide-react";

import { AuthDialog } from "@/components/AuthDialog";
import { useAuthDialog } from "@/components/AuthDialogContext";
import { useTopicGroup } from "@/components/TopicGroupContext";
import { useTopics } from "@/components/TopicsContext";
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
import {
  createTopicGroup,
  deleteTopicGroup,
  listTopicGroups,
  listTopics,
  updateTopicGroup,
} from "@/lib/api";
import type { ApiTopicListItem, TopicItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type LayoutProps = {
  children: React.ReactNode;
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

function formatFrequency(topic: TopicItem) {
  switch (topic.updateFrequency) {
    case "auto":
      return `auto${topic.autoEffectiveIntervalHours ? ` / ${topic.autoEffectiveIntervalHours}h` : ""}`;
    case "hour":
      return "hourly";
    case "day":
      return "daily";
    case "week":
      return "weekly";
    default:
      return "manual";
  }
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAuthenticated,
    currentUser,
    openAuthDialog,
    authDialogOpen,
    setAuthDialogOpen,
  } = useAuthDialog();
  const {
    selectedGroupId,
    setSelectedGroupId,
    setSelectedGroupName,
    selectedGroupTopicCount,
    setSelectedGroupTopicCount,
    selectedTopicUuid,
    setSelectedTopicUuid,
    groups,
    setGroups,
  } = useTopicGroup();
  const { topics, setTopics } = useTopics();
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupSaving, setCreateGroupSaving] = useState(false);
  const [createGroupName, setCreateGroupName] = useState("");
  const [createGroupDescription, setCreateGroupDescription] = useState("");
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [editGroupOpen, setEditGroupOpen] = useState(false);
  const [editGroupSaving, setEditGroupSaving] = useState(false);
  const [editGroupDeleting, setEditGroupDeleting] = useState(false);
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");

  const selectedGroup = groups.find((group) => group.uuid === selectedGroupId) ?? null;
  const filteredTopics = useMemo(() => {
    if (!selectedGroupId) return topics;
    return topics.filter((topic) => topic.groupUuid === selectedGroupId);
  }, [selectedGroupId, topics]);
  const onTopicsPage = location.pathname.startsWith("/topics");

  const requireAuth = () => {
    if (isAuthenticated) return true;
    openAuthDialog();
    return false;
  };

  useEffect(() => {
    if (isAuthenticated !== true) {
      setGroups([]);
      setTopics([]);
      setSelectedGroupId("");
      setSelectedGroupName("All topics");
      setSelectedGroupTopicCount(0);
      setSelectedTopicUuid(null);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    listTopicGroups()
      .then((response) => setGroups(response.groups))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to load topic groups.";
        setGroupsError(message);
        setGroups([]);
      })
      .finally(() => setGroupsLoading(false));
  }, [
    isAuthenticated,
    setGroups,
    setSelectedGroupId,
    setSelectedGroupName,
    setSelectedGroupTopicCount,
    setSelectedTopicUuid,
    setTopics,
  ]);

  useEffect(() => {
    if (isAuthenticated !== true) {
      setTopics([]);
      return;
    }
    setTopicsLoading(true);
    setTopicsError(null);
    listTopics()
      .then((response) => setTopics(response.topics.map(mapTopic)))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to load topics.";
        setTopicsError(message);
        setTopics([]);
      })
      .finally(() => setTopicsLoading(false));
  }, [isAuthenticated, setTopics]);

  useEffect(() => {
    if (selectedGroup) {
      setSelectedGroupName(selectedGroup.name);
      setSelectedGroupTopicCount(topics.filter((topic) => topic.groupUuid === selectedGroup.uuid).length);
      return;
    }
    setSelectedGroupName("All topics");
    setSelectedGroupTopicCount(topics.length);
  }, [selectedGroup, setSelectedGroupName, setSelectedGroupTopicCount, topics]);

  useEffect(() => {
    if (!selectedTopicUuid) return;
    const match = topics.find((topic) => topic.uuid === selectedTopicUuid);
    if (!match) {
      setSelectedTopicUuid(null);
      return;
    }
    if (match.groupUuid && match.groupUuid !== selectedGroupId) {
      setSelectedGroupId(match.groupUuid);
    }
  }, [selectedGroupId, selectedTopicUuid, setSelectedGroupId, setSelectedTopicUuid, topics]);

  const handleAddTopic = () => {
    if (!requireAuth()) return;
    navigate("/topics");
  };

  const handleCreateGroup = async () => {
    if (!requireAuth()) return;
    if (!createGroupName.trim()) {
      setCreateGroupError("Group name cannot be empty.");
      return;
    }
    setCreateGroupSaving(true);
    setCreateGroupError(null);
    try {
      const response = await createTopicGroup({
        name: createGroupName.trim(),
        description: createGroupDescription.trim(),
      });
      setGroups((prev) => [...prev, response.group].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedGroupId(response.group.uuid);
      setCreateGroupName("");
      setCreateGroupDescription("");
      setCreateGroupOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create topic group.";
      setCreateGroupError(message);
    } finally {
      setCreateGroupSaving(false);
    }
  };

  const openEditGroupDialog = () => {
    if (!selectedGroup) return;
    setEditGroupName(selectedGroup.name);
    setEditGroupDescription(selectedGroup.description);
    setEditGroupError(null);
    setEditGroupOpen(true);
  };

  const handleUpdateGroup = async () => {
    if (!selectedGroup) return;
    if (!editGroupName.trim()) {
      setEditGroupError("Group name cannot be empty.");
      return;
    }
    setEditGroupSaving(true);
    setEditGroupError(null);
    try {
      const updated = await updateTopicGroup(selectedGroup.uuid, {
        name: editGroupName.trim(),
        description: editGroupDescription.trim(),
      });
      setGroups((prev) =>
        prev
          .map((group) => (group.uuid === updated.uuid ? updated : group))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditGroupOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update group.";
      setEditGroupError(message);
    } finally {
      setEditGroupSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    setEditGroupDeleting(true);
    setEditGroupError(null);
    try {
      await deleteTopicGroup(selectedGroup.uuid);
      setGroups((prev) => prev.filter((group) => group.uuid !== selectedGroup.uuid));
      setTopics((prev) =>
        prev.map((topic) =>
          topic.groupUuid === selectedGroup.uuid
            ? { ...topic, groupUuid: null, groupName: null }
            : topic
        )
      );
      setSelectedGroupId("");
      setSelectedTopicUuid(null);
      setEditGroupOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete group.";
      setEditGroupError(message);
    } finally {
      setEditGroupDeleting(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 lg:flex-row">
      <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:flex lg:w-[320px] lg:flex-col lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-600">
                NewsRadar
              </p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">Monitoring</h1>
              <p className="mt-1 text-sm text-slate-500">
                {currentUser ? currentUser.email : "Sign in to manage your radar"}
              </p>
            </div>
            <Button size="sm" onClick={handleAddTopic}>
              <Plus className="mr-2 h-4 w-4" />
              Topic
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-6 flex items-center justify-between px-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                Topic groups
              </p>
              <p className="mt-1 text-sm text-slate-500">{selectedGroupTopicCount} topics visible</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreateGroupOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              Group
            </Button>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setSelectedGroupId("");
                setSelectedTopicUuid(null);
                navigate("/");
              }}
              className={cn(
                "w-full rounded-2xl px-4 py-3 text-left transition-colors",
                !selectedGroupId
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <p className="text-sm font-semibold">All topics</p>
              <p className="mt-1 text-xs text-slate-500">{topics.length} topics</p>
            </button>
            {groups.map((group) => (
              <button
                key={group.uuid}
                type="button"
                onClick={() => {
                  setSelectedGroupId(group.uuid);
                  setSelectedTopicUuid(null);
                  navigate("/");
                }}
                className={cn(
                  "w-full rounded-2xl px-4 py-3 text-left transition-colors",
                  selectedGroupId === group.uuid
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <p className="text-sm font-semibold">{group.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {topics.filter((topic) => topic.groupUuid === group.uuid).length} topics
                </p>
              </button>
            ))}
          </div>

          {selectedGroup && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedGroup.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Visual organization only. Topics keep their own filters and frequency.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={openEditGroupDialog}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              </div>
            </div>
          )}

          <div className="mt-8">
            <div className="mb-3 px-2">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                Topics
              </p>
            </div>

            {(groupsLoading || topicsLoading) && (
              <div className="px-3 py-4 text-sm text-slate-500">Loading topics...</div>
            )}

            {(groupsError || topicsError) && (
              <div className="px-3 py-4 text-sm text-destructive">{groupsError || topicsError}</div>
            )}

            {!groupsLoading && !topicsLoading && filteredTopics.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                {selectedGroupId
                  ? "No topics in this group yet."
                  : "No topics yet. Create one to start monitoring."}
              </div>
            )}

            <div className="space-y-2">
              {filteredTopics.map((topic) => (
                <button
                  key={topic.uuid}
                  type="button"
                  onClick={() => {
                    setSelectedTopicUuid(topic.uuid);
                    if (topic.groupUuid) {
                      setSelectedGroupId(topic.groupUuid);
                    }
                    navigate("/");
                  }}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                    selectedTopicUuid === topic.uuid && !onTopicsPage
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{topic.term}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatFrequency(topic)}</p>
                    </div>
                    {topic.hasNewItems && (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>

      <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create group</DialogTitle>
            <DialogDescription>
              Groups are optional visual buckets for organizing related topics.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={createGroupName}
              onChange={(event) => setCreateGroupName(event.target.value)}
              placeholder="Group name"
            />
            <Input
              value={createGroupDescription}
              onChange={(event) => setCreateGroupDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            {createGroupError && <p className="text-sm text-destructive">{createGroupError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateGroupOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateGroup()} disabled={createGroupSaving}>
              {createGroupSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editGroupOpen} onOpenChange={setEditGroupOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit group</DialogTitle>
            <DialogDescription>
              Rename or delete this visual topic bucket.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={editGroupName}
              onChange={(event) => setEditGroupName(event.target.value)}
              placeholder="Group name"
            />
            <Input
              value={editGroupDescription}
              onChange={(event) => setEditGroupDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            {editGroupError && <p className="text-sm text-destructive">{editGroupError}</p>}
          </div>
          <DialogFooter className="justify-between">
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void handleDeleteGroup()}
              disabled={editGroupDeleting}
            >
              {editGroupDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete group
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setEditGroupOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleUpdateGroup()} disabled={editGroupSaving}>
                {editGroupSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save group
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </div>
  );
}
