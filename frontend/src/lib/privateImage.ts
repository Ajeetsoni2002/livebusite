import { useEffect, useState } from "react";
import { api } from "./api";

/*
 * Private images (a contributor's payment QR) sit behind the API's session cookie, so
 * an <img src> cannot load them directly: fetch the bytes and hand back an object URL.
 */
export function usePrivateImage(path: string | null) {
  const [state, setState] = useState<{
    url: string | null;
    loading: boolean;
    error: string;
  }>({ url: null, loading: Boolean(path), error: "" });
  useEffect(() => {
    if (!path) {
      setState({ url: null, loading: false, error: "" });
      return;
    }
    let url: string | undefined,
      cancelled = false;
    setState({ url: null, loading: true, error: "" });
    api
      .get(path, { responseType: "blob" })
      .then((response) => {
        if (cancelled) return;
        url = URL.createObjectURL(response.data as Blob);
        setState({ url, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            url: null,
            loading: false,
            error: "The QR code could not be loaded.",
          });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return state;
}
