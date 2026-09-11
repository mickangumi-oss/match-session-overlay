const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialActOptions,
  buildHistoryActDiagnostic,
  isCurrentHistoryActScope,
  normalizeVerifiedHistoryCurrentAct,
  resolveHistoryActSelection,
} = require("../src/history-act-scope");

test("official current Act yields the complete selector range without assigning record Acts", () => {
  const options = buildOfficialActOptions(13);
  assert.deepEqual(options.map((option) => option.id), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(options.every((option) => option.source === "official_profile_play_act_selector"), true);
});

test("diagnostics preserve null reason for verified proof and reason for unavailable proof", () => {
  assert.deepEqual(buildHistoryActDiagnostic({
    currentActId: 13,
    currentActStatus: "ready",
    currentActSource: "official_profile_play",
    currentActVerified: true,
    currentActReason: null,
  }), {
    status: "ready",
    currentActId: 13,
    source: "official_profile_play",
    verified: true,
    reason: null,
  });
  assert.equal(buildHistoryActDiagnostic({}).reason, "ACT_SCOPE_MISSING");
});

test("official current Act 13 is the only source for latest resolution", () => {
  const proof = normalizeVerifiedHistoryCurrentAct({ status: "ready", act: 13 });
  assert.deepEqual(proof, {
    status: "ready",
    actId: 13,
    source: "official_profile_play",
    reason: null,
  });
  assert.deepEqual(resolveHistoryActSelection({
    selector: "latest",
    currentActId: proof.actId,
    currentActVerified: true,
  }), { ok: true, selector: "latest", actId: 13, reason: null });
});

test("unavailable or malformed official Act proof fails closed", () => {
  for (const result of [
    { status: "unavailable", act: 13 },
    { status: "ready", act: "13" },
    { status: "ready", act: 0 },
  ]) {
    const proof = normalizeVerifiedHistoryCurrentAct(result);
    assert.equal(proof.actId, null);
    assert.equal(proof.status, "unavailable");
    assert.equal(resolveHistoryActSelection({
      selector: "latest",
      currentActId: proof.actId,
      currentActVerified: false,
    }).reason, "ACT_SCOPE_MISSING");
  }
});

test("an explicit past Act remains explicit and does not use current Act 13", () => {
  assert.deepEqual(resolveHistoryActSelection({
    selector: "12",
    currentActId: 13,
    currentActVerified: true,
  }), { ok: true, selector: "12", actId: 12, reason: null });
  assert.deepEqual(resolveHistoryActSelection({
    selector: "0",
    currentActId: 13,
    currentActVerified: true,
  }), { ok: true, selector: "0", actId: 0, reason: null });
});

test("profile, locale, generation, and invalidated scope tokens cannot reuse Act proof", () => {
  const state = { profileId: "2093788909", locale: "ja-jp", generation: 4, scopeToken: 7 };
  const base = {
    state,
    profileId: "2093788909",
    locale: "ja-jp",
    generation: 4,
    scopeToken: 7,
    activeScopeToken: 7,
  };
  assert.equal(isCurrentHistoryActScope(base), true);
  for (const change of [
    { profileId: "1234567890" },
    { locale: "en-us" },
    { generation: 5 },
    { scopeToken: 8 },
    { activeScopeToken: 8 },
  ]) {
    assert.equal(isCurrentHistoryActScope({ ...base, ...change }), false);
  }
});

test("invalid selection never becomes a numeric request", () => {
  const resolved = resolveHistoryActSelection({
    selector: "not-an-act",
    currentActId: 13,
    currentActVerified: true,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.actId, null);
  assert.equal(resolved.reason, "ACT_SCOPE_MISSING");
});
