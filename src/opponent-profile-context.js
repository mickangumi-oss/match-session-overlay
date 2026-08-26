"use strict";

// The official profile payload has changed shape between site revisions. Keep
// this parser deliberately conservative: only explicit Act/season markers are
// allowed to identify the current Act, and ratings are never inferred by
// comparing MR with LP or by borrowing an unscoped candidate.

const MAX_DEPTH = 8;
const MAX_NODES = 400;

const ACT_VALUE_KEYS = [
  "act_id",
  "actId",
  "act_number",
  "actNumber",
  "season_id",
  "seasonId",
  "season_number",
  "seasonNumber",
  "act",
  "season",
];
const CURRENT_ACT_KEYS = [
  "current_act",
  "currentAct",
  "current_season",
  "currentSeason",
  "current_act_id",
  "currentActId",
  "current_season_id",
  "currentSeasonId",
];
const ACT_LABEL_KEYS = [
  "act_name",
  "actName",
  "season_name",
  "seasonName",
  "act_label",
  "actLabel",
  "season_label",
  "seasonLabel",
  "name",
  "label",
];
const PEAK_MR_KEYS = [
  "master_rating_peak",
  "masterRatingPeak",
  "peak_master_rating",
  "peakMasterRating",
  "peak_mr",
  "peakMr",
  "mr_peak",
  "mrPeak",
  "max_master_rating",
  "maxMasterRating",
];
const PEAK_LP_KEYS = [
  "league_point_peak",
  "leaguePointPeak",
  "peak_league_point",
  "peakLeaguePoint",
  "peak_lp",
  "peakLp",
  "lp_peak",
  "lpPeak",
  "max_league_point",
  "maxLeaguePoint",
];
const CURRENT_MR_KEYS = ["master_rating", "masterRating", "mr"];
const CURRENT_LP_KEYS = ["league_point", "leaguePoint", "lp"];
const CHARACTER_ID_KEYS = [
  "character_id",
  "characterId",
  "playing_character_id",
  "playingCharacterId",
  "favorite_character_id",
  "favoriteCharacterId",
];
const CHARACTER_NAME_KEYS = [
  "character_display_name",
  "characterDisplayName",
  "character_name",
  "characterName",
  "playing_character_display_name",
  "playingCharacterDisplayName",
  "playing_character_name",
  "playingCharacterName",
  "favorite_character_display_name",
  "favoriteCharacterDisplayName",
  "favorite_character_name",
  "favoriteCharacterName",
];

function firstOwn(object, keys) {
  if (!object || typeof object !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key) && object[key] != null) {
      return object[key];
    }
  }
  return null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function safeText(value, maxLength = 80) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

// Keep process-local caches bounded even when callers receive untrusted keys.
// Refreshing an existing key moves it to the newest position, so eviction is
// deterministic and does not retain stale entries indefinitely.
function setBoundedCacheEntry(cache, key, value, maxEntries) {
  if (!(cache instanceof Map)) throw new TypeError("cache must be a Map.");
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries must be a positive integer.");
  }
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  return value;
}

function normalizeActValue(value) {
  if (value == null || typeof value === "object") return "";
  const text = safeText(value, 40);
  return text;
}

function actInfoFromValue(value, { current = false } = {}) {
  if (value == null) return null;
  if (typeof value !== "object") {
    const key = normalizeActValue(value);
    return key ? { key, label: key, current } : null;
  }
  const id = firstOwn(value, [
    "id",
    "act_id",
    "actId",
    "number",
    "act_number",
    "actNumber",
    "season_id",
    "seasonId",
    "season_number",
    "seasonNumber",
  ]);
  const label = firstOwn(value, ["name", "label", "title", ...ACT_LABEL_KEYS]);
  const key = normalizeActValue(id ?? label);
  if (!key) return null;
  return {
    key,
    label: safeText(label ?? id, 80) || key,
    current: current || value.is_current === true || value.isCurrent === true || value.current === true,
  };
}

