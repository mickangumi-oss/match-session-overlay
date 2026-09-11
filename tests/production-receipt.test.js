"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ALLOWED_MATCH_MODES,
  classifyHttpResponse,
  classifyPayloadShape,
  createProductionReceipt,
  finalizeProductionReceipt,
  recordProductionReceipt,
} = require("../src/production-receipt");

function response(status, contentType, ok = status >= 200 && status < 300) {
  return {
    status,
    ok,
    headers: { get: (key) => key === "content-type" ? contentType : null },
  };
}

test("production receipt has a bounded sanitized schema and app modes only", () => {
  const receipt = createProductionReceipt({
    operation: "opponent-context",
    locale: "ja-jp",
    requestedAct: 13,
    requestedModes: ["ranked", "room", "battleHub", "casual"],
    profileId: "2093788909",
  });
  recordProductionReceipt(receipt, "payload", {
    status: "ok",
    rawPayload: { secret: "must-not-appear" },
    normalizedCount: 3,
    reason: "OK",
  });
  finalizeProductionReceipt(receipt, { status: "ready", reason: "NON_ZERO_SCOPE_VERIFIED" });
  assert.deepEqual(receipt.scope.requestedModes, ALLOWED_MATCH_MODES);
  assert.equal(receipt.scope.profileIdPresent, true);
  assert.equal(receipt.events[0].rawPayload, undefined);
  assert.equal(receipt.events[0].normalizedCount, 3);
  assert.deepEqual(receipt.final, { status: "ready", reason: "NON_ZERO_SCOPE_VERIFIED" });
});

test("production receipt preserves bounded computed stats evidence", () => {
  const receipt = createProductionReceipt({ requestedAct: 0, requestedModes: ALLOWED_MATCH_MODES });
  recordProductionReceipt(receipt, "stats.final", {
    selectedMode: "all",
    sourceModes: "ranked,casual,battleHub",
    allBattleCount: 10,
    allWinCount: 4,
    allWinRate: 40,
    displayRowCount: 33,
    trueZero: false,
    partialMissingModes: "",
  });
  assert.deepEqual(receipt.events[0], {
    stage: "stats.final",
    selectedMode: "all",
    sourceModes: "ranked,casual,battleHub",
    allBattleCount: 10,
    allWinCount: 4,
    allWinRate: 40,
    displayRowCount: 33,
    trueZero: false,
    partialMissingModes: "",
  });
});

test("HTTP classification distinguishes auth, HTML/JSON, and empty content type", () => {
  assert.equal(classifyHttpResponse(response(403, "text/html"), { expectedContentType: "html" }).classification, "auth_required");
  assert.equal(classifyHttpResponse(response(200, "text/html"), { expectedContentType: "json" }).classification, "content_type_mismatch");
  assert.equal(classifyHttpResponse(response(200, "application/json"), { expectedContentType: "json" }).classification, "ok");
  assert.equal(classifyHttpResponse(response(200, ""), { expectedContentType: "json" }).contentType, "missing");
  assert.equal(classifyHttpResponse(response(429, "application/json")).classification, "rate_limited");
  assert.equal(classifyPayloadShape({}), "empty-object");
  assert.equal(classifyPayloadShape([]), "empty-array");
});
