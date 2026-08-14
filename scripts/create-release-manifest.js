"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MANIFEST_NAME } = require("../src/updater");
const {
  UPDATE_SIGNATURE_ALGORITHM,
  UPDATE_SIGNATURE_KEY_ID,
  canonicalManifestPayload,
  normalizeUpdateManifest,
  validateSignedManifest,
} = require("../src/update-signature");

const root = path.resolve(__dirname, "..");
const outputDirectory = String(
  process.env.MATCH_SESSION_OVERLAY_DIST_DIR ?? "dist",
).trim();
if (!/^[a-zA-Z0-9._-]+$/.test(outputDirectory)) {
  throw new Error("MATCH_SESSION_OVERLAY_DIST_DIR must be a repository-local directory name");
}
const distPath = path.join(root, outputDirectory);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const file = `Match-Session-Overlay-${packageJson.version}-Setup.exe`;
const installerPath = path.join(distPath, file);
const manifestPath = path.join(distPath, MANIFEST_NAME);

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

const signingKeyPath = String(
  process.env.MATCH_SESSION_OVERLAY_UPDATE_SIGNING_KEY_PATH ??
    path.join(
      os.homedir(),
      ".match-session-overlay-secrets",
      "update-signing-ed25519-private.pem",
    ),
).trim();
if (!signingKeyPath) {
  throw new Error("MATCH_SESSION_OVERLAY_UPDATE_SIGNING_KEY_PATH is required");
}
const resolvedSigningKeyPath = path.resolve(signingKeyPath);
const privateKey = fs.readFileSync(resolvedSigningKeyPath, "utf8");
const normalizedManifest = normalizeUpdateManifest(manifest);
manifest.signatureAlgorithm = UPDATE_SIGNATURE_ALGORITHM;
manifest.keyId = UPDATE_SIGNATURE_KEY_ID;
manifest.signature = crypto
  .sign(null, canonicalManifestPayload(normalizedManifest), privateKey)
  .toString("base64");
validateSignedManifest(manifest);

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
  const generatedPath = path.join(distPath, generatedFile);
  if (fs.existsSync(generatedPath)) fs.unlinkSync(generatedPath);
}

for (const generatedFile of fs.readdirSync(distPath)) {
  if (
    generatedFile !== file &&
    /^Match-Session-Overlay-\d+\.\d+\.\d+-Setup\.exe(?:\.blockmap)?$/.test(
      generatedFile,
    )
  ) {
    fs.unlinkSync(path.join(distPath, generatedFile));
  }
}

console.log(`Created ${manifestPath}`);
