"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const UPDATE_SIGNATURE_ALGORITHM = "Ed25519";
const UPDATE_SIGNATURE_KEY_ID = "mso-update-2026-01";
const UPDATE_SIGNATURE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAH+iLxwTj34x3JrXJFJYDQiV6a+1Q4zIVzi4lGMwcc54=
-----END PUBLIC KEY-----`;

function isReleaseVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function compareReleaseVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function normalizeUpdateManifest(manifest) {
  if (
    !manifest ||
    !isReleaseVersion(manifest.version) ||
    typeof manifest.file !== "string" ||
    path.basename(manifest.file) !== manifest.file ||
    !manifest.file.toLowerCase().endsWith(".exe") ||
    !/^[0-9a-f]{64}$/i.test(manifest.sha256) ||
    (manifest.force !== undefined && typeof manifest.force !== "boolean") ||
    (manifest.minimumVersion !== undefined &&
      manifest.minimumVersion !== null &&
      !isReleaseVersion(manifest.minimumVersion)) ||
    (isReleaseVersion(manifest.minimumVersion) &&
      compareReleaseVersions(manifest.minimumVersion, manifest.version) > 0)
  ) {
    throw new Error("UPDATE_MANIFEST_INVALID");
  }
  return {
    version: manifest.version,
    file: manifest.file,
    sha256: manifest.sha256.toUpperCase(),
    force: manifest.force === true,
    minimumVersion: manifest.minimumVersion ?? null,
  };
}

function canonicalManifestPayload(manifest) {
  const normalized = normalizeUpdateManifest(manifest);
  return Buffer.from(JSON.stringify({
    version: normalized.version,
    file: normalized.file,
    sha256: normalized.sha256,
    force: normalized.force,
    minimumVersion: normalized.minimumVersion,
    signatureAlgorithm: UPDATE_SIGNATURE_ALGORITHM,
    keyId: UPDATE_SIGNATURE_KEY_ID,
  }), "utf8");
}

function decodeSignature(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("UPDATE_MANIFEST_SIGNATURE_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) {
    throw new Error("UPDATE_MANIFEST_SIGNATURE_INVALID");
  }
  return bytes;
}

function validateSignedManifest(
  manifest,
  publicKeyPem = UPDATE_SIGNATURE_PUBLIC_KEY_PEM,
) {
  const normalized = normalizeUpdateManifest(manifest);
  if (
    manifest.signatureAlgorithm !== UPDATE_SIGNATURE_ALGORITHM ||
    manifest.keyId !== UPDATE_SIGNATURE_KEY_ID
  ) {
    throw new Error("UPDATE_MANIFEST_SIGNATURE_INVALID");
  }
  const signature = decodeSignature(manifest.signature);
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      canonicalManifestPayload(normalized),
      publicKeyPem,
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("UPDATE_MANIFEST_SIGNATURE_INVALID");
  return {
    ...normalized,
    signatureAlgorithm: UPDATE_SIGNATURE_ALGORITHM,
    keyId: UPDATE_SIGNATURE_KEY_ID,
    signature: manifest.signature,
  };
}

module.exports = {
  UPDATE_SIGNATURE_ALGORITHM,
  UPDATE_SIGNATURE_KEY_ID,
  UPDATE_SIGNATURE_PUBLIC_KEY_PEM,
  canonicalManifestPayload,
  normalizeUpdateManifest,
  validateSignedManifest,
};
