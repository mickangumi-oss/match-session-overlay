"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { URL } = require("node:url");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const { retryAfterMilliseconds } = require("./poll-policy");
const { validateSignedManifest } = require("./update-signature");

// The release manifest is a static GitHub Release asset.  The application
// never sends credentials, cookies, or player data to GitHub.
const MANIFEST_NAME = "local-update.json";
const REMOTE_MANIFEST_URL =
  "https://github.com/mickangumi-oss/match-session-overlay/releases/latest/download/local-update.json";
const REMOTE_RELEASE_BASE_URL =
  "https://github.com/mickangumi-oss/match-session-overlay/releases/download/";
const REMOTE_ALLOWED_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 250 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_UPDATE_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

function compareVersions(left, right) {
  const parse = (value) =>
    String(value)
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function validateRemoteUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("UPDATE_URL_INVALID");
  }
  if (url.protocol !== "https:" || !REMOTE_ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error("UPDATE_REDIRECT_BLOCKED");
  }
  return url;
}

function requestBuffer(rawUrl, { maxBytes, onProgress, signal } = {}, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error("UPDATE_TOO_MANY_REDIRECTS"));
  const byteLimit = Number.isFinite(maxBytes) ? maxBytes : MAX_MANIFEST_BYTES;
  const url = validateRemoteUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        signal,
        headers: {
          Accept: "application/octet-stream, application/json",
          "User-Agent": `Match-Session-Overlay/${app.getVersion()}`,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          requestBuffer(nextUrl, { maxBytes, onProgress, signal }, redirectCount + 1)
            .then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          const error = new Error(`UPDATE_HTTP_${status}`);
          if (status === 429) {
            error.retryAfterMs = retryAfterMilliseconds(
              response.headers["retry-after"],
              Date.now(),
              MAX_UPDATE_RETRY_DELAY_MS,
            );
          }
          reject(error);
          return;
        }
        const total = Number.parseInt(response.headers["content-length"] ?? "", 10);
        if (Number.isFinite(total) && total > byteLimit) {
          response.resume();
          reject(new Error("UPDATE_FILE_TOO_LARGE"));
          return;
        }
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > byteLimit) {
            response.destroy(new Error("UPDATE_FILE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
          if (typeof onProgress === "function") {
            onProgress(total > 0 ? Math.min(100, (received / total) * 100) : 0);
          }
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("UPDATE_TIMEOUT"));
    });
    request.on("error", reject);
  });
}

function downloadToFile(
  rawUrl,
  destinationPath,
  onProgress,
  redirectCount = 0,
  signal = null,
) {
  if (redirectCount > 5) return Promise.reject(new Error("UPDATE_TOO_MANY_REDIRECTS"));
  const url = validateRemoteUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationPath, { flags: "wx" });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      try { fs.rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
      reject(error);
    };
    output.on("error", fail);
    const request = https.get(
      url,
      {
        signal,
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": `Match-Session-Overlay/${app.getVersion()}`,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          output.close(() => {
            try { fs.rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
            downloadToFile(nextUrl, destinationPath, onProgress, redirectCount + 1, signal)
              .then(resolve, reject);
          });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          fail(new Error(`UPDATE_HTTP_${status}`));
          return;
        }
        const total = Number.parseInt(response.headers["content-length"] ?? "", 10);
        if (Number.isFinite(total) && total > MAX_INSTALLER_BYTES) {
          response.resume();
          fail(new Error("UPDATE_FILE_TOO_LARGE"));
          return;
        }
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > MAX_INSTALLER_BYTES) {
            response.destroy(new Error("UPDATE_FILE_TOO_LARGE"));
            return;
          }
          if (typeof onProgress === "function") {
            onProgress(total > 0 ? Math.min(100, (received / total) * 100) : 0);
          }
        });
        response.on("error", fail);
        response.pipe(output);
        output.on("finish", () => {
          if (settled) return;
          settled = true;
          output.close(() => resolve());
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("UPDATE_TIMEOUT"));
    });
    request.on("error", fail);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function fetchRemoteManifest({ signal } = {}) {
  const buffer = await requestBuffer(REMOTE_MANIFEST_URL, {
    maxBytes: MAX_MANIFEST_BYTES,
    signal,
  });
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("UPDATE_MANIFEST_INVALID");
  }
  const validated = validateSignedManifest(manifest);
  return {
    ...validated,
    installerUrl: new URL(
      `v${validated.version}/${encodeURIComponent(validated.file)}`,
      REMOTE_RELEASE_BASE_URL,
    ).toString(),
    source: "github",
  };
}

