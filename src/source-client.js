"use strict";

const SERVICE_ORIGIN = "https://www.streetfighter.com";
const SERVICE_HOME = `${SERVICE_ORIGIN}/6/buckler/ja-jp`;
const MATCH_TYPES = ["ranked", "battleHub", "casual"];

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

function createEmptyMatchStats() {
  return {
    ranked: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
      ratingDelta: 0,
      ratingHistory: [],
    },
    battleHub: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
      ratingDelta: null,
      ratingHistory: [],
    },
    casual: {
      wins: 0,
      losses: 0,
      matchCount: 0,
      initialRating: null,
      currentRating: null,
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

function parseBuildId(html) {
  const match = String(html).match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) {
    throw new Error("SERVICE_BUILD_ID_NOT_FOUND");
  }

  const payload = JSON.parse(match[1]);
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
    characterDisplayName: String(characterDisplayName ?? "").trim(),
    mr: Number(league.master_rating ?? 0) || null,
    lp: Number(league.league_point ?? 0) || null,
    lastPlayedAt: Number(raw?.last_play_at ?? 0) || null,
  };
}

function normalizeReplay(raw, targetProfileId) {
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

  const ownRounds = Array.isArray(own.round_results) ? own.round_results : [];
  const opponentRounds = Array.isArray(opponent.round_results)
    ? opponent.round_results
    : [];
  // The official battle log stores the winning pattern for each round rather
  // than a separate match-level winner: 1=N, 2=C, 3=T, 4=D, 5=OD, 6=SA,
  // 7=CA and 8=P. The site renders these as icon_result{code}; 0 is the
  // losing/no-result marker. For the match result we only need to count the
  // positive pattern codes. Checking only `=== 1` would misclassify matches
  // such as [5, 8] as draws.
  const countWonRounds = (rounds) =>
    rounds.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).length;
  const ownWins = countWonRounds(ownRounds);
  const opponentWins = countWonRounds(opponentRounds);

  let result = "draw";
  if (ownWins > opponentWins) result = "win";
  if (ownWins < opponentWins) result = "loss";

  const mr = Number(own.master_rating ?? 0) || null;
  const lp = Number(own.league_point ?? 0) || null;

  const displayName = (value) => {
    const candidate = String(value ?? "").trim();
    return candidate;
  };
  const characterName = (entry) =>
    displayName(
      entry?.playing_character_name ??
        entry?.character_name ??
        entry?.playing_character_display_name ??
        entry?.character?.name ??
        entry?.playing_character_tool_name ??
        "",
    );
  const playerName = (entry) =>
    displayName(
      entry?.player?.fighter_id ?? entry?.player?.name ?? entry?.fighter_id,
    );
  const normalizeTimestamp = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  };
  const opponentMr = Number(opponent.master_rating ?? 0) || null;
  const opponentLp = Number(opponent.league_point ?? 0) || null;
  const ownRatingType = mr != null ? "MR" : lp != null ? "LP" : null;

  return {
    replayId: String(raw?.replay_id ?? ""),
    battleType: Number(raw?.replay_battle_type ?? 0),
    battleTypeName: String(raw?.replay_battle_type_name ?? ""),
    matchType: classifyBattleType(
      raw?.replay_battle_type,
      raw?.replay_battle_type_name,
    ),
    uploadedAt: Number(raw?.uploaded_at ?? 0),
    playedAt: normalizeTimestamp(raw?.uploaded_at),
    result,
    mr,
    lp,
    rating: mr ?? lp,
    ratingType: ownRatingType,
    ownUserCode: p1Id === target ? p1Id : p2Id,
    ownName: playerName(own),
    ownCharacterName: characterName(own),
    ownRating: mr ?? lp,
    ownRatingType: ownRatingType,
    characterId:
      Number(own?.playing_character_id ?? own?.character_id ?? 0) || null,
    opponentName: String(opponent?.player?.fighter_id ?? ""),
    opponentUserCode: String(opponent?.player?.short_id ?? ""),
    opponentCharacterName: characterName(opponent),
    opponentMr,
    opponentLp,
    opponentRating: opponentMr ?? opponentLp,
    opponentRatingType: opponentMr != null ? "MR" : opponentLp != null ? "LP" : null,
    opponentCharacterId:
      Number(opponent?.playing_character_id ?? opponent?.character_id ?? 0) ||
      null,
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
  createEmptyMatchStats,
  normalizeFighter,
  normalizeReplay,
  repairRatingBaseline,
  parseBuildId,
  resetRatingSeries,
  snapshotCurrentCharacter,
};
