"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDebouncedAtomicWriter } = require("../src/debounced-atomic-writer");

async function withTempDir(callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "match-overlay-writer-"));
  try { await callback(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("coalesces a target to its latest payload and flush writes it", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "history.json");
    const writer = createDebouncedAtomicWriter({ delayMs: 500 });
    const first = writer.schedule(target, "old");
    const second = writer.schedule(target, "new");
    await writer.flush(target);
    await Promise.all([first, second]);
    assert.equal(await fs.readFile(target, "utf8"), "new");
    assert.equal((await fs.readdir(dir)).some((name) => name.endsWith(".tmp")), false);
  });
});

test("flushAll persists independent target files", async () => {
  await withTempDir(async (dir) => {
    const writer = createDebouncedAtomicWriter({ delayMs: 500 });
    writer.schedule(path.join(dir, "history.json"), "history");
    writer.schedule(path.join(dir, "session.json"), "session");
    await writer.flushAll();
    assert.equal(await fs.readFile(path.join(dir, "history.json"), "utf8"), "history");
    assert.equal(await fs.readFile(path.join(dir, "session.json"), "utf8"), "session");
  });
});

test("failed temp write preserves the existing formal file", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "history.json");
    await fs.writeFile(target, "known-good", "utf8");
    const failingFs = { ...fs, writeFile: async () => { throw new Error("disk full"); } };
    const writer = createDebouncedAtomicWriter({ delayMs: 0, fs: failingFs });
    await assert.rejects(writer.schedule(target, "new"), /disk full/);
    await assert.rejects(writer.flush(target), /disk full/);
    assert.equal(await fs.readFile(target, "utf8"), "known-good");
  });
});

test("a newer pending payload is written after an older in-flight payload", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "history.json");
    let releaseFirstWrite;
    const firstWriteStarted = new Promise((resolve) => { releaseFirstWrite = resolve; });
    let writes = 0;
    const renamedPayloads = [];
    const delayedFs = {
      ...fs,
      writeFile: async (file, payload, encoding) => {
        writes += 1;
        if (writes === 1) await firstWriteStarted;
        return fs.writeFile(file, payload, encoding);
      },
      rename: async (from, to) => {
        renamedPayloads.push(await fs.readFile(from, "utf8"));
        return fs.rename(from, to);
      },
    };
    const writer = createDebouncedAtomicWriter({ delayMs: 0, fs: delayedFs });
    const first = writer.schedule(target, "old");
    await new Promise((resolve) => setImmediate(resolve));
    const second = writer.schedule(target, "new");
    releaseFirstWrite();
    await writer.flush(target);
    await Promise.all([first, second]);
    assert.equal(await fs.readFile(target, "utf8"), "new");
    assert.deepEqual(renamedPayloads, ["new"]);
  });
});

test("cancel waits for an in-flight write and prevents a later stale write after deletion", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "history.json");
    let releaseWrite;
    const writeStarted = new Promise((resolve) => { releaseWrite = resolve; });
    const delayedFs = {
      ...fs,
      writeFile: async (file, payload, encoding) => {
        await writeStarted;
        return fs.writeFile(file, payload, encoding);
      },
    };
    const writer = createDebouncedAtomicWriter({ delayMs: 0, fs: delayedFs });
    const completion = writer.schedule(target, "stale");
    await new Promise((resolve) => setImmediate(resolve));
    const cancelling = writer.cancel(target);
    releaseWrite();
    await cancelling;
    await assert.rejects(completion, { name: "AbortError" });
    await fs.rm(target, { force: true });
    assert.equal(await fs.access(target).then(() => true, () => false), false);
  });
});

test("cancelAll cancels every debounced payload before it starts", async () => {
  await withTempDir(async (dir) => {
    const writer = createDebouncedAtomicWriter({ delayMs: 500 });
    const first = writer.schedule(path.join(dir, "history.json"), "history");
    const second = writer.schedule(path.join(dir, "session.json"), "session");
    await writer.cancelAll();
    await assert.rejects(first, { name: "AbortError" });
    await assert.rejects(second, { name: "AbortError" });
    assert.equal((await fs.readdir(dir)).length, 0);
  });
});

test("a queued removal supersedes an older pending write", async () => {
  await withTempDir(async (dir) => {
    const target = path.join(dir, "session.json");
    await fs.writeFile(target, "old", "utf8");
    const writer = createDebouncedAtomicWriter({ delayMs: 500 });
    const write = writer.schedule(target, "stale");
    const removal = writer.remove(target);
    await writer.flush(target);
    await Promise.all([write, removal]);
    assert.equal(await fs.access(target).then(() => true, () => false), false);
  });
});
