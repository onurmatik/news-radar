import React, { createContext, useContext, useState } from 'react';
import type { TopicItem } from '@/lib/types';

type TopicsContextValue = {
  topics: TopicItem[];
  setTopics: React.Dispatch<React.SetStateAction<TopicItem[]>>;
};

const TopicsContext = createContext<TopicsContextValue | null>(null);

export function TopicsProvider({ children }: { children: React.ReactNode }) {
  const [topics, setTopics] = useState<TopicItem[]>([]);
  return (
    <TopicsContext.Provider value={{ topics, setTopics }}>
      {children}
    </TopicsContext.Provider>
  );
}

export function useTopics() {
  const context = useContext(TopicsContext);
  if (!context) {
    throw new Error('useTopics must be used within TopicsProvider.');
  }
  return context;
}
