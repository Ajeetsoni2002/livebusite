import { resolve, sep, dirname } from "node:path";
import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
export class LocalStorage {
  constructor(private root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const target = resolve(this.root, key);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/.test(key) ||
      !target.startsWith(this.root + sep) ||
      key.split("/").includes("..")
    )
      throw new Error("Invalid storage key");
    return target;
  }
  async put(key: string, bytes: Buffer, _mime: string) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async head(key: string) {
    return { size: (await stat(this.path(key))).size };
  }
  async get(key: string, range?: { start: number; end: number }) {
    const total = (await this.head(key)).size;
    return {
      body: createReadStream(this.path(key), range),
      size: range ? range.end - range.start + 1 : total,
      total,
    };
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  async readUrl(_key: string, _filename: string, _attachment: boolean) {
    return null;
  }
}
