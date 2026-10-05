import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./Layout";
import Home from "../features/catalog/Home";
import { PageAnalytics } from "../lib/analytics";
const Browse = lazy(() => import("../features/catalog/Browse")),
  Detail = lazy(() => import("../features/catalog/Detail")),
  Info = lazy(() => import("../features/Info")),
  Leaderboard = lazy(() => import("../features/community/Leaderboard"));
const Login = lazy(() =>
    import("../features/staff/Auth").then((m) => ({ default: m.Login })),
  ),
  Guard = lazy(() =>
    import("../features/staff/Auth").then((m) => ({ default: m.Guard })),
  ),
  Workspace = lazy(() => import("../features/staff/Workspace")),
  Dashboard = lazy(() => import("../features/staff/Dashboard")),
  Content = lazy(() => import("../features/staff/Content")),
  Upload = lazy(() => import("../features/staff/Upload")),
  Taxonomy = lazy(() => import("../features/staff/Taxonomy")),
  Contributors = lazy(() => import("../features/staff/Contributors")),
  Inbox = lazy(() => import("../features/staff/Inbox"));
const Analytics = lazy(() => import("../features/staff/Analytics"));
const Legacy = lazy(() => import("../features/Legacy"));
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
export default function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <PageAnalytics />
        <Suspense
          fallback={
            <main className="page" role="status">
              Opening the library…
            </main>
          }
        >
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/papers" element={<Browse />} />
              <Route path="/notes" element={<Browse kind="notes" />} />
              <Route path="/programs/:program/:branch" element={<Browse />} />
              <Route
                path="/subjects/:program/:branch/:semester/:subject"
                element={<Browse />}
              />
              <Route
                path="/papers/:program/:branch/:semester/:subject/:year/:slug"
                element={<Detail />}
              />
              <Route path="/paper/:slug" element={<Detail />} />
              <Route path="/notes/:slug" element={<Detail kind="notes" />} />
              <Route path="/contributors" element={<Leaderboard />} />
              <Route path="/papers/:filename.pdf" element={<Legacy />} />
              <Route path="/New papers/*" element={<Legacy />} />
              <Route path="/images/:filename.pdf" element={<Legacy />} />
              <Route path="/other pages 1/*" element={<Legacy />} />
              <Route path="/Portfolio_Website/*" element={<Legacy />} />
              {["about", "privacy", "copyright", "contact"].map((page) => (
                <Route
                  key={page}
                  path={`/${page}`}
                  element={<Info page={page} />}
                />
              ))}
              <Route
                path="/our-story"
                element={<Navigate to="/about" replace />}
              />
              <Route path="/story" element={<Navigate to="/about" replace />} />
              <Route path="/admin/login" element={<Login />} />
              <Route path="/contributor/login" element={<Login />} />
              <Route element={<Guard role="admin" />}>
                <Route path="/admin" element={<Workspace />}>
                  <Route index element={<Dashboard />} />
                  <Route path="papers" element={<Content />} />
                  <Route path="notes" element={<Content kind="notes" />} />
                  <Route path="upload" element={<Upload />} />
                  <Route path="moderation" element={<Content moderation />} />
                  <Route path="taxonomy" element={<Taxonomy />} />
                  <Route path="contributors" element={<Contributors />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="audit" element={<Inbox audit />} />
                  <Route path="analytics" element={<Analytics />} />
                </Route>
              </Route>
              <Route element={<Guard role="contributor" />}>
                <Route path="/contributor" element={<Workspace />}>
                  <Route index element={<Content />} />
                  <Route path="notes" element={<Content kind="notes" />} />
                  <Route path="upload" element={<Upload />} />
                </Route>
              </Route>
              <Route path="*" element={<Info page="missing" />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
