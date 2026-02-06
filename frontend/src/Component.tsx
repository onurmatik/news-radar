import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import Topics from '@/pages/Topics';
import ContentFullDetail from '@/pages/ContentFullDetail';
import UpgradeToPro from '@/pages/UpgradeToPro';
import ApiAccess from '@/pages/ApiAccess';
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
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/topics" element={<Topics />} />
              <Route path="/upgrade" element={<UpgradeToPro />} />
              <Route path="/api-access" element={<ApiAccess />} />
              <Route path="/content/:contentId/full" element={<ContentFullDetail />} />
            </Routes>
          </BrowserRouter>
        </TopicsProvider>
      </TopicGroupProvider>
    </AuthDialogProvider>
  );
}

export default NewsRadar;
