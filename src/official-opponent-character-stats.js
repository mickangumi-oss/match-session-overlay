(function exposeOfficialOpponentCharacterStats(globalScope) {
  "use strict";

  const ALLOWED_MODES = Object.freeze([2, 3, 5]);
  const MATCH_TYPES = Object.freeze(["ranked", "casual", "battleHub"]);
  const OFFICIAL_MODE_TO_MATCH_TYPE = Object.freeze({
    2: "ranked",
    3: "casual",
    5: "battleHub",
  });
  const AGGREGATE_CHARACTER_ID = 253;

  function asResponse(value) {
    return value && typeof value === "object" && value.response && typeof value.response === "object"
      ? value.response
      : value;
  }

  function sortedIds(ids) {
    return [...ids].sort((left, right) => left - right);
  }

  function buildOfficialCharacterStatsRequestKey(profileId, locale) {
    const normalizedProfileId = String(profileId ?? "").trim();
    const normalizedLocale = String(locale ?? "").trim();
    return normalizedProfileId && normalizedLocale
      ? `${normalizedLocale}:${normalizedProfileId}`
      : "";
  }

  function buildOfficialCharacterStatsCacheKey(profileId, locale, act) {
    const requestKey = buildOfficialCharacterStatsRequestKey(profileId, locale);
    const currentAct = Number(act);
    const hasAct = act !== null && act !== undefined && String(act).trim() !== "";
    return requestKey && hasAct && Number.isInteger(currentAct) && currentAct >= 0
      ? `${requestKey}:${currentAct}`
      : "";
  }

  function isRetryableOfficialCharacterStatsReason(reason) {
    if (["RATE_LIMITED", "REQUEST_FAILED", "LOCALE_CHANGED"].includes(String(reason ?? ""))) {
      return true;
    }
    const match = /^SERVICE_HTTP_(\d+)$/.exec(String(reason ?? ""));
    return Boolean(match && Number(match[1]) >= 500);
  }

  function validateOfficialCharacterWinRates(value, {
    expectedCharacterIds = null,
    locale = "",
    act = null,
    mode = null,
  } = {}) {
    const response = asResponse(value);
    const rows = response?.character_win_rates;
    const diagnostics = {
      locale: String(locale ?? ""),
      act: Number.isInteger(Number(act)) ? Number(act) : null,
      mode: Number.isInteger(Number(mode)) ? Number(mode) : null,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      positiveIds: 0,
      uniqueIds: 0,
      requiredKeyCount: 0,
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, reason: "EMPTY_OR_MISSING_ROWS", diagnostics };
    }

    const ids = new Set();
    const normalized = [];
    for (const row of rows) {
      const characterId = row?.character_id;
      const label = typeof row?.character_name === "string"
        ? row.character_name.trim()
        : "";
      const matches = row?.battle_count;
      const wins = row?.win_count;
      const required = [
        Number.isInteger(characterId) && characterId > 0,
        label.length > 0,
        Number.isInteger(matches) && matches >= 0,
        Number.isInteger(wins) && wins >= 0,
      ];
      diagnostics.requiredKeyCount += required.filter(Boolean).length === 4 ? 1 : 0;
      if (!required.every(Boolean)) {
        return { ok: false, reason: "REQUIRED_ROW_FIELD_INVALID", diagnostics };
      }
      if (wins > matches) {
        return { ok: false, reason: "WINS_EXCEED_MATCHES", diagnostics };
      }
      if (ids.has(characterId)) {
        return { ok: false, reason: "DUPLICATE_CHARACTER_ID", diagnostics };
      }
      ids.add(characterId);
      normalized.push({
        characterId,
        label,
        matches,
        wins,
        winRate: matches > 0 ? (wins / matches) * 100 : 0,
      });
    }

    diagnostics.positiveIds = ids.size;
    diagnostics.uniqueIds = ids.size;
    if (expectedCharacterIds) {
      const expected = new Set(expectedCharacterIds);
      const missing = sortedIds([...expected].filter((id) => !ids.has(id)));
      const unexpected = sortedIds([...ids].filter((id) => !expected.has(id)));
      if (missing.length || unexpected.length) {
        return {
          ok: false,
          reason: "CHARACTER_ID_SET_MISMATCH",
          diagnostics: { ...diagnostics, missingIds: missing.length, unexpectedIds: unexpected.length },
        };
      }
    }

    return {
      ok: true,
      rows: normalized,
      diagnostics,
      responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
    };
  }

  function optionalScopeInteger(response, keys) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(response ?? {}, key)) continue;
      const value = response[key];
      return { present: true, value: typeof value === "number" && Number.isInteger(value) ? value : null };
    }
    return { present: false, value: null };
  }

  function checksumForScope(rows, selectedOwnCharacterId) {
    const selected = selectedOwnCharacterId == null || String(selectedOwnCharacterId) === "all"
      ? null
      : Number(selectedOwnCharacterId);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const aggregate = normalizedRows.find((row) => Number(row?.characterId) === AGGREGATE_CHARACTER_ID);
    const scopedRows = selected == null
      ? (aggregate ? [aggregate] : normalizedRows)
      : normalizedRows.filter((row) => Number(row?.characterId) === selected);
    return scopedRows.reduce(
      (total, row) => ({
        matches: total.matches + Number(row?.matches || 0),
        wins: total.wins + Number(row?.wins || 0),
      }),
      { matches: 0, wins: 0 },
    );
  }

  function summarizeOfficialOpponentCharacterStatsRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const aggregate = normalizedRows.find((row) =>
      Number(row?.characterId ?? row?.id) === AGGREGATE_CHARACTER_ID ||
      String(row?.label ?? "").toUpperCase() === "ALL",
    );
    if (aggregate) {
      const matches = Number(aggregate.matches) || 0;
      const wins = Number(aggregate.wins) || 0;
      return {
        matches,
        wins,
        winRate: matches > 0 ? (wins / matches) * 100 : 0,
        source: "aggregate-row",
      };
    }
    return normalizedRows
      .filter((row) =>
        Number(row?.characterId ?? row?.id) !== AGGREGATE_CHARACTER_ID &&
        String(row?.label ?? "").toUpperCase() !== "ALL",
      )
      .reduce(
        (total, row) => {
          total.matches += Number(row?.matches) || 0;
          total.wins += Number(row?.wins) || 0;
          return total;
        },
        { matches: 0, wins: 0, source: "non-aggregate-rows" },
      );
  }

  // The opponent-character table is accepted only from the official PLAY
  // two-axis field. The one-axis rows are used solely as a checksum and roster
  // contract; they are never projected into opponent rows.
  function validateOfficialOpponentCharacterWinRates(value, {
    expectedCharacterIds = null,
    expectedSelfRows = null,
    selectedOwnCharacterId = "all",
    locale = "",
    act = null,
    mode = null,
    generation = null,
    scopeKind = "post",
  } = {}) {
    const response = asResponse(value);
    const rows = response?.character_win_rates_by_rival_character;
    const expectedAct = Number.isInteger(Number(act)) ? Number(act) : null;
    const expectedMode = Number.isInteger(Number(mode)) ? Number(mode) : null;
    const selected = selectedOwnCharacterId == null || String(selectedOwnCharacterId) === "all"
      ? null
      : Number(selectedOwnCharacterId);
    const diagnostics = {
      locale: String(locale ?? ""),
      act: expectedAct,
      mode: expectedMode,
      generation: Number.isInteger(Number(generation)) ? Number(generation) : null,
      scopeKind: String(scopeKind ?? "post"),
      selectedOwnCharacterId: selected == null ? "all" : selected,
      outerRowCount: Array.isArray(rows) ? rows.length : 0,
      outerUniqueCount: 0,
      nestedRowCount: 0,
      displayRowCount: 0,
      aggregateRivalExcluded: 0,
      aggregateRivalObserved: false,
      aggregateRowSource: null,
      aggregateMismatch: false,
      observedAct: null,
      observedMode: null,
      selfChecksum: null,
      rivalChecksum: null,
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, reason: "OPPONENT_RIVAL_FIELD_MISSING", diagnostics };
    }
    if (selected !== null && (!Number.isInteger(selected) || selected <= 0)) {
      return { ok: false, reason: "SELECTED_OWN_SCOPE_INVALID", diagnostics };
    }

    const actKeys = scopeKind === "play"
      ? ["current_season_id"]
      : ["target_season_id", "targetSeasonId", "season_id", "seasonId", "act_id", "actId"];
    const modeKeys = ["target_mode_id", "targetModeId", "mode_id", "modeId"];
    const observedAct = optionalScopeInteger(response, actKeys);
    const observedMode = optionalScopeInteger(response, modeKeys);
    diagnostics.observedAct = observedAct.value;
    diagnostics.observedMode = observedMode.value;
    if (observedAct.present && observedAct.value === null) {
      return { ok: false, reason: "ACT_SCOPE_INVALID", diagnostics };
    }
    if (observedMode.present && observedMode.value === null) {
      return { ok: false, reason: "MODE_SCOPE_INVALID", diagnostics };
    }
    if (scopeKind === "play" && expectedAct !== null && !observedAct.present) {
      return { ok: false, reason: "ACT_SCOPE_MISSING", diagnostics };
    }
    if (expectedAct !== null && observedAct.present && observedAct.value !== expectedAct) {
      return { ok: false, reason: "ACT_SCOPE_MISMATCH", diagnostics };
    }
    if (expectedMode !== null && observedMode.present && observedMode.value !== expectedMode) {
      return { ok: false, reason: "MODE_SCOPE_MISMATCH", diagnostics };
    }
    const outerById = new Map();
    const normalizedOuter = [];
    for (const outer of rows) {
      const characterId = outer?.character_id;
      const rivalRows = outer?.rival_character_win_rates;
      if (!Number.isInteger(characterId) || characterId <= 0 || !Array.isArray(rivalRows)) {
        return { ok: false, reason: "OPPONENT_RIVAL_FIELD_INVALID", diagnostics };
      }
      if (outerById.has(characterId)) {
        return { ok: false, reason: "DUPLICATE_OWN_CHARACTER_ID", diagnostics };
      }
      const normalizedRivals = [];
      const rivalIds = new Set();
      for (const rival of rivalRows) {
        const rivalCharacterId = rival?.rival_character_id;
        const label = typeof rival?.rival_character_name === "string"
          ? rival.rival_character_name.trim()
          : "";
        const matches = rival?.battle_count;
        const wins = rival?.win_count;
        if (
          !Number.isInteger(rivalCharacterId) || rivalCharacterId <= 0 ||
          !label || !Number.isInteger(matches) || matches < 0 ||
          !Number.isInteger(wins) || wins < 0
        ) {
          return { ok: false, reason: "OPPONENT_RIVAL_ROW_INVALID", diagnostics };
        }
        if (wins > matches) {
          return { ok: false, reason: "OPPONENT_RIVAL_WINS_EXCEED_MATCHES", diagnostics };
        }
        if (rivalIds.has(rivalCharacterId)) {
          return { ok: false, reason: "DUPLICATE_RIVAL_CHARACTER_ID", diagnostics };
        }
        rivalIds.add(rivalCharacterId);
        diagnostics.nestedRowCount += 1;
        normalizedRivals.push({ rivalCharacterId, label, matches, wins });
      }
      const normalizedOuterRow = { characterId, rivals: normalizedRivals };
      outerById.set(characterId, normalizedOuterRow);
      normalizedOuter.push(normalizedOuterRow);
    }
    diagnostics.outerUniqueCount = outerById.size;

    if (expectedCharacterIds) {
      const expected = new Set(expectedCharacterIds);
      const actual = new Set(outerById.keys());
      const missing = sortedIds([...expected].filter((id) => !actual.has(id)));
      const unexpected = sortedIds([...actual].filter((id) => !expected.has(id)));
      if (missing.length || unexpected.length) {
        return {
          ok: false,
          reason: "OPPONENT_OWN_CHARACTER_ID_SET_MISMATCH",
          diagnostics: { ...diagnostics, missingOwnIds: missing.length, unexpectedOwnIds: unexpected.length },
        };
      }
    }

    if (selected !== null && !outerById.has(selected)) {
      return { ok: false, reason: "SELECTED_OWN_CHARACTER_ROW_MISSING", diagnostics };
    }
    const selectedOuter = selected === null
      ? (outerById.has(AGGREGATE_CHARACTER_ID)
        ? [outerById.get(AGGREGATE_CHARACTER_ID)]
        : normalizedOuter)
      : [outerById.get(selected)];
    const rowsByRival = new Map();
    let aggregateRival = null;
    for (const outer of selectedOuter) {
      for (const rival of outer.rivals) {
        if (rival.rivalCharacterId === AGGREGATE_CHARACTER_ID) {
          diagnostics.aggregateRivalObserved = true;
          if (aggregateRival && (
            aggregateRival.matches !== rival.matches ||
            aggregateRival.wins !== rival.wins ||
            aggregateRival.label !== rival.label
          )) {
            return { ok: false, reason: "AGGREGATE_RIVAL_CONFLICT", diagnostics };
          }
          aggregateRival = rival;
          continue;
        }
        const entry = rowsByRival.get(rival.rivalCharacterId) ?? {
          characterId: rival.rivalCharacterId,
          label: rival.label,
          matches: 0,
          wins: 0,
        };
        if (entry.label !== rival.label) {
          return { ok: false, reason: "LOCALE_NAME_CONFLICT", diagnostics };
        }
        entry.matches += rival.matches;
        entry.wins += rival.wins;
        rowsByRival.set(rival.rivalCharacterId, entry);
      }
    }

    const rivalRows = [...rowsByRival.values()].map((row) => ({
      ...row,
      winRate: row.matches > 0 ? (row.wins / row.matches) * 100 : 0,
    }));
    const rivalChecksum = rivalRows.reduce(
      (total, row) => ({
        matches: total.matches + row.matches,
        wins: total.wins + row.wins,
      }),
      { matches: 0, wins: 0 },
    );
    const selfChecksum = expectedSelfRows
      ? checksumForScope(expectedSelfRows, selectedOwnCharacterId)
      : null;
    diagnostics.selfChecksum = selfChecksum;
    diagnostics.rivalChecksum = rivalChecksum;
    diagnostics.aggregateMismatch = Boolean(selfChecksum && (
      selfChecksum.matches !== rivalChecksum.matches ||
      selfChecksum.wins !== rivalChecksum.wins
    ));

    // The official two-axis response may omit an aggregate rival entry. In
    // that case ALL is the sum of the selected rival rows in this scope;
    // selfChecksum remains diagnostic only and never supplies the displayed
    // ALL value.
    const selfScopeRow = Array.isArray(expectedSelfRows)
      ? expectedSelfRows.find((row) => Number(row?.characterId) === (
        selected == null ? AGGREGATE_CHARACTER_ID : selected
      ))
      : null;
    const aggregateSelfRow = Array.isArray(expectedSelfRows)
      ? expectedSelfRows.find((row) => Number(row?.characterId) === AGGREGATE_CHARACTER_ID)
      : null;
    const aggregateRow = aggregateRival
      ? {
          characterId: AGGREGATE_CHARACTER_ID,
          label: aggregateRival.label,
          matches: aggregateRival.matches,
          wins: aggregateRival.wins,
          winRate: aggregateRival.matches > 0
            ? (aggregateRival.wins / aggregateRival.matches) * 100
            : 0,
        }
      : (rivalRows.length || selfChecksum) && (aggregateSelfRow?.label ?? selfScopeRow?.label)
        ? {
            characterId: AGGREGATE_CHARACTER_ID,
            label: aggregateSelfRow?.label ?? selfScopeRow.label,
            matches: rivalChecksum.matches,
            wins: rivalChecksum.wins,
            winRate: rivalChecksum.matches > 0
              ? (rivalChecksum.wins / rivalChecksum.matches) * 100
              : 0,
          }
        : null;
    if (aggregateRow) {
      diagnostics.aggregateRowSource = aggregateRival ? "rival" : "self_checksum";
      rivalRows.unshift(aggregateRow);
    }
    diagnostics.displayRowCount = rivalRows.length;

    return {
      ok: true,
      rows: rivalRows,
      diagnostics,
      responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
    };
  }

  // The official PLAY snapshot is also the locale-scoped character-name
  // registry. This projection intentionally discards matches and wins so the
  // opponent-character UI cannot mistake self-character usage statistics for
  // opponent statistics.
  function buildOfficialCharacterNameMap(rows) {
    const map = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const characterId = Number(row?.characterId);
      const label = String(row?.label ?? "").trim();
      if (!Number.isInteger(characterId) || characterId <= 0 || !label) return null;
      if (map[characterId] && map[characterId] !== label) return null;
      map[characterId] = label;
    }
    return Object.keys(map).length ? map : null;
  }

  function aggregateOfficialCharacterWinRates(modeResults, {
    profileId = null,
    locale = "",
    act = null,
    retrievedAt = null,
    generation = null,
  } = {}) {
    const results = Array.isArray(modeResults) ? modeResults : [];
    const byMode = new Map();
    const duplicateModes = new Set();
    for (const result of results) {
      const mode = Number(result?.mode);
      if (byMode.has(mode)) duplicateModes.add(mode);
      else byMode.set(mode, result);
    }
    const scopeMismatchReason = (result, mode) => {
      if (!result || result.valid !== true) return result?.reason ?? "MODE_RESULT_MISSING";
      if (Number(result.mode) !== mode) return "MODE_MISMATCH";
      if (!Array.isArray(result.rows)) return "MODE_ROWS_MISSING";
      const diagnostics = result.diagnostics;
      if (Number(diagnostics?.mode) !== mode) return "MODE_MISMATCH";
      if (Number(diagnostics?.act) !== Number(act)) return "ACT_MISMATCH";
      if (Number(diagnostics?.generation) !== Number(generation)) return "GENERATION_MISMATCH";
      return null;
    };
    const modes = ALLOWED_MODES.map((mode) => {
      const result = byMode.get(mode);
      const reason = duplicateModes.has(mode)
        ? "DUPLICATE_MODE_RESULT"
        : scopeMismatchReason(result, mode);
      return !reason
        ? {
            mode,
            status: "valid",
            retryable: false,
            diagnostics: result.diagnostics ?? null,
          }
        : {
            mode,
            status: "invalid",
            reason,
            retryable: result?.retryable === true,
            diagnostics: result?.diagnostics ?? null,
          };
    });
    if (modes.some((mode) => mode.status !== "valid")) {
      return {
        status: "partial",
        source: "official_profile_play",
        profileId: profileId == null ? null : String(profileId),
        locale: String(locale ?? ""),
        act: Number.isInteger(Number(act)) ? Number(act) : null,
        retrievedAt: Number.isFinite(Number(retrievedAt)) ? Number(retrievedAt) : null,
        generation: Number.isInteger(Number(generation)) ? Number(generation) : null,
        modes,
        retryable: modes.some((mode) => mode.retryable === true),
        rows: [],
      };
    }

    const rowsById = new Map();
    for (const mode of ALLOWED_MODES) {
      const result = byMode.get(mode);
      for (const row of result.rows) {
        const entry = rowsById.get(row.characterId) ?? {
          characterId: row.characterId,
          label: row.label,
          matches: 0,
          wins: 0,
        };
        if (entry.label !== row.label) {
          return {
            status: "partial",
            source: "official_profile_play",
            profileId: profileId == null ? null : String(profileId),
            locale: String(locale ?? ""),
            act: Number.isInteger(Number(act)) ? Number(act) : null,
            retrievedAt: Number.isFinite(Number(retrievedAt)) ? Number(retrievedAt) : null,
            generation: Number.isInteger(Number(generation)) ? Number(generation) : null,
            modes,
            retryable: false,
            rows: [],
            reason: "LOCALE_NAME_CONFLICT",
          };
        }
        entry.matches += row.matches;
        entry.wins += row.wins;
        rowsById.set(row.characterId, entry);
      }
    }

    return {
      status: "ready",
      source: "official_profile_play",
      profileId: profileId == null ? null : String(profileId),
      locale: String(locale ?? ""),
      act: Number.isInteger(Number(act)) ? Number(act) : null,
      retrievedAt: Number.isFinite(Number(retrievedAt)) ? Number(retrievedAt) : null,
      generation: Number.isInteger(Number(generation)) ? Number(generation) : null,
      modes,
      retryable: false,
      rows: [...rowsById.values()].map((row) => ({
        ...row,
        winRate: row.matches > 0 ? (row.wins / row.matches) * 100 : 0,
    })),
    };
  }

  function replayFingerprint(record) {
    return JSON.stringify([
      record?.replayId ?? null,
      record?.actId ?? null,
      record?.matchType ?? null,
      record?.battleType ?? null,
      record?.characterId ?? null,
      record?.opponentCharacterId ?? null,
      record?.result ?? null,
      record?.uploadedAt ?? null,
      record?.playedAt ?? null,
      record?.ownUserCode ?? null,
      record?.opponentUserCode ?? null,
      record?.battleTypeName ?? null,
      record?.opponentBattleInputType ?? null,
      record?.roundResults ?? null,
    ]);
  }

  function aggregateBattlelogOpponentCharacterStats(records, {
    act = null,
    selectedOwnCharacterId = null,
    labels = {},
  } = {}) {
    const expectedAct = Number(act);
    const selectedOwn = selectedOwnCharacterId == null || String(selectedOwnCharacterId) === "all"
      ? null
      : Number(selectedOwnCharacterId);
    const diagnostics = {
      recordCount: Array.isArray(records) ? records.length : 0,
      validRecordCount: 0,
      excludedRecordCount: 0,
      duplicateExactCount: 0,
      duplicatePageCount: 0,
      duplicateConflictCount: 0,
      missingRequiredCount: 0,
      actMismatchCount: 0,
      unknownModeCount: 0,
      missingLabelCount: 0,
      reasons: [],
    };
    const seen = new Map();
    const rowsByOpponent = new Map();
    const checksumByMode = new Map(
      MATCH_TYPES.map((matchType) => [matchType, new Map()]),
    );
    const addReason = (reason) => {
      if (!diagnostics.reasons.includes(reason)) diagnostics.reasons.push(reason);
    };

    for (const record of Array.isArray(records) ? records : []) {
      const replayId = String(record?.replayId ?? "").trim();
      const fingerprint = replayFingerprint(record);
      if (replayId && seen.has(replayId)) {
        const previous = seen.get(replayId);
        if (previous.fingerprint === fingerprint) {
          diagnostics.duplicateExactCount += 1;
          if (previous.page != null && Number(record?.__sourcePage) !== previous.page) {
            diagnostics.duplicatePageCount += 1;
          }
        }
        else {
          diagnostics.duplicateConflictCount += 1;
          addReason("DUPLICATE_REPLAY_CONFLICT");
        }
        continue;
      }
      if (replayId) seen.set(replayId, {
        fingerprint,
        page: Number(record?.__sourcePage) || null,
      });

      const matchType = String(record?.matchType ?? "");
      const recordAct = Number(record?.actId);
      const ownCharacterId = Number(record?.characterId);
      const opponentCharacterId = Number(record?.opponentCharacterId);
      const result = String(record?.result ?? "");
      const requiredValid = Boolean(replayId) &&
        Number.isInteger(recordAct) && recordAct > 0 &&
        Number.isInteger(ownCharacterId) && ownCharacterId > 0 &&
        Number.isInteger(opponentCharacterId) && opponentCharacterId > 0 &&
        ["win", "loss", "draw"].includes(result);
      if (!requiredValid) {
        diagnostics.missingRequiredCount += 1;
        addReason("REQUIRED_REPLAY_FIELD_INVALID");
        continue;
      }
      if (recordAct !== expectedAct) {
        diagnostics.actMismatchCount += 1;
        addReason("ACT_MISMATCH");
        continue;
      }
      if (matchType === "room") {
        diagnostics.excludedRecordCount += 1;
        continue;
      }
      if (!MATCH_TYPES.includes(matchType)) {
        diagnostics.unknownModeCount += 1;
        addReason("UNKNOWN_MATCH_TYPE");
        continue;
      }
      diagnostics.validRecordCount += 1;

      const ownChecksum = checksumByMode.get(matchType);
      const ownEntry = ownChecksum.get(ownCharacterId) ?? { matches: 0, wins: 0 };
      ownEntry.matches += 1;
      if (result === "win") ownEntry.wins += 1;
      ownChecksum.set(ownCharacterId, ownEntry);

      if (selectedOwn != null && ownCharacterId !== selectedOwn) continue;
      const label = String(labels?.[opponentCharacterId] ?? "").trim();
      if (!label) {
        diagnostics.missingLabelCount += 1;
        addReason("OPPONENT_LABEL_MISSING");
        continue;
      }
      const entry = rowsByOpponent.get(opponentCharacterId) ?? {
        characterId: opponentCharacterId,
        label,
        matches: 0,
        wins: 0,
      };
      entry.matches += 1;
      if (result === "win") entry.wins += 1;
      rowsByOpponent.set(opponentCharacterId, entry);
    }

    const hasInvalid = diagnostics.duplicateConflictCount > 0 ||
      diagnostics.missingRequiredCount > 0 || diagnostics.actMismatchCount > 0 ||
      diagnostics.unknownModeCount > 0 || diagnostics.missingLabelCount > 0;
    return {
      ok: !hasInvalid && diagnostics.validRecordCount > 0,
      rows: [...rowsByOpponent.values()].map((entry) => ({
        ...entry,
        winRate: entry.matches > 0 ? (entry.wins / entry.matches) * 100 : 0,
      })),
      checksums: Object.fromEntries(
        [...checksumByMode.entries()].map(([mode, values]) => [
          mode,
          Object.fromEntries([...values.entries()].map(([id, value]) => [String(id), value])),
        ]),
      ),
      diagnostics,
      reason: hasInvalid
        ? diagnostics.reasons[0] ?? "REPLAY_DATA_INCOMPLETE"
        : diagnostics.validRecordCount === 0 ? "NO_VALID_REPLAYS" : null,
    };
  }

  function sortOfficialOpponentCharacterStats(entries, options = {}) {
    const sortKey = options.key === "winRate" ? "winRate" : "matches";
    const direction = options.direction === "asc" ? 1 : -1;
    return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
      const matches = Number(left?.matches) - Number(right?.matches);
      const winRate = Number(left?.winRate) - Number(right?.winRate);
      if (sortKey === "winRate") {
        if (winRate) return winRate * direction;
        if (matches) return matches * -1;
      } else {
        if (matches) return matches * direction;
        if (winRate) return winRate * -1;
      }
      return String(left?.label ?? "").localeCompare(String(right?.label ?? ""));
    });
  }

  const api = {
    AGGREGATE_CHARACTER_ID,
    ALLOWED_MODES,
    MATCH_TYPES,
    OFFICIAL_MODE_TO_MATCH_TYPE,
    aggregateOfficialCharacterWinRates,
    aggregateBattlelogOpponentCharacterStats,
    buildOfficialCharacterNameMap,
    buildOfficialCharacterStatsCacheKey,
    buildOfficialCharacterStatsRequestKey,
    isRetryableOfficialCharacterStatsReason,
    summarizeOfficialOpponentCharacterStatsRows,
    sortOfficialOpponentCharacterStats,
    validateOfficialOpponentCharacterWinRates,
    validateOfficialCharacterWinRates,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.matchOfficialOpponentCharacterStats = api;
})(typeof globalThis !== "undefined" ? globalThis : null);
