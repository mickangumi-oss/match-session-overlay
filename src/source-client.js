"use strict";

const SERVICE_ORIGIN = "https://www.streetfighter.com";
const SERVICE_HOME = `${SERVICE_ORIGIN}/6/buckler/ja-jp`;
const MATCH_TYPES = ["ranked", "battleHub", "casual"];
const LOCALE_KEYS = new Set([
  "ja-jp", "en", "de", "es-es", "es-us", "fr", "it", "ko-kr",
  "zh-hans", "zh-hant", "pt-br", "pl", "ru", "ar",
]);
const { collectProfileContextCandidates } = require("./opponent-profile-context");
const { readHistoryActProvenance } = require("./history-act-provenance");

function classifyBattleType(type, name = "") {
  const normalizedName = String(name).toLowerCase();
  if (normalizedName.includes("ranked")) return "ranked";
  if (normalizedName.includes("casual")) return "casual";
  if (normalizedName.includes("hub")) return "battleHub";

  const numericType = Number(type);
  if (numericType === 1) return "ranked";
  if (numericType === 2) return "casual";
  if (numericType === 3) return "battleHub";
  return null;
}

// Keep the battle-log round pattern opaque until the official meaning is
// verified from a successful response. Only bounded integer values are
// retained; malformed values are discarded and missing arrays stay null.
const MAX_ROUND_RESULT_CODE = 255;
const MAX_KNOWN_ROUND_RESULT_CODE = 8;

function sanitizeRoundResultArray(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (entry) =>
        typeof entry === "number" &&
        Number.isInteger(entry) &&
        entry >= 0 &&
        entry <= MAX_ROUND_RESULT_CODE,
    );
}

function summarizeRoundResults(value) {
  if (!Array.isArray(value)) return null;
  const nested = value.some((entry) => Array.isArray(entry));
  const battles = nested
    ? value.map((entry) => sanitizeRoundResultArray(entry)).filter((entry) => entry != null)
    : null;
  const values = nested ? battles.flat() : sanitizeRoundResultArray(value);
  if (values == null) return null;
  const counts = {};
  for (const entry of values) {
    const key = String(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    values,
    count: values.length,
    counts,
    ...(nested ? { battles: battles.map((rounds) => ({
      values: rounds,
      count: rounds.length,
      counts: rounds.reduce((result, entry) => {
        const key = String(entry);
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {}),
    })) } : {}),
  };
}

function normalizeStoredRoundResults(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalizeSide = (side) => {
    if (Array.isArray(side)) return summarizeRoundResults(side);
    if (!side || typeof side !== "object") return null;
    if (Array.isArray(side.battles)) return summarizeRoundResults(side.battles.map((battle) => battle?.values ?? battle));
    return summarizeRoundResults(side.values);
  };
  const self = normalizeSide(value.self);
  const opponent = normalizeSide(value.opponent);
  return self || opponent ? { self, opponent } : null;
}

function assessRoundResults(value) {
  if (!Array.isArray(value)) return { valid: false, wins: null };
  const values = value.some((entry) => Array.isArray(entry))
    ? value.flatMap((entry) => (Array.isArray(entry) ? entry : []))
    : value;
  if (values.length === 0) return { valid: false, wins: null };
  const valid = values.every(
    (entry) =>
      typeof entry === "number" &&
      Number.isInteger(entry) &&
      entry >= 0 &&
      entry <= MAX_KNOWN_ROUND_RESULT_CODE,
  );
  return {
    valid,
    wins: valid ? values.filter((entry) => entry > 0).length : null,
  };
}

function findNewRankedReplays(replays, previousReplayIds) {
  const seen = previousReplayIds instanceof Set
    ? previousReplayIds
    : new Set(Array.isArray(previousReplayIds) ? previousReplayIds : []);
  return (Array.isArray(replays) ? replays : []).filter(
    (replay) =>
      replay?.matchType === "ranked" &&
      replay?.replayId &&
      !seen.has(replay.replayId),
  );
}

function createEmptyMatchStats() {
  return {
    ranked: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
      currentRatingType: null,
      ratingDelta: 0,
      ratingHistory: [],
    },
    battleHub: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
      currentRatingType: null,
      ratingDelta: null,
      ratingHistory: [],
    },
    casual: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
      currentRatingType: null,
      ratingDelta: null,
      ratingHistory: [],
    },
  };
}

