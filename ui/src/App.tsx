import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isLoggedIn } from './api/client';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DraftsPage } from './pages/DraftsPage';
import { GraphPage } from './pages/GraphPage';
import { LoginPage } from './pages/LoginPage';
import { ProjectPage } from './pages/ProjectPage';
import { SearchPage } from './pages/SearchPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="projects/:slug" element={<ProjectPage />} />
          <Route path="projects/:slug/drafts" element={<DraftsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="graph" element={<GraphPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
