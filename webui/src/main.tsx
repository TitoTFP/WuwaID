import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ReaderView } from './routes/ReaderView';
import { WorkbenchView } from './routes/WorkbenchView';
import { OpsView } from './routes/OpsView';
import { DraftsReviewHub } from './routes/DraftsReviewHub';
import { VersionsHistory } from './routes/VersionsHistory';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout role="editor">
          <Routes>
            <Route path="/" element={<ReaderView />} />
            <Route path="/workbench" element={<WorkbenchView />} />
            <Route path="/drafts" element={<DraftsReviewHub />} />
            <Route path="/versions" element={<VersionsHistory />} />
            <Route path="/operations" element={<OpsView />} />
            <Route path="*" element={<ReaderView />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
