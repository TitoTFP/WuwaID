import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./routes/HomePage";
import ChapterPage from "./routes/ChapterPage";
import SideQuestsPage from "./routes/SideQuestsPage";
import QuestPage from "./routes/QuestPage";
import SearchPage from "./routes/SearchPage";
import EditorPage from "./routes/EditorPage";
import DraftsPage from "./routes/DraftsPage";
import LoginPage from "./routes/LoginPage";
import CategoriesPage from "./routes/CategoriesPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/chapters/:chapterId" element={<ChapterPage />} />
        <Route path="/side-quests" element={<SideQuestsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/quests/:qid" element={<QuestPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/editor/:qid" element={<EditorPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/drafts/:draftId" element={<DraftsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
