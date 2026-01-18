import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { TopicForm } from '@/components/TopicForm';

export default function Topics() {
  const { selectedGroupName } = useTopicGroup();
  const [searchParams, setSearchParams] = useSearchParams();
  const editingTopicId = searchParams.get("edit");
  const mode = editingTopicId ? "edit" : "create";

  const clearEditMode = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("edit");
    setSearchParams(nextParams);
  };

  return (
    <Layout>
      <div className="mx-auto space-y-8 p-4 md:p-6 lg:p-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{selectedGroupName}</h2>
          <p className="text-muted-foreground mt-1">Manage monitoring targets and AI search parameters.</p>
        </div>

        <TopicForm
          mode={mode}
          topicUuid={editingTopicId}
          onCancel={mode === "edit" ? clearEditMode : undefined}
          onSaved={(topic, savedMode) => {
            if (savedMode === "edit") {
              clearEditMode();
            }
          }}
        />
      </div>
    </Layout>
  );
}
