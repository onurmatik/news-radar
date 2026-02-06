import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { TopicForm } from '@/components/TopicForm';

export default function Topics() {
  const { setSelectedTopicUuid } = useTopicGroup();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const editingTopicId = searchParams.get("edit");
  const mode = editingTopicId ? "edit" : "create";

  const clearEditMode = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("edit");
    setSearchParams(nextParams);
  };

  const closeCreateMode = () => {
    setSelectedTopicUuid(null);
    navigate('/');
  };

  return (
    <Layout>
      <div className="h-full w-full">
        <TopicForm
          mode={mode}
          topicUuid={editingTopicId}
          className="h-full w-full"
          variant="full"
          onCancel={mode === "edit" ? clearEditMode : closeCreateMode}
          onSaved={(topic, savedMode) => {
            if (savedMode === "edit") {
              clearEditMode();
              return;
            }
            setSelectedTopicUuid(topic.uuid);
            navigate('/');
          }}
        />
      </div>
    </Layout>
  );
}
