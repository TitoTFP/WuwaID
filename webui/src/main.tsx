import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./lib/useAuth";
import "./index.css";

const ReaderView = lazy(() =>
	import("./routes/ReaderView").then(({ ReaderView }) => ({
		default: ReaderView,
	})),
);
const WorkbenchView = lazy(() =>
	import("./routes/WorkbenchView").then(({ WorkbenchView }) => ({
		default: WorkbenchView,
	})),
);
const OpsView = lazy(() =>
	import("./routes/OpsView").then(({ OpsView }) => ({ default: OpsView })),
);
const DatabaseView = lazy(() =>
	import("./routes/DatabaseView").then(({ DatabaseView }) => ({
		default: DatabaseView,
	})),
);
const DraftsReviewHub = lazy(() =>
	import("./routes/DraftsReviewHub").then(({ DraftsReviewHub }) => ({
		default: DraftsReviewHub,
	})),
);
const VersionsHistory = lazy(() =>
	import("./routes/VersionsHistory").then(({ VersionsHistory }) => ({
		default: VersionsHistory,
	})),
);
const CategoryView = lazy(() =>
	import("./routes/CategoryView").then(({ CategoryView }) => ({
		default: CategoryView,
	})),
);
const CategoriesView = lazy(() =>
	import("./routes/CategoriesView").then(({ CategoriesView }) => ({
		default: CategoriesView,
	})),
);
const TranslationQAView = lazy(() =>
	import("./routes/TranslationQAView").then(({ TranslationQAView }) => ({
		default: TranslationQAView,
	})),
);

const RouteLoading = () => (
	<div className="flex h-full items-center justify-center font-mono text-xs text-slate-400">
		Memuat modul WebUI...
	</div>
);

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
			<AuthProvider>
				<BrowserRouter>
					<Layout role="editor">
						<Suspense fallback={<RouteLoading />}>
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
								<Route path="/workbench/quest/:questId" element={<WorkbenchView />} />
								<Route path="/workbench/category/*" element={<WorkbenchView />} />
								<Route path="/workbench/drafts" element={<DraftsReviewHub />} />
								<Route path="/workbench/versions" element={<VersionsHistory />} />
								<Route path="/qa" element={<TranslationQAView />} />
								<Route path="/translation-qa" element={<TranslationQAView />} />
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
						</Suspense>
					</Layout>
				</BrowserRouter>
			</AuthProvider>
		</QueryClientProvider>
	</React.StrictMode>,
);
