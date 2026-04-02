import React, { createContext, useContext, useState } from 'react';
import type { ApiTopicGroupItem } from '@/lib/types';

type TopicGroupContextValue = {
  selectedGroupName: string;
  setSelectedGroupName: React.Dispatch<React.SetStateAction<string>>;
  selectedGroupId: string;
  setSelectedGroupId: React.Dispatch<React.SetStateAction<string>>;
  selectedGroupTopicCount: number;
  setSelectedGroupTopicCount: React.Dispatch<React.SetStateAction<number>>;
  selectedTopicUuid: string | null;
  setSelectedTopicUuid: React.Dispatch<React.SetStateAction<string | null>>;
  contentViewMode: "read" | "edit";
  setContentViewMode: React.Dispatch<React.SetStateAction<"read" | "edit">>;
  groups: ApiTopicGroupItem[];
  setGroups: React.Dispatch<React.SetStateAction<ApiTopicGroupItem[]>>;
};

const TopicGroupContext = createContext<TopicGroupContextValue | null>(null);

export function TopicGroupProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroupName, setSelectedGroupName] = useState("All topics");
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
