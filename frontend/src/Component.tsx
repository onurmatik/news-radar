import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import Topics from '@/pages/Topics';
import { AuthDialogProvider } from '@/components/AuthDialogContext';
import { TopicGroupProvider } from '@/components/TopicGroupContext';
import { TopicsProvider } from '@/components/TopicsContext';

/**
 * NewsRadar Component Entry Point.
 * 
 * Defines the routing for the application.
 */
export function NewsRadar() {
  return (
    <AuthDialogProvider>
      <TopicGroupProvider>
        <TopicsProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/topics" element={<Topics />} />
            </Routes>
          </HashRouter>
        </TopicsProvider>
      </TopicGroupProvider>
    </AuthDialogProvider>
  );
}

export default NewsRadar;
