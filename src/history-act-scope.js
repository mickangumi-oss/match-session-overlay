"use strict";

function normalizePositiveActId(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

// Act 0 is a real option on the official PLAY selector. Keep the current-Act
// proof positive-only, but allow explicit historical Act 0 everywhere that
// carries a user-selected history scope.
function normalizeHistoryActId(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function buildOfficialActOptions(currentActId) {
  const current = normalizePositiveActId(currentActId);
  if (current == null) return [];
  return Array.from({ length: current + 1 }, (_unused, index) => {
    const id = current - index;
    return { id, label: `ACT ${id}`, source: "official_profile_play_act_selector" };
  });
}

function normalizeVerifiedHistoryCurrentAct(result = {}) {
  const actId = result?.status === "ready"
    ? normalizePositiveActId(result?.act)
    : null;
  const verified = actId != null;
  return {
    status: verified ? "ready" : "unavailable",
    actId,
    source: verified ? "official_profile_play" : null,
    reason: verified ? null : String(result?.reason ?? "ACT_SCOPE_MISSING").slice(0, 80),
  };
}

function isCurrentHistoryActScope({
  state = {},
  profileId,
  locale,
  generation,
  scopeToken,
  activeScopeToken,
} = {}) {
  return Boolean(profileId) &&
    state.profileId === profileId &&
    state.locale === locale &&
    state.generation === generation &&
    state.scopeToken === activeScopeToken &&
    state.scopeToken === scopeToken;
}

function resolveHistoryActSelection({
  selector = "latest",
  currentActId = null,
  currentActVerified = false,
} = {}) {
  const raw = String(selector ?? "latest").trim() || "latest";
  if (raw === "latest") {
    const actId = normalizePositiveActId(currentActId);
    if (currentActVerified !== true || actId == null) {
      return { ok: false, selector: raw, actId: null, reason: "ACT_SCOPE_MISSING" };
    }
    return { ok: true, selector: raw, actId, reason: null };
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, selector: "invalid", actId: null, reason: "ACT_SCOPE_MISSING" };
  }
  const actId = Number(raw);
  if (normalizeHistoryActId(actId) == null) {
    return { ok: false, selector: "invalid", actId: null, reason: "ACT_SCOPE_MISSING" };
  }
  return { ok: true, selector: raw, actId, reason: null };
}

function buildHistoryActDiagnostic(state = {}) {
  const verified = state.currentActVerified === true &&
    normalizePositiveActId(state.currentActId) != null;
  return {
    status: String(state.currentActStatus ?? "unavailable"),
    currentActId: normalizePositiveActId(state.currentActId),
    source: state.currentActSource ?? null,
    verified,
    reason: verified ? null : String(state.currentActReason ?? "ACT_SCOPE_MISSING").slice(0, 80),
  };
}

module.exports = {
  isCurrentHistoryActScope,
  buildOfficialActOptions,
  buildHistoryActDiagnostic,
  normalizeHistoryActId,
  normalizePositiveActId,
  normalizeVerifiedHistoryCurrentAct,
  resolveHistoryActSelection,
};
