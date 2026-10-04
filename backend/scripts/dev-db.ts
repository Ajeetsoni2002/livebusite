import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import net from "node:net";
const base = resolve(
  process.cwd(),
  process.cwd().endsWith("backend") ? ".." : ".",
);
const dbPath = resolve(base, ".npm-cache/dev-mongodb");
await mkdir(dbPath, { recursive: true });
const port = Number(process.env.DEV_DB_PORT || 27018);
// Never send replica-set initialization commands to a database already on this port.
await new Promise<void>((ready, reject) => {
  const probe = net.createServer();
  probe.once("error", () =>
    reject(
      new Error(
        `Port ${port} is already in use. Choose DEV_DB_PORT or use your existing MongoDB URI.`,
      ),
    ),
  );
  probe.listen(port, "127.0.0.1", () => probe.close(() => ready()));
});
const db = await MongoMemoryReplSet.create({
  binary: {
    downloadDir: resolve(base, "node_modules/.cache/mongodb-memory-server"),
  },
  instanceOpts: [{ port, dbPath }],
  replSet: { count: 1, dbName: "buit_papers", storageEngine: "wiredTiger" },
});
console.info(
  `Local development MongoDB replica set is ready at mongodb://127.0.0.1:${port}/buit_papers?replicaSet=testset`,
);
console.info(
  "Development data lives in .npm-cache/dev-mongodb. Do not use this helper in production.",
);
async function stop() {
  await db.stop({ doCleanup: false, force: false });
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
