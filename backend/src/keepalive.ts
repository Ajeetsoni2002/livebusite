/**
 * Render's free plan sleeps a web service after 15 minutes without inbound
 * traffic. Pinging our own public URL goes back through Render's proxy, so it
 * counts as traffic and keeps the instance awake. RENDER_EXTERNAL_URL is set by
 * Render itself; KEEP_ALIVE_URL overrides it, and KEEP_ALIVE=false turns it off.
 */
export function keepAliveTarget(env: NodeJS.ProcessEnv = process.env) {
  if (env.KEEP_ALIVE === "false") return null;
  const base = env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL;
  if (!base || !/^https?:\/\//.test(base)) return null;
  return new URL("/api/ping", base).toString();
}

export function startKeepAlive(
  env: NodeJS.ProcessEnv = process.env,
  everyMs = 5 * 60_000,
) {
  const target = keepAliveTarget(env);
  if (!target) return () => {};
  const ping = async () => {
    try {
      const response = await fetch(target, {
        cache: "no-store",
        headers: { "User-Agent": "buit-keepalive" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        console.warn(`Keep-alive ping: HTTP ${response.status}`);
    } catch {
      console.warn("Keep-alive ping failed; retrying on the next tick.");
    }
  };
  const timer = setInterval(ping, everyMs);
  timer.unref();
  console.info(`Keep-alive: pinging ${target} every ${everyMs / 60_000} min`);
  return () => clearInterval(timer);
}
