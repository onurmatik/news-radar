import React, { createContext, useContext, useState } from 'react';

type TopicGroupContextValue = {
  selectedGroupName: string;
  setSelectedGroupName: (name: string) => void;
  selectedGroupId: string;
  setSelectedGroupId: (id: string) => void;
  selectedGroupTopicCount: number;
  setSelectedGroupTopicCount: (count: number) => void;
};

const TopicGroupContext = createContext<TopicGroupContextValue | null>(null);

export function TopicGroupProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroupName, setSelectedGroupName] = useState("Intelligence Feed");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedGroupTopicCount, setSelectedGroupTopicCount] = useState(0);

  return (
    <TopicGroupContext.Provider
      value={{
        selectedGroupName,
        setSelectedGroupName,
        selectedGroupId,
        setSelectedGroupId,
        selectedGroupTopicCount,
        setSelectedGroupTopicCount,
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
