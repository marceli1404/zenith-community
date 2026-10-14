import { lazy, Suspense, useState, type ComponentType, type LazyExoticComponent } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AppFrame, AuthFrame, PublicFrame } from "./components/LoadingFrames";
import type { ChunkLoader } from "./lib/prefetch";
import Landing from "./pages/Landing";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Forgot from "./pages/auth/Forgot";
import Reset from "./pages/auth/Reset";
import Verify from "./pages/auth/Verify";
import NotFound from "./pages/NotFound";

type Chunk = { load: () => Promise<{ default: ComponentType }>; Lazy: LazyExoticComponent<ComponentType> };
const resolved = new Map<Chunk["load"], ComponentType>();
function chunk(load: () => Promise<{ default: ComponentType }>): Chunk {
  const tracked = () => load().then((mod) => { resolved.set(tracked, mod.default); return mod; });
  return { load: tracked, Lazy: lazy(tracked) };
}

const AppShell = chunk(() => import("./app/AppShell"));
const Legal = chunk(() => import("./pages/Legal"));
const Security = chunk(() => import("./pages/Security"));
const Methodology = chunk(() => import("./pages/Methodology"));
const Contact = chunk(() => import("./pages/Contact"));
const Status = chunk(() => import("./pages/Status"));

function publicChunk(pathname: string): [string, Chunk] | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/legal/")) return ["legal", Legal];
  if (path === "/security") return ["security", Security];
  if (path === "/methodology") return ["methodology", Methodology];
  if (path === "/contact") return ["contact", Contact];
  if (path.startsWith("/status/")) return ["status", Status];
  return null;
}

export function routeChunk(pathname: string): Promise<unknown> | null {
  return publicChunk(pathname)?.[1].load() ?? null;
}

export const appChunkLoader: ChunkLoader = (pathname) => {
  if (/^\/app(\/|$)/.test(pathname)) return { key: "app-shell", load: AppShell.load };
  const hit = publicChunk(pathname);
  return hit ? { key: hit[0], load: hit[1].load } : null;
};

function RouteView({ route }: { route: Chunk }) {
  const [Ready] = useState(() => resolved.get(route.load));
  const { pathname } = useLocation();
  if (Ready) return <Ready />;
  const Lazy = route.Lazy;
  const fallback = /^\/app(\/|$)/.test(pathname) ? <AppFrame pathname={pathname} /> : /^\/(login|signup|forgot-password|reset-password|verify-email)/.test(pathname) ? <AuthFrame /> : <PublicFrame />;
  return <Suspense fallback={fallback}><Lazy /></Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AppFrame pathname={location.pathname} />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return <>{children}</>;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route path="/forgot-password" element={<Forgot />} />
    <Route path="/reset-password" element={<Reset />} />
    <Route path="/verify-email" element={<Verify />} />
    <Route path="/legal/:doc" element={<RouteView route={Legal} />} />
    <Route path="/security" element={<RouteView route={Security} />} />
    <Route path="/methodology" element={<RouteView route={Methodology} />} />
    <Route path="/contact" element={<RouteView route={Contact} />} />
    <Route path="/status/:slug" element={<RouteView route={Status} />} />
    <Route path="/app/*" element={<RequireAuth><RouteView route={AppShell} /></RequireAuth>} />
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
