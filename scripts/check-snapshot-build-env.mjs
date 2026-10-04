try {
  const api = new URL(process.env.VITE_API_BASE_URL || "");
  const site = new URL(process.env.VITE_SITE_URL || "");
  if (
    api.protocol !== "https:" ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    !api.pathname.endsWith("/api") ||
    site.protocol !== "https:" ||
    site.origin !== process.env.VITE_SITE_URL ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.VITE_CONTACT_EMAIL || "")
  )
    throw new Error();
} catch {
  console.error(
    "Configure HTTPS VITE_API_BASE_URL, canonical VITE_SITE_URL and VITE_CONTACT_EMAIL repository variables before building a production snapshot.",
  );
  process.exitCode = 1;
}
