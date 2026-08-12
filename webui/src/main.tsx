import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { ReaderView } from "./routes/ReaderView";
import { WorkbenchView } from "./routes/WorkbenchView";
import { OpsView } from "./routes/OpsView";
import { DatabaseView } from "./routes/DatabaseView";
import { DraftsReviewHub } from "./routes/DraftsReviewHub";
import { VersionsHistory } from "./routes/VersionsHistory";
import { CategoryView } from "./routes/CategoryView";
import { CategoriesView } from "./routes/CategoriesView";
import "./index.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<Layout role="editor">
					<Routes>
						{/* 1. Reader Tab Routes */}
						<Route path="/" element={<Navigate to="/reader" replace />} />
						<Route path="/reader" element={<ReaderView />} />
						<Route path="/reader/categories" element={<CategoriesView />} />
						<Route path="/reader/chapter/:chapterId" element={<ReaderView />} />
						<Route path="/reader/quest/:questId" element={<ReaderView />} />
						<Route path="/reader/category/*" element={<CategoryView />} />
						<Route path="/categories" element={<CategoriesView />} />
						<Route path="/categories/*" element={<CategoryView />} />
						<Route path="/chapter/:chapterId" element={<ReaderView />} />
						<Route path="/quest/:questId" element={<ReaderView />} />

						{/* 2. Workbench Tab Routes */}
						<Route path="/workbench" element={<WorkbenchView />} />
						<Route path="/workbench/drafts" element={<DraftsReviewHub />} />
						<Route path="/workbench/versions" element={<VersionsHistory />} />
						<Route path="/drafts" element={<DraftsReviewHub />} />
						<Route path="/versions" element={<VersionsHistory />} />

						{/* 3. Operations Tab Routes */}
						<Route path="/operations" element={<OpsView />} />
						<Route path="/ops" element={<OpsView />} />

						{/* 4. Database Import/Export Tab Routes */}
						<Route path="/databases" element={<DatabaseView />} />
						<Route path="/configdb" element={<DatabaseView />} />

						{/* Fallback Route */}
						<Route path="*" element={<Navigate to="/reader" replace />} />
					</Routes>
				</Layout>
			</BrowserRouter>
		</QueryClientProvider>
	</React.StrictMode>,
);