function resetRatingSeries(state, nextRatingType, force = false) {
  const ratingType = nextRatingType === "LP" ? "LP" : "MR";
  if (!force && state.ratingType === ratingType) return false;

  state.ratingType = ratingType;
  state.initialRating = null;
  state.currentRating = null;
  state.ratingDelta = 0;
  const ranked = state.stats.ranked;
  ranked.initialRating = null;
  ranked.currentRating = null;
  ranked.currentRatingType = ratingType;
  ranked.ratingDelta = 0;
  ranked.ratingHistory = [];
  return true;
}

function repairRatingBaseline(state) {
  const ranked = state?.stats?.ranked;
  if (!ranked) return state;
  const ratingType =
    state.ratingType === "LP" || ranked.currentRatingType === "LP"
      ? "LP"
      : "MR";
  if (ratingType !== "LP") return state;

  const currentRating = Number(ranked.currentRating ?? state.currentRating);
  const initialRating = Number(ranked.initialRating);
  if (
    !Number.isFinite(currentRating) ||
    currentRating <= 0 ||
    (Number.isFinite(initialRating) && initialRating > 0)
  ) {
    return state;
  }

  const firstPositiveHistoryRating = (ranked.ratingHistory ?? []).find(
    (value) => Number(value) > 0,
  );
  const baseline = firstPositiveHistoryRating ?? currentRating;
  ranked.initialRating = baseline;
  ranked.currentRating = currentRating;
  ranked.ratingDelta = currentRating - baseline;
  state.initialRating = baseline;
  state.currentRating = currentRating;
  state.ratingDelta = ranked.ratingDelta;
  state.ratingType = "LP";
  return state;
}

function snapshotCurrentCharacter(state) {
  if (state.characterId == null) return;
  state.characterStates ??= {};
  state.characterStates[String(state.characterId)] = {
    wins: state.wins,
    losses: state.losses,
    streak: state.streak,
    initialRating: state.initialRating,
    currentRating: state.currentRating,
    ratingType: state.ratingType,
    ratingDelta: state.ratingDelta,
    lastMatch: state.lastMatch,
    stats: structuredClone(state.stats),
  };
}

function switchCharacterState(state, characterId, replay) {
  snapshotCurrentCharacter(state);
  const saved = state.characterStates?.[String(characterId)];
  if (saved) {
    state.wins = saved.wins;
    state.losses = saved.losses;
    state.streak = saved.streak;
    state.initialRating = saved.initialRating;
    state.currentRating = saved.currentRating;
    state.ratingType = saved.ratingType;
    state.ratingDelta = saved.ratingDelta;
    state.lastMatch = saved.lastMatch;
    state.stats = structuredClone(saved.stats);
  } else {
    state.stats = createEmptyMatchStats();
    state.wins = 0;
    state.losses = 0;
    state.streak = 0;
    state.initialRating = null;
    state.currentRating = replay.rating ?? null;
    state.ratingType = replay.ratingType === "LP" ? "LP" : "MR";
    state.ratingDelta = 0;
    state.lastMatch = null;
  }
  state.characterId = characterId;
}

function parseNextData(html) {
  const match = String(html).match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) {
    throw new Error("SERVICE_NEXT_DATA_NOT_FOUND");
  }

  return JSON.parse(match[1]);
}

function parseBuildId(html) {
  const payload = parseNextData(html);
  if (!payload.buildId || typeof payload.buildId !== "string") {
    throw new Error("SERVICE_BUILD_ID_NOT_FOUND");
  }
  return payload.buildId;
}

