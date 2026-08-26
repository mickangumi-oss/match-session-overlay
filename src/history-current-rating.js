(function exposeHistoryCurrentRating(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MatchHistoryCurrentRating = api;
})(typeof globalThis === "object" ? globalThis : this, function createHistoryCurrentRating() {
  "use strict";

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeRatingType(value) {
    return String(value ?? "").toUpperCase() === "LP" ? "LP" : "MR";
  }

  function recordTimestamp(record) {
    return Number(record?.playedAt ?? record?.uploadedAt) || 0;
  }

  function recordRating(record, ratingType) {
    const normalizedType = normalizeRatingType(ratingType);
    const ownType = String(record?.ownRatingType ?? "").toUpperCase();
    if (ownType === normalizedType) {
      return positiveNumber(record?.ownRating ?? record?.rating);
    }
    return positiveNumber(
      normalizedType === "LP" ? record?.ownLp : record?.ownMr,
    );
  }

  function currentProfileRating(
    player,
    ratingType,
    characterId,
    latestRecordTimestamp = null,
  ) {
    const expectedCharacterId = positiveNumber(characterId);
    const profileCharacterId = positiveNumber(player?.characterId);
    if (!expectedCharacterId || profileCharacterId !== expectedCharacterId) return null;
    if (String(player?.ratingSource ?? "").toLowerCase() !== "profile") return null;
    const profileUpdatedAt = positiveNumber(player?.profileUpdatedAt);
    if (!profileUpdatedAt) return null;
    if (
      latestRecordTimestamp != null &&
      profileUpdatedAt < Number(latestRecordTimestamp)
    ) {
      return null;
    }
    return positiveNumber(
      normalizeRatingType(ratingType) === "LP" ? player?.lp : player?.mr,
    );
  }

  function deriveHistoryRatingSeries(
    records,
    player,
    ratingType,
    { characterId = null } = {},
  ) {
    const normalizedType = normalizeRatingType(ratingType);
    const expectedCharacterId = positiveNumber(characterId ?? player?.characterId);
    const ordered = (Array.isArray(records) ? records : [])
      .filter(
        (record) =>
          record?.matchType === "ranked" &&
          (expectedCharacterId == null ||
            positiveNumber(record?.characterId) === expectedCharacterId) &&
          recordRating(record, normalizedType) != null &&
          (normalizedType !== "LP" || recordRating(record, normalizedType) > 0),
      )
      .sort((left, right) => recordTimestamp(left) - recordTimestamp(right))
      .map((record) => ({
        ...record,
        // This field is deliberately separate from ownRating. The latter is
        // the immutable battle-log snapshot; this is display-only derivation.
        derivedRatingType: normalizedType,
        derivedOwnRating: recordRating(record, normalizedType),
      }));

    const current = currentProfileRating(
      player,
      normalizedType,
      expectedCharacterId,
      ordered.at(-1)?.playedAt ?? ordered.at(-1)?.uploadedAt ?? null,
    );
    const currentApplied =
      current != null &&
      ordered.length > 0 &&
      expectedCharacterId != null &&
      positiveNumber(ordered[ordered.length - 1].characterId) === expectedCharacterId;
    const derivedRecords = currentApplied
      ? ordered.map((record, index) =>
          index === ordered.length - 1
            ? { ...record, derivedOwnRating: current }
            : record,
        )
      : ordered;

    return {
      records: derivedRecords,
      values: derivedRecords.map((record) => record.derivedOwnRating),
      currentApplied,
      currentValue: currentApplied ? current : null,
    };
  }

  return {
    currentProfileRating,
    deriveHistoryRatingSeries,
    normalizeRatingType,
    positiveNumber,
  };
});
