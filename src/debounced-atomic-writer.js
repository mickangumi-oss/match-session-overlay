"use strict";

const fsPromises = require("node:fs/promises");
const path = require("node:path");

function abortError(targetPath) {
  const error = new Error(`Pending write was cancelled: ${targetPath}`);
  error.name = "AbortError";
  return error;
}

/**
 * Coalesces writes per target file and replaces each target atomically.
 *
 * `cancel()` and `cancelAll()` return promises.  Code which deletes persisted
 * data must await them before deleting files, so an already-started write has
 * finished (or discarded its temporary file) before the deletion begins.
 */
function createDebouncedAtomicWriter({
  delayMs = 350,
  fs = fsPromises,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("delayMs must be a non-negative number");

  const entries = new Map();
  let tempSequence = 0;

  function getEntry(targetPath) {
    let entry = entries.get(targetPath);
    if (!entry) {
      entry = {
        targetPath,
        timer: null,
        pending: null,
        inFlight: null,
        version: 0,
        cancelledVersion: 0,
        subscribers: [],
        lastError: null,
        lastErrorVersion: 0,
      };
      entries.set(targetPath, entry);
    }
    return entry;
  }

  function settleThrough(entry, version, error) {
    const remaining = [];
    for (const subscriber of entry.subscribers) {
      if (subscriber.version <= version) {
        if (error) subscriber.reject(error);
        else subscriber.resolve();
      } else {
        remaining.push(subscriber);
      }
    }
    entry.subscribers = remaining;
  }

  async function persist(entry, job) {
    const targetDir = path.dirname(entry.targetPath);
    const targetName = path.basename(entry.targetPath);
    const tempPath = path.join(targetDir, `.${targetName}.${process.pid}.${++tempSequence}.tmp`);
    let tempExists = false;
    try {
      if (entry.cancelledVersion >= job.version) return;
      if (job.remove) {
        if (entry.version !== job.version) return;
        await fs.rm(entry.targetPath, { force: true });
        entry.lastError = null;
        entry.lastErrorVersion = 0;
        settleThrough(entry, job.version, null);
        return;
      }
      await fs.writeFile(tempPath, job.payload, "utf8");
      tempExists = true;
      // Never let an old completion replace a newer desired state.  A newer
      // payload will be written when its own debounce window elapses.
      if (entry.cancelledVersion >= job.version || entry.version !== job.version) return;
      await fs.rename(tempPath, entry.targetPath);
      tempExists = false;
      entry.lastError = null;
      entry.lastErrorVersion = 0;
      settleThrough(entry, job.version, null);
    } catch (error) {
      // The target is never removed or truncated: failures only affect the
      // unique temporary file, leaving a previously valid target intact.
      entry.lastError = error;
      entry.lastErrorVersion = job.version;
      settleThrough(entry, job.version, error);
    } finally {
      if (tempExists) {
        try { await fs.unlink(tempPath); } catch { /* best-effort cleanup */ }
      }
    }
  }

  function start(entry) {
    if (entry.inFlight || !entry.pending) return;
    const job = entry.pending;
    entry.pending = null;
    entry.inFlight = persist(entry, job).finally(() => {
      entry.inFlight = null;
      if (entry.pending && entry.timer == null) start(entry);
    });
  }

  function arm(entry, delay) {
    if (entry.timer != null) clearTimer(entry.timer);
    entry.timer = setTimer(() => {
      entry.timer = null;
      start(entry);
    }, delay);
  }

  function schedule(targetPath, payload) {
    if (typeof targetPath !== "string" || !targetPath) throw new TypeError("targetPath must be a non-empty string");
    const entry = getEntry(targetPath);
    const version = ++entry.version;
    entry.pending = { version, payload };
    const completion = new Promise((resolve, reject) => entry.subscribers.push({ version, resolve, reject }));
    arm(entry, delayMs);
    return completion;
  }

  function remove(targetPath) {
    if (typeof targetPath !== "string" || !targetPath) throw new TypeError("targetPath must be a non-empty string");
    const entry = getEntry(targetPath);
    const version = ++entry.version;
    entry.pending = { version, remove: true };
    const completion = new Promise((resolve, reject) => entry.subscribers.push({ version, resolve, reject }));
    arm(entry, delayMs);
    return completion;
  }

  async function flush(targetPath) {
    const entry = entries.get(targetPath);
    if (!entry) return;
    if (entry.timer != null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    while (entry.inFlight || entry.pending) {
      start(entry);
      if (entry.inFlight) await entry.inFlight;
    }
    if (entry.lastError && entry.lastErrorVersion === entry.version) throw entry.lastError;
  }

  async function flushAll() {
    await Promise.all([...entries.keys()].map((targetPath) => flush(targetPath)));
  }

  async function cancel(targetPath) {
    const entry = entries.get(targetPath);
    if (!entry) return;
    if (entry.timer != null) clearTimer(entry.timer);
    entry.timer = null;
    entry.pending = null;
    entry.cancelledVersion = entry.version;
    settleThrough(entry, entry.version, abortError(targetPath));
    if (entry.inFlight) await entry.inFlight;
  }

  async function cancelAll() {
    await Promise.all([...entries.keys()].map((targetPath) => cancel(targetPath)));
  }

  return {
    schedule,
    remove,
    flush,
    flushAll,
    cancel,
    cancelAll,
    size: () => entries.size,
  };
}

module.exports = { createDebouncedAtomicWriter };
