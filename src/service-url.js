"use strict";

function normalizePathSegment(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
    throw new TypeError(`${name} must be a non-empty path segment.`);
  }
  return normalized;
}

function normalizeRelativePath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\\") || normalized.includes("..")) {
    throw new TypeError("relativePath must stay within the service data route.");
  }
  return normalized;
}

function buildServiceHomeUrl(origin, locale) {
  const normalizedLocale = normalizePathSegment(locale, "locale");
  return new URL(`/6/buckler/${normalizedLocale}`, origin).toString();
}

function buildServiceDataUrl(origin, buildId, locale, relativePath, query = {}) {
  const normalizedBuildId = normalizePathSegment(buildId, "buildId");
  const normalizedLocale = normalizePathSegment(locale, "locale");
  const normalizedPath = normalizeRelativePath(relativePath);
  const url = new URL(
    `/6/buckler/_next/data/${normalizedBuildId}/${normalizedLocale}/${normalizedPath}`,
    origin,
  );
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

module.exports = { buildServiceDataUrl, buildServiceHomeUrl };