function normalizeFighter(raw) {
  const personal = raw?.personal_info ?? {};
  const league = raw?.favorite_character_league_info ?? {};
  const userCode = String(personal.short_id ?? "").trim();

  if (!userCode) {
    return null;
  }

  // A locale-specific service response may include a localized display name
  // alongside the stable tool name. Keep both and let the UI prefer the
  // display name when it is available.
  const characterDisplayName = [
    raw?.favorite_character_name,
    raw?.favorite_character_display_name,
    raw?.favorite_character_label,
    raw?.favorite_character_localized_name,
    raw?.favorite_character?.name,
    raw?.favorite_character?.display_name,
    raw?.character_name,
    raw?.character?.name,
  ].find((value) => typeof value === "string" && value.trim());

  return {
    userCode,
    profileId: userCode,
    name: String(personal.fighter_id ?? "名称未取得"),
    platform: String(personal.platform_name ?? raw?.platform_name ?? ""),
    characterId: Number(raw?.favorite_character_id ?? 0) || null,
    character: String(raw?.favorite_character_tool_name ?? ""),
    // Search results are useful for resolving the stable character id, but the
    // CURRENT CHARACTER label is sourced only from the locale-specific
    // profile response.
    characterDisplayName: "",
    searchCharacterDisplayName: String(characterDisplayName ?? "").trim(),
    mr: Number(league.master_rating ?? 0) || null,
    mrRank: Number(league.master_rating_ranking ?? 0) || null,
    lp: Number(league.league_point ?? 0) || null,
    ratingSource: "search",
    lastPlayedAt: Number(raw?.last_play_at ?? 0) || null,
  };
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function firstValue(object, keys) {
  if (!object || typeof object !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key) && object[key] != null) {
      return object[key];
    }
  }
  return null;
}

function profileCharacterId(object) {
  const value = firstValue(object, [
    "character_id",
    "characterId",
    "fighter_id",
    "fighterId",
    "playing_character_id",
    "favorite_character_id",
    "current_character_id",
  ]);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function profileCharacterName(object) {
  return String(
    firstValue(object, [
      "character_display_name",
      "characterDisplayName",
      "character_name",
      "characterName",
      "playing_character_display_name",
      "playing_character_name",
      "favorite_character_display_name",
      "favorite_character_name",
      "name",
    ]) ?? "",
  ).trim();
}

function collectProfileCharacterCandidates(value, path = "", result = [], depth = 0) {
  if (value == null || result.length >= 300 || depth > 8) return result;
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) =>
      collectProfileCharacterCandidates(item, `${path}[${index}]`, result, depth + 1),
    );
    return result;
  }
  if (typeof value !== "object") return result;

  const characterId = profileCharacterId(value);
  const characterDisplayName = profileCharacterName(value);
  if (characterId != null && characterDisplayName) {
    result.push({
      characterId,
      characterDisplayName,
      preferred: /current|selected|favorite|playing|my_character/.test(path.toLowerCase()),
      path,
    });
  }
  for (const [key, child] of Object.entries(value)) {
    collectProfileCharacterCandidates(
      child,
      path ? `${path}.${key}` : key,
      result,
      depth + 1,
    );
  }
  return result;
}