function createUpdater({
  onState,
  appAdapter = app,
  fetchManifest = fetchRemoteManifest,
  downloadFile = downloadToFile,
  hashFile = sha256File,
  spawnInstaller = spawn,
}) {
  let pendingUpdate = null;
  let checkInFlight = null;
  let remoteCache = { checkedAt: 0, manifest: null, error: null };
  let nextCheckAllowedAt = 0;
  const networkController = new AbortController();
  let state = {
    status: "idle",
    currentVersion: appAdapter.getVersion(),
    availableVersion: null,
    required: false,
    progress: 0,
    source: "github",
    messageKey: "githubUpdateNote",
    message: "GitHub Releasesから更新を確認できます",
  };

  // A previous update may have left a verified installer behind after the
  // application exited. It is no longer needed once this process starts.
  try {
    const stagingDirectory = path.join(appAdapter.getPath("userData"), "update-staging");
    for (const entry of fs.readdirSync(stagingDirectory)) {
      if (/\.exe(?:\.download)?$/i.test(entry)) {
        fs.rmSync(path.join(stagingDirectory, entry), { force: true });
      }
    }
  } catch {
    // The staging directory is best-effort housekeeping only.
  }

  const publish = (patch) => {
    state = { ...state, ...patch };
    onState(state);
    return state;
  };

  const getManifest = async () => {
    const now = Date.now();
    if (now < nextCheckAllowedAt) {
      const error = remoteCache.error ?? new Error("UPDATE_RATE_LIMITED");
      error.retryAfterMs = nextCheckAllowedAt - now;
      throw error;
    }
    if (now - remoteCache.checkedAt < REMOTE_CHECK_MIN_INTERVAL_MS) {
      if (remoteCache.error) throw remoteCache.error;
      return remoteCache.manifest;
    }
    try {
      const manifest = await fetchManifest({ signal: networkController.signal });
      remoteCache = { checkedAt: Date.now(), manifest, error: null };
      nextCheckAllowedAt = 0;
      return manifest;
    } catch (error) {
      remoteCache = { checkedAt: Date.now(), manifest: null, error };
      if (Number(error?.retryAfterMs) > 0) {
        nextCheckAllowedAt = Math.max(
          nextCheckAllowedAt,
          Date.now() + Number(error.retryAfterMs),
        );
      }
      throw error;
    }
  };

  const check = async () => {
      const requiredBeforeCheck = state.required === true;
      pendingUpdate = null;
      publish({
        status: "checking",
        availableVersion: null,
        required: requiredBeforeCheck,
        progress: 0,
        source: "github",
        messageKey: "updateChecking",
        message: "GitHub Releasesの更新を確認しています…",
      });

      let manifest;
      try {
        manifest = await getManifest();
      } catch {
        return publish({
          status: "error",
          availableVersion: null,
          required: requiredBeforeCheck,
          messageKey: "updateNetworkError",
          message: "GitHubから更新情報を取得できませんでした",
        });
      }

      const versionAhead = compareVersions(manifest.version, appAdapter.getVersion()) > 0;
      const belowMinimum =
        manifest.minimumVersion !== null &&
        compareVersions(appAdapter.getVersion(), manifest.minimumVersion) < 0;
      if (!versionAhead && !belowMinimum) {
        return publish({
          status: "current",
          availableVersion: null,
          required: false,
          messageKey: "updateCurrent",
          message: "最新版です",
        });
      }

      pendingUpdate = manifest;
      const required = manifest.force || belowMinimum;
      return publish({
        status: "ready",
        availableVersion: manifest.version,
        required,
        progress: 0,
        source: "github",
        messageKey: required ? "updateSecurityRequired" : "updateReady",
        message: required
          ? `更新が必要です（バージョン ${manifest.version}）`
          : `バージョン ${manifest.version} に更新できます`,
      });
  };

  return {
    getState: () => state,
    cancel() {
      networkController.abort();
    },
    check() {
      if (checkInFlight) return checkInFlight;
      const request = check();
      const wrapped = request.finally(() => {
        if (checkInFlight === wrapped) checkInFlight = null;
      });
      checkInFlight = wrapped;
      return wrapped;
    },
    async install() {
      if (!pendingUpdate || state.status !== "ready") {
        throw new Error("UPDATE_NOT_READY");
      }
      if (!appAdapter.isPackaged) {
        throw new Error("UPDATE_INSTALL_DEVELOPMENT");
      }
      const stagingDirectory = path.join(appAdapter.getPath("userData"), "update-staging");
      fs.mkdirSync(stagingDirectory, { recursive: true });
      const stagedInstallerPath = path.join(stagingDirectory, pendingUpdate.file);
      const temporaryPath = `${stagedInstallerPath}.download`;
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }

      publish({
        status: "downloading",
        progress: 0,
        messageKey: "updateDownloading",
        message: `バージョン ${pendingUpdate.version} をダウンロードしています…`,
      });
      try {
        await downloadFile(
          pendingUpdate.installerUrl,
          temporaryPath,
          (progress) => publish({ progress }),
          0,
          networkController.signal,
        );
        const actualHash = await hashFile(temporaryPath);
        if (actualHash !== pendingUpdate.sha256) {
          throw new Error("UPDATE_HASH_MISMATCH");
        }
        try { fs.rmSync(stagedInstallerPath, { force: true }); } catch { /* best effort */ }
        fs.renameSync(temporaryPath, stagedInstallerPath);
      } catch (error) {
        try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
        pendingUpdate = null;
        publish({
          status: "error",
          availableVersion: null,
          required: state.required === true,
          progress: 0,
          messageKey: error.message === "UPDATE_HASH_MISMATCH"
            ? "updateHashMismatch"
            : "updateDownloadError",
          message: error.message === "UPDATE_HASH_MISMATCH"
            ? "更新ファイルの安全性を確認できませんでした"
            : "更新ファイルをダウンロードできませんでした",
        });
        throw error;
      }

      pendingUpdate = null;
      publish({ status: "launching", progress: 100, messageKey: "updateReadyToInstall" });
      let child;
      try {
        child = spawnInstaller(stagedInstallerPath, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
      } catch (error) {
        publish({
          status: "error",
          required: state.required === true,
          progress: 0,
          messageKey: "updateLaunchError",
          message: "更新プログラムを起動できませんでした",
        });
        throw error;
      }
      child.unref();
      appAdapter.quit();
      return { started: true };
    },
  };
}

module.exports = {
  MANIFEST_NAME,
  REMOTE_MANIFEST_URL,
  compareVersions,
  createUpdater,
  fetchRemoteManifest,
  sha256File,
  validateManifest: validateSignedManifest,
};
