const base = (process.env.API_URL || "http://127.0.0.1:4000").replace(
  /\/$/,
  "",
);
const checks = [
  ["/api/ping", 200],
  ["/api/health", 200],
  ["/api/branches", 200],
  ["/api/papers?limit=1", 200],
  ["/api/notes?limit=1", 200],
  ["/api/admin/dashboard", 401],
  ["/api/contributor/uploads", 401],
  ["/api/papers?limit=1000", 400],
];
let failures = 0;
for (const [path, expected] of checks) {
  try {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(90_000),
    });
    if (response.status !== expected)
      throw new Error(`expected ${expected}, received ${response.status}`);
    console.log(`PASS ${path}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${path}: ${error.message}`);
  }
}
process.exitCode = failures ? 1 : 0;