function collectProfileRatingCandidates(value, path = "", result = [], depth = 0) {
  if (value == null || result.length >= 300 || depth > 8) return result;
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) =>
      collectProfileRatingCandidates(item, `${path}[${index}]`, result, depth + 1),
    );
    return result;
  }
  if (typeof value !== "object") return result;

  const nestedLeague = value.league_info ?? value.leagueInfo ?? value.league ?? {};
  const mr = finitePositive(
    firstValue(value, ["master_rating", "masterRating", "mr"]) ??
      firstValue(nestedLeague, ["master_rating", "masterRating", "mr"]),
  );
  const lp = finitePositive(
    firstValue(value, ["league_point", "leaguePoint", "lp"]) ??
      firstValue(nestedLeague, ["league_point", "leaguePoint", "lp"]),
  );
  const mrRank = finitePositive(
    firstValue(value, ["master_rating_ranking", "masterRatingRanking", "mr_rank"]) ??
      firstValue(nestedLeague, [
        "master_rating_ranking",
        "masterRatingRanking",
        "mr_rank",
      ]),
  );
  if (mr != null || lp != null || mrRank != null) {
    const pathText = path.toLowerCase();
    result.push({
      mr,
      mrRank,
      lp,
      characterId: profileCharacterId(value) ?? profileCharacterId(nestedLeague),
      characterDisplayName: profileCharacterName(value),
      preferred: /current|selected|favorite|playing|my_character/.test(pathText),
      path,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    collectProfileRatingCandidates(child, path ? `${path}.${key}` : key, result, depth + 1);
  }
  return result;
}

function normalizeProfilePlayer(data, fallbackPlayer = {}) {
  const candidates = collectProfileRatingCandidates(data);
  const characterCandidates = collectProfileCharacterCandidates(data);
  const profileContext = collectProfileContextCandidates(data);
  const profileAct = profileContext.explicitCurrentAct?.key
    ? {
        id: profileContext.explicitCurrentAct.key,
        label: profileContext.explicitCurrentAct.label,
      }
    : null;
  const profileCharacterRatings = profileAct
    ? profileContext.candidates
        .filter((candidate) => candidate.actKey === profileAct.id)
        .map((candidate) => ({
          characterId: candidate.characterId,
          characterDisplayName: candidate.characterDisplayName,
          currentMr: candidate.currentMr,
          currentLp: candidate.currentLp,
          peakMr: candidate.peakMr,
          peakLp: candidate.peakLp,
          act: profileAct,
        }))
    : [];
  const desiredCharacterId = Number(fallbackPlayer.characterId) || null;
  const matching = desiredCharacterId == null
    ? []
    : candidates.filter((candidate) => candidate.characterId === desiredCharacterId);
  // When the current character is known, never silently substitute another
  // character's rating. The profile payload can contain every character's
  // league entry (and the preferred entry is not always the character used in
  // the last match). A candidate without a character id is still acceptable
  // as a generic profile-level value; it is safer than mixing a known
  // different character, and the caller keeps the last good value if none is
  // available.
  const hasScopedCandidates = candidates.some((candidate) => candidate.characterId != null);
  const unscoped = desiredCharacterId == null || !hasScopedCandidates
    ? candidates
    : [];
  const candidate =
    matching.find((item) => item.preferred) ??
    matching[0] ??
    unscoped.find((item) => item.preferred) ??
    unscoped[0] ??
    null;
  const matchingCharacterNames = desiredCharacterId == null
    ? []
    : characterCandidates.filter(
        (item) => item.characterId === desiredCharacterId,
      );
  const characterCandidate =
    matchingCharacterNames.find((item) => item.preferred) ??
    matchingCharacterNames[0] ??
    null;
  if (!candidate && !characterCandidate) return null;

  // Keep both values when the official profile supplies both: Master matches
  // can still change LP. A candidate that supplies only one system remains
  // authoritative for that character, so it must not inherit the other value
  // from a stale fallback (which could belong to a prior rank state).
  const hasCandidateMr = candidate?.mr != null;
  const hasCandidateLp = candidate?.lp != null;
  const mr = hasCandidateMr
    ? candidate.mr
    : hasCandidateLp
      ? null
      : finitePositive(fallbackPlayer.mr);
  const lp = hasCandidateLp
    ? candidate.lp
    : hasCandidateMr
      ? null
      : finitePositive(fallbackPlayer.lp);
  const mrRank = mr != null
    ? candidate?.mrRank ?? finitePositive(fallbackPlayer.mrRank)
    : null;
  return {
    ...fallbackPlayer,
    mr,
    mrRank,
    lp,
    characterId:
      desiredCharacterId ??
      candidate?.characterId ??
      characterCandidate?.characterId ??
      null,
    characterDisplayName: characterCandidate?.characterDisplayName ?? "",
    characterDisplayNameSource: characterCandidate ? "profile" : "",
    ratingSource: "profile",
    profileAct,
    profileCharacterRatings,
  };
}

function playerRatingType(player) {
  return player?.mr != null ? "MR" : player?.lp != null ? "LP" : null;
}

function profileCacheLookup(cache, key, now, cooldownMs, force = false) {
  const entry = cache?.get(key);
  if (
    !force &&
    entry &&
    Number.isFinite(Number(entry.fetchedAt)) &&
    now - Number(entry.fetchedAt) < cooldownMs
  ) {
    return { hit: true, player: entry.player ?? null };
  }
  return { hit: false, player: null };
}

function shareInFlightRequest(inFlightMap, key, factory) {
  const existing = inFlightMap?.get(key);
  if (existing) return existing;
  let promise;
  promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      if (inFlightMap?.get(key) === promise) inFlightMap.delete(key);
    });
  inFlightMap?.set(key, promise);
  return promise;
}

