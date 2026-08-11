"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createUpdater,
  validateManifest,
} = require("../src/updater");
const {
  assertUpdateAllowed,
  resolveUpdateRequirement,
} = require("../src/update-policy");

const manifest = (overrides = {}) => ({
  version: "1.3.1",
  file: "Match-Session-Overlay-1.3.1-Setup.exe",
  sha256: "A".repeat(64),
  force: false,
  minimumVersion: null,
  installerUrl:
    "https://github.com/mickangumi-oss/match-session-overlay/releases/download/v1.3.1/Match-Session-Overlay-1.3.1-Setup.exe",
  source: "github",
  ...overrides,
});

function fakeApp(version = "1.3.0") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mso-force-update-test-"));
  return {
    adapter: {
      getVersion: () => version,
      getPath: () => directory,
      isPackaged: false,
      quit: () => assert.fail("development QA must not quit the app"),
    },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test("force update manifest validation is strict", () => {
  const valid = validateManifest(manifest({ force: true, minimumVersion: "1.3.0" }));
  assert.equal(valid.force, true);
  assert.equal(valid.minimumVersion, "1.3.0");
  assert.throws(() => validateManifest(manifest({ force: "true" })), /UPDATE_MANIFEST_INVALID/);
  assert.throws(() => validateManifest(manifest({ minimumVersion: "1.4.0" })), /UPDATE_MANIFEST_INVALID/);
  assert.throws(() => validateManifest(manifest({ file: "../update.exe" })), /UPDATE_MANIFEST_INVALID/);
  assert.throws(() => validateManifest(manifest({ sha256: "invalid" })), /UPDATE_MANIFEST_INVALID/);
});

test("force flag and minimum version both enter required state", async (t) => {
  for (const remote of [
    manifest({ force: true }),
    manifest({ version: "1.3.1", minimumVersion: "1.3.1" }),
  ]) {
    const fixture = fakeApp();
    t.after(fixture.cleanup);
    let fetchCount = 0;
    const updater = createUpdater({
      appAdapter: fixture.adapter,
      onState: () => {},
      fetchManifest: async () => {
        fetchCount += 1;
        return remote;
      },
    });
    const state = await updater.check();
    assert.equal(state.status, "ready");
    assert.equal(state.required, true);
    assert.equal(fetchCount, 1);
    await assert.rejects(updater.install(), /UPDATE_INSTALL_DEVELOPMENT/);
  }
});

test("optional update remains optional", async (t) => {
  const fixture = fakeApp();
  t.after(fixture.cleanup);
  const updater = createUpdater({
    appAdapter: fixture.adapter,
    onState: () => {},
    fetchManifest: async () => manifest(),
  });
  const state = await updater.check();
  assert.equal(state.status, "ready");
  assert.equal(state.required, false);
});

test("force does not install the same or an older release", async (t) => {
  for (const remote of [manifest({ version: "1.3.0", force: true }), manifest({ version: "1.2.9", force: true })]) {
    const fixture = fakeApp();
    t.after(fixture.cleanup);
    const updater = createUpdater({
      appAdapter: fixture.adapter,
      onState: () => {},
      fetchManifest: async () => remote,
    });
    const state = await updater.check();
    assert.equal(state.status, "current");
    assert.equal(state.required, false);
  }
});

test("required lock survives checking and network errors", async (t) => {
  const fixture = fakeApp();
  t.after(fixture.cleanup);
  const states = [];
  let attempt = 0;
  const updater = createUpdater({
    appAdapter: fixture.adapter,
    onState: (state) => states.push({ ...state }),
    fetchManifest: async () => {
      attempt += 1;
      if (attempt === 1) return manifest({ force: true });
      throw new Error("SYNTHETIC_NETWORK_FAILURE");
    },
  });
  await updater.check();
  // The production cache prevents needless requests; cancel creates a fresh
  // updater instance to exercise the next process-level check failure state.
  const retry = createUpdater({
    appAdapter: fixture.adapter,
    onState: (state) => states.push({ ...state }),
    fetchManifest: async () => { throw new Error("SYNTHETIC_NETWORK_FAILURE"); },
  });
  const policyReady = resolveUpdateRequirement(false, { status: "ready", required: true });
  const policyChecking = resolveUpdateRequirement(policyReady.required, { status: "checking", required: false });
  const policyError = resolveUpdateRequirement(policyChecking.required, await retry.check());
  assert.equal(policyChecking.required, true);
  assert.equal(policyError.required, true);
  assert.equal(policyError.becameRequired, false);
});

test("required policy blocks normal IPC work but permits update IPC", () => {
  assert.throws(() => assertUpdateAllowed(true), /UPDATE_REQUIRED/);
  assert.doesNotThrow(() => assertUpdateAllowed(true, true));
  assert.equal(resolveUpdateRequirement(false, { status: "ready", required: true }).becameRequired, true);
  assert.equal(resolveUpdateRequirement(true, { status: "ready", required: true }).becameRequired, false);
  assert.equal(resolveUpdateRequirement(true, { status: "current", required: false }).required, true);
});

test("installer launch is confirmed before the app quits", async (t) => {
  const fixture = fakeApp();
  t.after(fixture.cleanup);
  const events = [];
  fixture.adapter.isPackaged = true;
  fixture.adapter.quit = () => events.push("quit");
  const child = new EventEmitter();
  child.unref = () => events.push("unref");
  const updater = createUpdater({
    appAdapter: fixture.adapter,
    onState: () => {},
    fetchManifest: async () => manifest({ force: true }),
    downloadFile: async (_url, filePath, onProgress) => {
      events.push("download");
      fs.writeFileSync(filePath, "SYNTHETIC INSTALLER");
      onProgress(100);
    },
    hashFile: async () => {
      events.push("hash");
      return "A".repeat(64);
    },
    spawnInstaller: () => {
      events.push("spawn-request");
      process.nextTick(() => {
        events.push("spawn-confirmed");
        child.emit("spawn");
      });
      return child;
    },
  });
  await updater.check();
  await updater.install();
  assert.deepEqual(events, ["download", "hash", "spawn-request", "spawn-confirmed", "unref", "quit"]);
});

test("installer launch failure keeps the required retry path and does not quit", async (t) => {
  const fixture = fakeApp();
  t.after(fixture.cleanup);
  let quitCalled = false;
  fixture.adapter.isPackaged = true;
  fixture.adapter.quit = () => { quitCalled = true; };
  const child = new EventEmitter();
  child.unref = () => assert.fail("failed child must not be detached");
  const updater = createUpdater({
    appAdapter: fixture.adapter,
    onState: () => {},
    fetchManifest: async () => manifest({ force: true }),
    downloadFile: async (_url, filePath) => fs.writeFileSync(filePath, "SYNTHETIC INSTALLER"),
    hashFile: async () => "A".repeat(64),
    spawnInstaller: () => {
      process.nextTick(() => child.emit("error", new Error("SYNTHETIC_SPAWN_FAILURE")));
      return child;
    },
  });
  await updater.check();
  await assert.rejects(updater.install(), /SYNTHETIC_SPAWN_FAILURE/);
  assert.equal(quitCalled, false);
  assert.equal(updater.getState().status, "error");
  assert.equal(updater.getState().required, true);
  assert.equal(updater.getState().messageKey, "updateLaunchError");
});

test("main process force transition stops background work and keeps update IPC available", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const transition = source.match(/if \(becameRequired\) \{([\s\S]*?)\n      \}/)?.[1] ?? "";
  for (const call of [
    "stopTracking()",
    "stopHistoryViewPolling(\"update\")",
    "stopSocialRefresh()",
    "controller.abort()",
    "dismissFriendNotification({ destroy: false })",
    "clearInterval(gameMonitorTimer)",
  ]) assert.match(transition, new RegExp(call.replace(/[(){}]/g, "\\$&")));
  for (const channel of ["update:check", "update:state", "update:install"]) {
    assert.match(source, new RegExp(`"${channel}"[\\s\\S]{0,180}allowDuringUpdate: true`));
  }
});
