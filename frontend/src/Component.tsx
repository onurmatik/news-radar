import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import Keywords from '@/pages/Keywords';
import Settings from '@/pages/Settings';

export function NewsRadar() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/keywords" element={<Keywords />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </HashRouter>
  );
}

export default NewsRadar;
