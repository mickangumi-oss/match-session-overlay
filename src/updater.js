"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const MANIFEST_NAME = "local-update.json";
const MAX_MANIFEST_BYTES = 64 * 1024;

function isReleaseVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

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

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

function readManifest(sourceDirectory) {
  const manifestPath = path.join(sourceDirectory, MANIFEST_NAME);
  const descriptor = fs.openSync(manifestPath, "r");
  let manifestText;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error("UPDATE_MANIFEST_INVALID");
    }
    manifestText = fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  const manifest = JSON.parse(manifestText);
  if (
    !isReleaseVersion(manifest.version) ||
    typeof manifest.file !== "string" ||
    path.basename(manifest.file) !== manifest.file ||
    !manifest.file.toLowerCase().endsWith(".exe") ||
    !/^[0-9a-f]{64}$/i.test(manifest.sha256) ||
    (manifest.force !== undefined && typeof manifest.force !== "boolean") ||
    (manifest.minimumVersion !== undefined &&
      !isReleaseVersion(manifest.minimumVersion)) ||
    (isReleaseVersion(manifest.minimumVersion) &&
      compareVersions(manifest.minimumVersion, manifest.version) > 0)
  ) {
    throw new Error("UPDATE_MANIFEST_INVALID");
  }
  const installerPath = path.resolve(sourceDirectory, manifest.file);
  if (path.dirname(installerPath) !== path.resolve(sourceDirectory)) {
    throw new Error("UPDATE_MANIFEST_INVALID");
  }
  return {
    version: manifest.version,
    installerPath,
    sha256: manifest.sha256.toUpperCase(),
    force: manifest.force === true,
    minimumVersion: manifest.minimumVersion ?? null,
  };
}

function createUpdater({ onState, configPath, defaultSourceDirectory }) {
  let sourceDirectory = defaultSourceDirectory;
  let pendingUpdate = null;
  let state = {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    required: false,
    progress: 0,
    messageKey: "localUpdateNote",
    message: "ローカル更新を確認できます",
  };

  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof saved.sourceDirectory === "string" && path.isAbsolute(saved.sourceDirectory)) {
      sourceDirectory = path.normalize(saved.sourceDirectory);
    }
  } catch {
    // 初回起動または破損した設定は既定の更新フォルダへ戻す。
  }

  fs.mkdirSync(defaultSourceDirectory, { recursive: true });

  const publish = (patch) => {
    state = { ...state, ...patch };
    onState(state);
    return state;
  };

  const saveSourceDirectory = () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ sourceDirectory }, null, 2),
      "utf8",
    );
  };

  return {
    getState: () => state,
    getSourceDirectory: () => sourceDirectory,
    setSourceDirectory(nextDirectory) {
      if (typeof nextDirectory !== "string" || !path.isAbsolute(nextDirectory)) {
        throw new Error("UPDATE_DIRECTORY_INVALID");
      }
      sourceDirectory = path.normalize(nextDirectory);
      pendingUpdate = null;
      saveSourceDirectory();
      return publish({
        status: "idle",
        availableVersion: null,
        progress: 0,
        messageKey: "updateDirectory",
        sourceDirectoryName: path.basename(sourceDirectory),
        message: `更新フォルダ: ${path.basename(sourceDirectory)}`,
      });
    },
    async check() {
      pendingUpdate = null;
      publish({
        status: "checking",
        availableVersion: null,
        progress: 0,
        messageKey: "updateChecking",
        message: "ローカル更新を確認しています…",
      });

      let manifest;
      try {
        manifest = readManifest(sourceDirectory);
      } catch (error) {
        if (error.code === "ENOENT") {
          return publish({
            status: "empty",
            messageKey: "updateNoFiles",
            sourceDirectoryName: path.basename(sourceDirectory),
            message: `更新ファイルがありません（${path.basename(sourceDirectory)}）`,
          });
        }
        return publish({
          status: "error",
          messageKey: "updateReadError",
          message: "更新情報を読み取れませんでした",
        });
      }

      const versionAhead = compareVersions(manifest.version, app.getVersion()) > 0;
      const belowMinimum =
        manifest.minimumVersion !== null &&
        compareVersions(app.getVersion(), manifest.minimumVersion) < 0;
      if (!versionAhead && !belowMinimum) {
        return publish({
          status: "current",
          availableVersion: null,
          required: false,
          messageKey: "updateCurrent",
          message: "最新版です",
        });
      }

      let actualHash;
      try {
        actualHash = await sha256File(manifest.installerPath);
      } catch {
        return publish({
          status: "error",
          messageKey: "updateInstallerMissing",
          message: "更新用インストーラーが見つかりません",
        });
      }

      if (actualHash !== manifest.sha256) {
        return publish({
          status: "error",
          messageKey: "updateHashMismatch",
          message: "更新ファイルの安全性を確認できませんでした",
        });
      }

      pendingUpdate = manifest;
      const required = manifest.force || belowMinimum;
      return publish({
        status: "ready",
        availableVersion: manifest.version,
        required,
        progress: 100,
        messageKey: required ? "updateSecurityRequired" : "updateReady",
        sourceDirectoryName: path.basename(sourceDirectory),
        message: required
          ? `セキュリティ更新が必要です（バージョン ${manifest.version}）`
          : `バージョン ${manifest.version} に更新できます`,
      });
    },
    async install() {
      if (!pendingUpdate || state.status !== "ready") {
        throw new Error("UPDATE_NOT_READY");
      }
      const actualHash = await sha256File(pendingUpdate.installerPath);
      if (actualHash !== pendingUpdate.sha256) {
        pendingUpdate = null;
        publish({
          status: "error",
          availableVersion: null,
          messageKey: "updateChanged",
          message: "更新ファイルが変更されたため中止しました",
        });
        throw new Error("UPDATE_HASH_MISMATCH");
      }
      if (!app.isPackaged) {
        throw new Error("UPDATE_INSTALL_DEVELOPMENT");
      }
      const stagingDirectory = path.join(
        path.dirname(configPath),
        "update-staging",
      );
      fs.mkdirSync(stagingDirectory, { recursive: true });
      const stagedInstallerPath = path.join(
        stagingDirectory,
        path.basename(pendingUpdate.installerPath),
      );
      fs.copyFileSync(pendingUpdate.installerPath, stagedInstallerPath);
      const stagedHash = await sha256File(stagedInstallerPath);
      if (stagedHash !== pendingUpdate.sha256) {
        throw new Error("UPDATE_STAGING_HASH_MISMATCH");
      }
      const child = spawn(stagedInstallerPath, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      app.quit();
      return { started: true };
    },
  };
}

module.exports = {
  MANIFEST_NAME,
  compareVersions,
  createUpdater,
  readManifest,
  sha256File,
};
