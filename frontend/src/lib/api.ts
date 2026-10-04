import { readSnapshot } from "./snapshot";
import axios from "axios";
import type { Envelope } from "./types";
import { resolveApiUrl } from "./urls";
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
  timeout: 18_000,
});
export const errorMessage = (error: unknown) =>
  axios.isAxiosError(error)
    ? error.response?.data?.error?.message ||
      "We could not reach the library. Please try again."
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
let csrf: string | undefined, refresh: Promise<unknown> | undefined;
export async function csrfToken() {
  if (!csrf) csrf = (await api.get("/auth/csrf")).data.data.token;
  return csrf!;
}
api.interceptors.request.use(async (request) => {
  if (
    !["get", "head", "options"].includes(request.method || "get") &&
    !request.url?.includes("/analytics") &&
    !request.url?.endsWith("/download")
  )
    request.headers.set("X-CSRF-Token", await csrfToken());
  return request;
});
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config;
    if (
      error.response?.status === 401 &&
      !request?._refreshed &&
      !/^\/auth\/(?:login|refresh|logout|csrf)$/.test(request?.url || "")
    ) {
      request._refreshed = true;
      try {
        refresh ||= api.post("/auth/refresh", {});
        await refresh;
        return await api(request);
      } catch {
        throw error;
      } finally {
        refresh = undefined;
      }
    }
    if (error.response?.data?.error?.code === "CSRF_REQUIRED") csrf = undefined;
    throw error;
  },
);
export function apiUrl(path: string) {
  return resolveApiUrl(path, api.defaults.baseURL || "/api");
}
let snapshot: Promise<Record<string, any>>;
async function savedSnapshot() {
  snapshot ||= fetch("/snapshot.json").then((r) => {
    if (!r.ok) throw new Error("Saved library unavailable");
    return r.json();
  });
  return snapshot;
}
export async function publicRead<T>(
  path: string,
  params: Record<string, unknown> = {},
): Promise<Envelope<T>> {
  try {
    return (await api.get(path, { params })).data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      error.response.status < 500 &&
      error.response.status !== 429
    )
      throw error;
    const saved = await savedSnapshot();
    try {
      return readSnapshot<T>(saved, path, params);
    } catch {
      throw error;
    }
  }
}
