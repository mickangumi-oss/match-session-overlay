"use strict";

const MAX_ACT_ID = 100;

function normalizeActId(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ACT_ID
    ? value
    : null;
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

function isFreshOfficialActRegistry(registry, verifiedCurrentActId, now = Date.now(), ttlMs = 5 * 60 * 1000) {
  const validShape = Array.isArray(registry?.acts) && registry.acts.length > 0 &&
    registry.acts.every((act) => Number.isInteger(act?.id) && act.id >= 0) &&
    registry.acts.some((act) => act.id === registry.currentActId) &&
    registry.proof?.endpoint === "profile/{sid}/play" &&
    registry.proof?.payload === "props.pageProps.play.season_ids" &&
    registry.proof?.currentActPayload === "props.pageProps.play.current_season_id";
  return registry?.status === "ready" &&
    validShape &&
    Number.isInteger(verifiedCurrentActId) && verifiedCurrentActId > 0 &&
    registry.currentActId === verifiedCurrentActId &&
    Number.isFinite(Number(registry.retrievedAt)) &&
    Number(now) - Number(registry.retrievedAt) >= 0 &&
    Number(now) - Number(registry.retrievedAt) < ttlMs;
}

function buildOfficialHistoryRequestContext(play, requestedAct) {
  const requested = normalizeActId(requestedAct);
  const registry = buildOfficialActRegistry(play);
  const currentActId = normalizeActId(play?.current_season_id);
  const ok = registry.status === "ready" && requested != null && registry.acts.some((act) => act.id === requested);
  return {
    ok,
    method: ok ? "verified-request-context" : null,
    currentActId: ok ? currentActId : null,
    requestedActId: requested,
    seasonIdsVerified: registry.status === "ready",
    reason: ok ? null : "ACT_SCOPE_MISSING",
  };
}

module.exports = {
  buildOfficialActRegistry,
  buildOfficialHistoryRequestContext,
  isFreshOfficialActRegistry,
  normalizeActDate,
  normalizeActId,
};
