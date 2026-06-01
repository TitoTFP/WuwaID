import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./routes/HomePage";
import ChapterPage from "./routes/ChapterPage";
import SideQuestsPage from "./routes/SideQuestsPage";
import QuestPage from "./routes/QuestPage";
import SearchPage from "./routes/SearchPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/chapters/:chapterId" element={<ChapterPage />} />
        <Route path="/side-quests" element={<SideQuestsPage />} />
        <Route path="/quests/:qid" element={<QuestPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
