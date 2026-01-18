import React, { createContext, useContext, useState } from 'react';
import type { ApiTopicGroupItem } from '@/lib/types';

type TopicGroupContextValue = {
  selectedGroupName: string;
  setSelectedGroupName: (name: string) => void;
  selectedGroupId: string;
  setSelectedGroupId: (id: string) => void;
  selectedGroupTopicCount: number;
  setSelectedGroupTopicCount: (count: number) => void;
  selectedTopicUuid: string | null;
  setSelectedTopicUuid: (uuid: string | null) => void;
  contentViewMode: "read" | "edit";
  setContentViewMode: (mode: "read" | "edit") => void;
  groups: ApiTopicGroupItem[];
  setGroups: React.Dispatch<React.SetStateAction<ApiTopicGroupItem[]>>;
};

const TopicGroupContext = createContext<TopicGroupContextValue | null>(null);

export function TopicGroupProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroupName, setSelectedGroupName] = useState("Intelligence Feed");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedGroupTopicCount, setSelectedGroupTopicCount] = useState(0);
  const [selectedTopicUuid, setSelectedTopicUuid] = useState<string | null>(null);
  const [contentViewMode, setContentViewMode] = useState<"read" | "edit">("read");
  const [groups, setGroups] = useState<ApiTopicGroupItem[]>([]);

  return (
    <TopicGroupContext.Provider
      value={{
        selectedGroupName,
        setSelectedGroupName,
        selectedGroupId,
        setSelectedGroupId,
        selectedGroupTopicCount,
        setSelectedGroupTopicCount,
        selectedTopicUuid,
        setSelectedTopicUuid,
        contentViewMode,
        setContentViewMode,
        groups,
        setGroups,
      }}
    >
      {children}
    </TopicGroupContext.Provider>
  );
}

export function useTopicGroup() {
  const context = useContext(TopicGroupContext);
  if (!context) {
    throw new Error('useTopicGroup must be used within TopicGroupProvider.');
  }
  return context;
}