function directActInfo(object, path = "") {
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  const currentValue = firstOwn(object, CURRENT_ACT_KEYS);
  if (currentValue != null) {
    const info = actInfoFromValue(currentValue, { current: true });
    if (info) return info;
  }
  const directValue = firstOwn(object, ACT_VALUE_KEYS);
  if (directValue != null) {
    const info = actInfoFromValue(directValue, {
      current:
        object.is_current_act === true ||
        object.isCurrentAct === true ||
        object.is_current_season === true ||
        object.isCurrentSeason === true,
    });
    if (info) return info;
  }
  for (const key of ["act_info", "actInfo", "season_info", "seasonInfo"]) {
    const nested = object[key];
    if (nested && typeof nested === "object") {
      const info = actInfoFromValue(nested, {
        current:
          /current/i.test(key) ||
          nested.is_current === true ||
          nested.isCurrent === true ||
          nested.current === true,
      });
      if (info) return info;
    }
  }
  // A currentAct/currentSeason path is an explicit marker even when the
  // payload uses a nested object rather than a dedicated current_* key.
  if (/(?:^|[._])current(?:act|season)(?:[._]|$)/i.test(path)) {
    const info = actInfoFromValue(object, { current: true });
    if (info) return info;
  }
  return null;
}

function characterIdFrom(object) {
  return positiveNumber(firstOwn(object, CHARACTER_ID_KEYS));
}

function characterNameFrom(object) {
  return safeText(firstOwn(object, CHARACTER_NAME_KEYS), 80);
}

function nestedRatingObject(object) {
  return firstOwn(object, ["league_info", "leagueInfo", "league", "rating", "ratings"]) ?? null;
}

function numberFrom(object, keys, nested = null) {
  const direct = positiveNumber(firstOwn(object, keys));
  if (direct != null) return direct;
  return positiveNumber(firstOwn(nested, keys));
}

function candidateFrom(object, inheritedAct, path) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  const nested = nestedRatingObject(object);
  const currentMr = numberFrom(object, CURRENT_MR_KEYS, nested);
  const currentLp = numberFrom(object, CURRENT_LP_KEYS, nested);
  const peakMr = numberFrom(object, PEAK_MR_KEYS, nested);
  const peakLp = numberFrom(object, PEAK_LP_KEYS, nested);
  const characterId = characterIdFrom(object) ?? characterIdFrom(nested);
  const characterDisplayName = characterNameFrom(object) || characterNameFrom(nested);
  if (
    characterId == null ||
    (!characterDisplayName && currentMr == null && currentLp == null && peakMr == null && peakLp == null) ||
    (currentMr == null && currentLp == null && peakMr == null && peakLp == null)
  ) {
    return null;
  }
  return {
    characterId,
    characterDisplayName,
    currentMr,
    currentLp,
    peakMr,
    peakLp,
    actKey: inheritedAct?.key ?? "",
    actLabel: inheritedAct?.label ?? "",
    actCurrent: inheritedAct?.current === true,
    preferred: /current|selected|favorite|playing|my_character/i.test(path),
    path,
  };
}

