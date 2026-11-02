import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { api } from "./api";

/*
 * Lets public pages show a "back to your workspace" button to signed-in staff.
 * A local hint (set once the workspace opens, cleared on sign-out) means ordinary
 * visitors never trigger a /auth/me request; the server still decides who is signed in.
 */
const KEY = "buit-workspace";
const EVENT = "buit-workspace-change";
type Role = "admin" | "contributor";

export function rememberWorkspace(role: Role | null) {
  try {
    if (role) localStorage.setItem(KEY, role);
    else localStorage.removeItem(KEY);
  } catch {
    /* Storage can be unavailable (private mode); the button is a convenience only. */
  }
  window.dispatchEvent(new Event(EVENT));
}

function readHint() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "admin" || value === "contributor" ? value : null;
  } catch {
    return null;
  }
}

/** The signed-in staff member's role, or null for visitors. */
export function useWorkspaceRole(): Role | null {
  const [hint, setHint] = useState(readHint);
  useEffect(() => {
    const update = () => setHint(readHint());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () =>
      (await api.get("/auth/me")).data.data as { role: Role },
    enabled: !!hint,
    retry: false,
    staleTime: 5 * 60_000,
  });
  // Only a refused session clears the hint; a sleeping or unreachable API does not.
  const status = isAxiosError(me.error) ? me.error.response?.status : 0;
  useEffect(() => {
    if (status === 401 || status === 403) rememberWorkspace(null);
  }, [status]);
  return hint && me.data ? me.data.role : null;
}
