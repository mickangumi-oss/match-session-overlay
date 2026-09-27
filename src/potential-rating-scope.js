(function exposePotentialRatingScope(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.matchPotentialRatingScope = api;
})(typeof globalThis === "object" ? globalThis : this, function createPotentialRatingScope() {
  "use strict";

  function isPotentialMatchRecord(record, characterId = null) {
    if (!record || record.matchType !== "ranked") return false;
    if (record.result !== "win" && record.result !== "loss") return false;
    const actual = Number(record.characterId);
    if (!Number.isFinite(actual) || actual <= 0) return false;
    const expected = Number(characterId);
    return !Number.isFinite(expected) || expected <= 0 || actual === expected;
  }

  return { isPotentialMatchRecord };
});
