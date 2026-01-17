import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import Topics from '@/pages/Topics';
import Settings from '@/pages/Settings';
import { AuthDialogProvider } from '@/components/AuthDialogContext';
import { TopicGroupProvider } from '@/components/TopicGroupContext';

/**
 * NewsRadar Component Entry Point.
 * 
 * Defines the routing for the application.
 */
export function NewsRadar() {
  return (
    <AuthDialogProvider>
      <TopicGroupProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/topics" element={<Topics />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </HashRouter>
      </TopicGroupProvider>
    </AuthDialogProvider>
  );
}

export default NewsRadar;
