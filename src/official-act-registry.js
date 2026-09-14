"use strict";

const MAX_ACT_ID = 100;

function normalizeActId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 && id <= MAX_ACT_ID ? id : null;
}

function normalizeActDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function officialActLabel(id, value) {
  const label = String(value ?? "").trim();
  return label || `ACT ${id}`;
}

function buildOfficialActRegistry(
  play,
  {
    retrievedAt = Date.now(),
    source = "official_profile_play_act_selector",
  } = {},
) {
  const currentActId = normalizeActId(play?.current_season_id);
  const rawIds = play?.season_ids;
  if (
    currentActId == null ||
    currentActId <= 0 ||
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !Number.isFinite(Number(retrievedAt)) ||
    Number(retrievedAt) <= 0
  ) {
    return { status: "unavailable", reason: "ACT_REGISTRY_INVALID", acts: [] };
  }

  const acts = [];
  const seen = new Set();
  let previous = Infinity;
  for (const rawId of rawIds) {
    const id = normalizeActId(rawId);
    if (id == null || seen.has(id) || id > currentActId || id >= previous) {
      return { status: "unavailable", reason: "ACT_REGISTRY_INVALID", acts: [] };
    }
    seen.add(id);
    previous = id;
    acts.push({
      id,
      label: officialActLabel(id),
      // The public PLAY selector currently exposes IDs/labels only. Keep
      // dates explicitly unknown instead of inventing boundaries.
      startDate: null,
      endDate: null,
      dateStatus: "unavailable",
      source,
    });
  }
  if (!seen.has(currentActId)) {
    return { status: "unavailable", reason: "ACT_REGISTRY_INVALID", acts: [] };
  }

  return {
    status: "ready",
    currentActId,
    acts,
    source,
    retrievedAt: Number(retrievedAt),
    proof: {
      endpoint: "profile/{sid}/play",
      payload: "props.pageProps.play.season_ids",
      currentActPayload: "props.pageProps.play.current_season_id",
      dates: "not-exposed-by-official-play-payload",
    },
  };
}

function isFreshOfficialActRegistry(registry, now = Date.now(), ttlMs = 5 * 60 * 1000) {
  return registry?.status === "ready" &&
    Array.isArray(registry.acts) &&
    Number.isFinite(Number(registry.retrievedAt)) &&
    Number(now) - Number(registry.retrievedAt) >= 0 &&
    Number(now) - Number(registry.retrievedAt) < ttlMs;
}

module.exports = {
  buildOfficialActRegistry,
  isFreshOfficialActRegistry,
  normalizeActDate,
  normalizeActId,
};