function syncCurrentPlayerRatingState(state, player, hasNewRankedReplay = false) {
  const currentRating = player?.mr ?? player?.lp ?? null;
  if (currentRating == null) return state;
  if (
    hasNewRankedReplay &&
    state.characterId != null &&
    player.characterId != null &&
    state.characterId !== player.characterId
  ) {
    return state;
  }

  const ratingType = playerRatingType(player) ?? "MR";
  const previousCharacterId = state.characterId ?? state.player?.characterId;
  const characterChanged =
    previousCharacterId != null &&
    player.characterId != null &&
    previousCharacterId !== player.characterId;
  const recordedRatingType = state.stats.ranked.currentRatingType;
  const ratingTypeChanged =
    recordedRatingType != null && recordedRatingType !== ratingType;
  resetRatingSeries(state, ratingType, characterChanged || ratingTypeChanged);
  const ranked = state.stats.ranked;
  const existingInitialRating = Number(ranked.initialRating);
  const firstPositiveHistoryRating = ranked.ratingHistory.find(
    (value) => Number(value) > 0,
  );
  const hasPlaceholderLpBaseline =
    ratingType === "LP" &&
    Number.isFinite(existingInitialRating) &&
    existingInitialRating <= 0 &&
    currentRating > 0;
  state.player = player;
  state.characterId = player.characterId ?? state.characterId;
  state.currentRating = currentRating;
  state.ratingType = ratingType;
  ranked.currentRating = currentRating;
  ranked.currentRatingType = ratingType;
  if (ranked.initialRating == null || hasPlaceholderLpBaseline) {
    ranked.initialRating = firstPositiveHistoryRating ?? currentRating;
  }
  state.initialRating = ranked.initialRating;

  const history = ranked.ratingHistory;
  const lastHistoryIndex = history.length - 1;
  if (lastHistoryIndex < 0) {
    history.push(currentRating);
  } else if (hasNewRankedReplay && history.length < 2) {
    history.push(currentRating);
  } else if (history[lastHistoryIndex] !== currentRating) {
    history.push(currentRating);
  }

  ranked.ratingDelta = currentRating - ranked.initialRating;
  state.ratingDelta = ranked.ratingDelta;
  return state;
}