function collectProfileContextCandidates(value) {
  const candidates = [];
  const seen = new WeakSet();
  let nodes = 0;
  let explicitCurrentAct = null;

  function visit(node, path = "", inheritedAct = null, depth = 0) {
    if (node == null || depth > MAX_DEPTH || nodes >= MAX_NODES) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    nodes += 1;

    const ownAct = directActInfo(node, path);
    const nextAct = ownAct ?? inheritedAct;
    if (ownAct?.current) explicitCurrentAct = ownAct;
    const candidate = candidateFrom(node, nextAct, path);
    if (candidate) candidates.push(candidate);

    if (Array.isArray(node)) {
      node.slice(0, 120).forEach((item, index) => visit(item, `${path}[${index}]`, nextAct, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, path ? `${path}.${key}` : key, nextAct, depth + 1);
    }
  }
  visit(value);
  return { candidates, explicitCurrentAct };
}

function candidateScore(candidate, { characterId = null, preferPeak = true } = {}) {
  let score = 0;
  if (characterId != null && candidate.characterId === characterId) score += 1000;
  if (candidate.preferred) score += 100;
  if (preferPeak && (candidate.peakMr != null || candidate.peakLp != null)) score += 10;
  if (candidate.currentMr != null || candidate.currentLp != null) score += 1;
  return score;
}

function chooseCandidate(candidates, options = {}) {
  return [...candidates]
    .sort((a, b) => candidateScore(b, options) - candidateScore(a, options))[0] ?? null;
}

function candidateRating(candidate) {
  if (!candidate) return { value: null, type: null, kind: null };
  if (candidate.peakMr != null) return { value: candidate.peakMr, type: "MR", kind: "peak" };
  if (candidate.peakLp != null) return { value: candidate.peakLp, type: "LP", kind: "peak" };
  if (candidate.currentMr != null) return { value: candidate.currentMr, type: "MR", kind: "current" };
  if (candidate.currentLp != null) return { value: candidate.currentLp, type: "LP", kind: "current" };
  return { value: null, type: null, kind: null };
}

function bestOtherCharacter(candidates, targetCharacterId, preferredRatingType = null) {
  const eligible = candidates
    .filter((candidate) => candidate.characterId !== targetCharacterId)
    .map((candidate) => ({ candidate, rating: candidateRating(candidate) }))
    .filter(({ rating }) => rating.value != null && rating.type != null);
  const scoped = preferredRatingType
    ? eligible.filter(({ rating }) => rating.type === preferredRatingType)
    : eligible;
  const ranked = scoped.length ? scoped : preferredRatingType ? [] : eligible;
  ranked.sort((a, b) => {
    if (a.rating.type !== b.rating.type) return a.rating.type === "MR" ? -1 : 1;
    return b.rating.value - a.rating.value;
  });
  const selected = ranked[0];
  if (!selected) return null;
  return {
    characterId: selected.candidate.characterId,
    characterDisplayName: selected.candidate.characterDisplayName,
    rating: selected.rating.value,
    ratingType: selected.rating.type,
    ratingKind: selected.rating.kind,
    act: selected.candidate.actKey,
  };
}

function normalizeOpponentProfileContext(data, {
  characterId = null,
  characterDisplayName = "",
  profileId = null,
  retrievedAt = Date.now(),
} = {}) {
  const normalizedCharacterId = positiveNumber(characterId);
  const { candidates, explicitCurrentAct } = collectProfileContextCandidates(data);
  const currentAct = explicitCurrentAct?.key
    ? { id: explicitCurrentAct.key, label: explicitCurrentAct.label }
    : null;
  // Never use a candidate without the same explicit current Act. This is the
  // key guard against showing a previous Act as the current reference value.
  const currentCandidates = currentAct
    ? candidates.filter((candidate) => candidate.actKey === currentAct.id)
    : [];
  const targetCandidates = currentCandidates.filter(
    (candidate) => normalizedCharacterId == null || candidate.characterId === normalizedCharacterId,
  );
  const target = chooseCandidate(targetCandidates, {
    characterId: normalizedCharacterId,
  });
  const targetPeak = target
    ? target.peakMr != null
      ? { value: target.peakMr, type: "MR" }
      : target.peakLp != null
        ? { value: target.peakLp, type: "LP" }
        : null
    : null;
  const targetCurrent = target
    ? target.currentMr != null
      ? { value: target.currentMr, type: "MR" }
      : target.currentLp != null
        ? { value: target.currentLp, type: "LP" }
        : null
    : null;
  const other = bestOtherCharacter(
    currentCandidates,
    normalizedCharacterId,
    targetCurrent?.type ?? targetPeak?.type ?? null,
  );
  return {
    status: currentAct ? "ready" : "empty",
    profileId: profileId == null ? null : String(profileId),
    retrievedAt: Number.isFinite(Number(retrievedAt)) ? Number(retrievedAt) : null,
    act: currentAct,
    targetCharacter: {
      characterId: normalizedCharacterId ?? target?.characterId ?? null,
      characterDisplayName: target?.characterDisplayName || safeText(characterDisplayName, 80),
      peakRating: targetPeak,
      currentRating: targetCurrent,
    },
    otherCharacter: other,
  };
}

module.exports = {
  collectProfileContextCandidates,
  normalizeOpponentProfileContext,
  setBoundedCacheEntry,
};
