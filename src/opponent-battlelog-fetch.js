"use strict";

/**
 * Fetch and validate the complete Act-scoped battle log used by the opponent
 * character statistics panel. The transport and generation checks are injected
 * so the production path and its failure modes can be tested independently.
 */
async function fetchCompleteBattlelogForAct({
  profileId,
  locale,
  act,
  generation,
  selectedOwnCharacterId = "all",
  requestToken = null,
  fetchPage,
  assertGeneration = () => {},
  publishProgress = () => {},
  safeMaxPages = 100,
  concurrency = 3,
} = {}) {
  const diagnostics = {
    totalPages: null,
    completedPages: 0,
    fetchedCount: 0,
    reasons: [],
  };
  const addReason = (reason) => {
    if (!diagnostics.reasons.includes(reason)) diagnostics.reasons.push(reason);
  };
  const validatePage = (result, page, expectedTotalPages = null) => {
    const totalPages = Number(result?.totalPages);
    if (expectedTotalPages != null && totalPages !== expectedTotalPages) {
      addReason("TOTAL_PAGE_CHANGED");
    }
    if (result?.responsePage !== page) addReason("PAGE_NUMBER_MISSING_OR_MISMATCH");
    if (!result?.hasReplayList) addReason("REPLAY_LIST_MISSING");
    if (result?.normalizedCount !== result?.rawCount) {
      addReason("REPLAY_NORMALIZATION_INCOMPLETE");
    }
    const actEvidence = result?.responseActId ?? result?.recordActId;
    if (actEvidence !== act) addReason("ACT_METADATA_MISSING_OR_MISMATCH");
  };
  const first = await fetchPage({ profileId, page: 1, locale, act });
  assertGeneration(generation);
  const totalPages = Number(first?.totalPages);
  diagnostics.totalPages = Number.isInteger(totalPages) && totalPages > 0
    ? totalPages
    : null;
  if (!diagnostics.totalPages) addReason("TOTAL_PAGE_INVALID");
  else if (diagnostics.totalPages > safeMaxPages) addReason("TOTAL_PAGE_LIMIT_EXCEEDED");
  validatePage(first, 1);
  diagnostics.completedPages = 1;
  diagnostics.fetchedCount = Number(first?.rawCount) || 0;
  publishProgress({
    profileId,
    locale,
    act,
    selectedOwnCharacterId,
    requestToken,
    page: diagnostics.completedPages,
    totalPages: diagnostics.totalPages ?? 0,
    fetchedCount: diagnostics.fetchedCount,
  });
  if (diagnostics.reasons.length) {
    return { ok: false, diagnostics, records: [] };
  }

  let nextPage = 2;
  const worker = async () => {
    while (true) {
      const page = nextPage;
      nextPage += 1;
      if (page > totalPages) return;
      const result = await fetchPage({ profileId, page, locale, act });
      assertGeneration(generation);
      validatePage(result, page, totalPages);
      pageResults.set(page, result);
      diagnostics.completedPages += 1;
      diagnostics.fetchedCount += Number(result?.rawCount) || 0;
      publishProgress({
        profileId,
        locale,
        act,
        selectedOwnCharacterId,
        requestToken,
        page: diagnostics.completedPages,
        totalPages,
        fetchedCount: diagnostics.fetchedCount,
      });
    }
  };
  const pageResults = new Map([[1, first]]);
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(0, totalPages - 1)) },
      () => worker(),
    ),
  );
  const records = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const result = pageResults.get(page);
    if (!result) addReason("PAGE_MISSING");
    else {
      for (const record of Array.isArray(result.replays) ? result.replays : []) {
        records.push({ ...record, __sourcePage: page });
      }
    }
  }
  return {
    ok: diagnostics.reasons.length === 0 && diagnostics.completedPages === totalPages,
    diagnostics,
    records,
  };
}

module.exports = { fetchCompleteBattlelogForAct };