function buildHistoryRatingState(records, player) {
  const ordered = [...(Array.isArray(records) ? records : [])].sort(
    (a, b) => Number(a.playedAt ?? a.uploadedAt) - Number(b.playedAt ?? b.uploadedAt),
  );
  const currentCharacterId = Number(player?.characterId) || null;
  const characterRecords = currentCharacterId == null
    ? ordered
    : ordered.filter((record) => Number(record.characterId) === currentCharacterId);
  const allRatingRecords = characterRecords.filter(
    (record) =>
      record.matchType === "ranked" &&
      Number.isFinite(Number(record.ownRating)) &&
      ["MR", "LP"].includes(record.ownRatingType) &&
      (record.ownRatingType !== "LP" || Number(record.ownRating) > 0),
  );
  const ratingType =
    playerRatingType(player) ?? allRatingRecords.at(-1)?.ownRatingType ?? "MR";
  const ratingRecords = allRatingRecords.filter(
    (record) => record.ownRatingType === ratingType,
  );
  const fallbackRating = ratingType === "LP" ? player?.lp : player?.mr;
  const stats = createEmptyMatchStats();
  for (const record of characterRecords) {
    const matchType = record.matchType;
    if (!stats[matchType]) continue;
    stats[matchType].matchCount += 1;
    if (record.result === "win") stats[matchType].wins += 1;
    if (record.result === "loss") stats[matchType].losses += 1;
    if (
      matchType === "ranked" &&
      record.ownRatingType === ratingType &&
      Number.isFinite(Number(record.ownRating)) &&
      (ratingType !== "LP" || Number(record.ownRating) > 0)
    ) {
      const rating = Number(record.ownRating);
      stats.ranked.ratingHistory.push(rating);
    }
  }
  const firstRating = Number.isFinite(Number(ratingRecords[0]?.ownRating))
    ? Number(ratingRecords[0].ownRating)
    : fallbackRating;
  const currentRating = Number.isFinite(Number(fallbackRating))
    ? Number(fallbackRating)
    : Number.isFinite(Number(ratingRecords.at(-1)?.ownRating))
      ? Number(ratingRecords.at(-1).ownRating)
      : null;
  stats.ranked.initialRating = firstRating;
  stats.ranked.currentRating = currentRating;
  stats.ranked.currentRatingType = ratingType;
  stats.ranked.ratingDelta =
    firstRating != null && currentRating != null &&
    ratingType === (ratingRecords[0]?.ownRatingType ?? ratingType)
      ? currentRating - firstRating
      : 0;
  if (!stats.ranked.ratingHistory.length && firstRating != null) {
    stats.ranked.ratingHistory = [firstRating];
  }
  return {
    ordered,
    characterRecords,
    stats,
    wins: stats.ranked.wins,
    losses: stats.ranked.losses,
    initialRating: firstRating,
    currentRating,
    ratingType,
    ratingDelta: stats.ranked.ratingDelta,
    lastMatch: characterRecords.at(-1) ?? null,
  };
}

