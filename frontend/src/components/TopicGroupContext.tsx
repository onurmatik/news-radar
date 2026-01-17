import React, { createContext, useContext, useState } from 'react';

type TopicGroupContextValue = {
  selectedGroupName: string;
  setSelectedGroupName: (name: string) => void;
};

const TopicGroupContext = createContext<TopicGroupContextValue | null>(null);

export function TopicGroupProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroupName, setSelectedGroupName] = useState("Intelligence Feed");

  return (
    <TopicGroupContext.Provider value={{ selectedGroupName, setSelectedGroupName }}>
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
