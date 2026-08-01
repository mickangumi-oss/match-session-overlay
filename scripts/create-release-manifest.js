"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { MANIFEST_NAME } = require("../src/updater");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const file = `Match-Session-Overlay-${packageJson.version}-Setup.exe`;
const installerPath = path.join(root, "dist", file);
const manifestPath = path.join(root, "dist", MANIFEST_NAME);

if (!fs.existsSync(installerPath)) {
  throw new Error(`Installer not found: ${installerPath}`);
}

const sha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(installerPath))
  .digest("hex")
  .toUpperCase();

const forceUpdate = process.env.MATCH_SESSION_OVERLAY_FORCE_UPDATE === "1";
const minimumVersion = process.env.MATCH_SESSION_OVERLAY_MINIMUM_VERSION;
if (minimumVersion && !/^\d+\.\d+\.\d+$/.test(minimumVersion)) {
  throw new Error("MATCH_SESSION_OVERLAY_MINIMUM_VERSION must be x.y.z");
}
const compareVersions = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
};
if (minimumVersion && compareVersions(minimumVersion, packageJson.version) > 0) {
  throw new Error(
    "MATCH_SESSION_OVERLAY_MINIMUM_VERSION cannot exceed the release version",
  );
}

const manifest = { version: packageJson.version, file, sha256 };
if (forceUpdate) manifest.force = true;
if (minimumVersion) manifest.minimumVersion = minimumVersion;

fs.writeFileSync(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

for (const generatedFile of [
  "builder-debug.yml",
  "latest.yml",
  `${file}.blockmap`,
]) {
  const generatedPath = path.join(root, "dist", generatedFile);
  if (fs.existsSync(generatedPath)) fs.unlinkSync(generatedPath);
}

for (const generatedFile of fs.readdirSync(path.join(root, "dist"))) {
  if (
    generatedFile !== file &&
    /^Match-Session-Overlay-\d+\.\d+\.\d+-Setup\.exe(?:\.blockmap)?$/.test(
      generatedFile,
    )
  ) {
    fs.unlinkSync(path.join(root, "dist", generatedFile));
  }
}

console.log(`Created ${manifestPath}`);