function normalizeReplay(raw, targetProfileId, locale = null) {
  const target = String(targetProfileId);
  const p1 = raw?.player1_info ?? {};
  const p2 = raw?.player2_info ?? {};
  const p1Id = String(p1?.player?.short_id ?? "");
  const p2Id = String(p2?.player?.short_id ?? "");

  let own;
  let opponent;
  if (p1Id === target) {
    own = p1;
    opponent = p2;
  } else if (p2Id === target) {
    own = p2;
    opponent = p1;
  } else {
    return null;
  }

  const ownRoundResults = summarizeRoundResults(own.round_results);
  const opponentRoundResults = summarizeRoundResults(opponent.round_results);
  // The official battle log stores the winning pattern for each round rather
  // than a separate match-level winner: 1=V, 2=C, 3=T, 4=D, 5=OD, 6=SA,
  // 7=CA and 8=P. The site renders these as icon_result{code}; 0 is the
  // losing/no-result marker. Unknown or malformed entries stay diagnostic
  // only and fail closed for the derived match result.
  const ownRoundState = assessRoundResults(own.round_results);
  const opponentRoundState = assessRoundResults(opponent.round_results);
  let result = "unknown";
  if (ownRoundState.valid && opponentRoundState.valid) {
    // Code 0 is the no-result/loss marker, not a completed round.  A pair of
    // sides with no winning code therefore has no derivable match result.
    if (ownRoundState.wins > 0 || opponentRoundState.wins > 0) {
      result = "draw";
      if (ownRoundState.wins > opponentRoundState.wins) result = "win";
      if (ownRoundState.wins < opponentRoundState.wins) result = "loss";
    }
  }

  const mr = Number(own.master_rating ?? 0) || null;
  const lp = Number(own.league_point ?? 0) || null;

  const displayName = (value) => {
    const candidate = String(value ?? "").trim();
    return candidate;
  };
  const characterName = (entry) => {
    const localized = [
      // Locale-specific display fields must win over the stable/tool name.
      // The latter is commonly an English identifier (for example GOUKI)
      // even when the requested PLAY page locale is Chinese or Korean.
      entry?.playing_character_display_name,
      entry?.character_display_name,
      entry?.character_alpha,
      entry?.characterAlpha,
      entry?.playing_character_alpha,
      entry?.playingCharacterAlpha,
      entry?.character?.display_name,
      entry?.character?.displayName,
      entry?.character?.alpha,
    ].map(displayName)
      .find(Boolean);
    if (localized) return localized;
    // The stable/tool fields are not locale-safe. Keep them only for the
    // English route, where the official payload's canonical name is the
    // requested display language. Non-English routes fail closed instead of
    // leaking GOUKI/ALEX/etc. into a translated screen.
    if (String(locale ?? "").trim() !== "en") return "";
    return [
      entry?.character_name,
      entry?.playing_character_name,
      entry?.character?.name,
      entry?.playing_character_tool_name,
    ]
      .map(displayName)
      .find(Boolean) ?? "";
  };
  const playerName = (entry) =>
    displayName(
      entry?.player?.fighter_id ?? entry?.player?.name ?? entry?.fighter_id,
    );
  const ownCharacterName = characterName(own);
  const opponentCharacterName = characterName(opponent);
  const characterId = (entry) =>
    [
      entry?.playing_character_id,
      entry?.playingCharacterId,
      entry?.character_id,
      entry?.characterId,
    ]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0) ?? null;
  const ownCharacterId = characterId(own);
  const opponentCharacterId = characterId(opponent);
  const normalizeBattleInputType = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (value === 0 || text === "0" || text === "c" || text.includes("クラシック") || text.includes("classic")) return "C";
    if (value === 1 || text === "1" || text === "m" || text.includes("モダン") || text.includes("modern")) return "M";
    return null;
  };
  const opponentBattleInputType = normalizeBattleInputType(
    opponent?.battle_input_type_name ?? opponent?.battle_input_type,
  );
  const actProvenance = readHistoryActProvenance(raw);
  const normalizeTimestamp = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  };
  const opponentMr = Number(opponent.master_rating ?? 0) || null;
  const opponentLp = Number(opponent.league_point ?? 0) || null;
  const ownRatingType = mr != null ? "MR" : lp != null ? "LP" : null;
  const localeKey = String(locale ?? "").trim();
  const characterNamesByLocale = LOCALE_KEYS.has(localeKey) &&
    (ownCharacterName || opponentCharacterName)
    ? {
        [localeKey]: {
          ...(ownCharacterName ? { own: ownCharacterName } : {}),
          ...(opponentCharacterName ? { opponent: opponentCharacterName } : {}),
        },
      }
    : null;

  return {
    replayId: String(raw?.replay_id ?? ""),
    battleType: Number(raw?.replay_battle_type ?? 0),
    battleTypeName: String(raw?.replay_battle_type_name ?? ""),
    actId: actProvenance.actId,
    actIdKnown: actProvenance.actIdKnown,
    matchType: classifyBattleType(
      raw?.replay_battle_type,
      raw?.replay_battle_type_name,
    ),
    uploadedAt: Number(raw?.uploaded_at ?? 0),
    playedAt: normalizeTimestamp(raw?.uploaded_at),
    result,
    mr,
    lp,
    ownMr: mr,
    ownLp: lp,
    rating: mr ?? lp,
    ratingType: ownRatingType,
    ownUserCode: p1Id === target ? p1Id : p2Id,
    ownName: playerName(own),
    ownCharacterName,
    ownRating: mr ?? lp,
    ownRatingType: ownRatingType,
    characterId: ownCharacterId,
    opponentName: String(opponent?.player?.fighter_id ?? ""),
    opponentUserCode: String(opponent?.player?.short_id ?? ""),
    opponentCharacterName,
    opponentMr,
    opponentLp,
    opponentRating: opponentMr ?? opponentLp,
    opponentRatingType: opponentMr != null ? "MR" : opponentLp != null ? "LP" : null,
    opponentCharacterId,
    opponentBattleInputType,
    ...(characterNamesByLocale ? { characterNamesByLocale } : {}),
    ...(ownRoundResults || opponentRoundResults
      ? {
          roundResults: {
            self: ownRoundResults,
            opponent: opponentRoundResults,
          },
        }
      : {}),
  };
}

