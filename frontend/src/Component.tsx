import { HashRouter, Routes, Route } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import Topics from "@/pages/Topics";
import Settings from "@/pages/Settings";

export function NewsRadar() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/topics" element={<Topics />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </HashRouter>
  );
}

export default NewsRadar;
