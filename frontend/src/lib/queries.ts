import { useQuery } from "@tanstack/react-query";
import { publicRead } from "./api";
import { useRef } from "react";
export function usePublic<T>(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  const retryState = useRef({ key: "", attempts: 0 }),
    key = JSON.stringify([path, params]);
  if (retryState.current.key !== key) retryState.current = { key, attempts: 0 };
  return useQuery({
    queryKey: [path, params],
    queryFn: async () => {
      const result = await publicRead<T>(path, params);
      retryState.current.attempts = result.saved
        ? retryState.current.attempts + 1
        : 0;
      return result;
    },
    enabled,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchInterval: (query) =>
      query.state.data?.saved && retryState.current.attempts < 5
        ? Math.min(
            2000 * 2 ** Math.max(0, retryState.current.attempts - 1),
            30000,
          )
        : false,
  });
}