function applyNewReplays(state, replays) {
  const next = structuredClone(state);
  next.stats ??= createEmptyMatchStats();
  next.characterStates ??= {};

  for (const replay of [...replays].sort(
    (a, b) => a.uploadedAt - b.uploadedAt,
  )) {
    if (!replay.replayId || next.seenReplayIds.includes(replay.replayId)) {
      continue;
    }
    next.seenReplayIds.push(replay.replayId);

    const matchType =
      replay.matchType ??
      classifyBattleType(replay.battleType, replay.battleTypeName);
    if (!MATCH_TYPES.includes(matchType)) {
      continue;
    }

    const characterChanged =
      next.characterId != null &&
      replay.characterId != null &&
      next.characterId !== replay.characterId;
    if (characterChanged) {
      switchCharacterState(next, replay.characterId, replay);
    }
    if (replay.characterId != null) {
      next.characterId = replay.characterId;
    }

    next.stats[matchType].matchCount =
      Number(next.stats[matchType].matchCount ?? 0) + 1;

    if (replay.result === "win") {
      next.stats[matchType].wins += 1;
    } else if (replay.result === "loss") {
      next.stats[matchType].losses += 1;
    }

    if (matchType === "ranked" && replay.rating != null) {
      resetRatingSeries(next, replay.ratingType);
      const existingInitialRating = Number(next.stats.ranked.initialRating);
      const firstPositiveHistoryRating = next.stats.ranked.ratingHistory.find(
        (value) => Number(value) > 0,
      );
      const hasPlaceholderLpBaseline =
        replay.ratingType === "LP" &&
        Number.isFinite(existingInitialRating) &&
        existingInitialRating <= 0 &&
        Number(replay.rating) > 0;
      if (next.stats.ranked.initialRating == null || hasPlaceholderLpBaseline) {
        next.stats.ranked.initialRating =
          firstPositiveHistoryRating ?? replay.rating;
      }
      next.stats.ranked.currentRating = replay.rating;
      next.stats.ranked.currentRatingType = replay.ratingType;
      next.stats.ranked.ratingHistory.push(replay.rating);
      next.currentRating = replay.rating;
      next.ratingType = replay.ratingType;
    }
    next.lastMatch = replay;
  }

  const ranked = next.stats.ranked;
  ranked.ratingDelta =
    ranked.initialRating != null && ranked.currentRating != null
      ? ranked.currentRating - ranked.initialRating
      : 0;
  next.wins = ranked.wins;
  next.losses = ranked.losses;
  next.initialRating = ranked.initialRating;
  next.currentRating = ranked.currentRating;
  next.ratingDelta = ranked.ratingDelta;
  next.updatedAt = Date.now();
  snapshotCurrentCharacter(next);
  return next;
}

module.exports = {
  SERVICE_HOME,
  SERVICE_ORIGIN,
  applyNewReplays,
  classifyBattleType,
  collectProfileCharacterCandidates,
  createEmptyMatchStats,
  findNewRankedReplays,
  normalizeFighter,
  normalizeProfilePlayer,
  normalizeReplay,
  readHistoryActProvenance,
  normalizeStoredRoundResults,
  assessRoundResults,
  buildHistoryRatingState,
  profileCacheLookup,
  playerRatingType,
  repairRatingBaseline,
  shareInFlightRequest,
  parseBuildId,
  parseNextData,
  resetRatingSeries,
  sanitizeRoundResultArray,
  snapshotCurrentCharacter,
  syncCurrentPlayerRatingState,
  summarizeRoundResults,
};
