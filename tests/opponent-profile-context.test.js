const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectProfileContextCandidates,
  normalizeOpponentProfileContext,
  setBoundedCacheEntry,
} = require("../src/opponent-profile-context");
const { normalizeProfilePlayer } = require("../src/source-client");

function profilePayload() {
  return {
    pageProps: {
      currentAct: { id: 7, name: "Act 7", is_current: true },
      characters: [
        {
          character_id: 11,
          character_name: "Target",
          league_info: { master_rating: 1880 },
          master_rating_peak: 1920,
        },
        {
          character_id: 22,
          character_name: "Other",
          league_info: { master_rating: 2140 },
          master_rating_peak: 2210,
        },
        {
          character_id: 33,
          character_name: "Past Act",
          act: { id: 6, name: "Act 6" },
          master_rating: 2999,
          master_rating_peak: 3100,
        },
      ],
    },
  };
}

test("uses only explicitly current Act candidates and pairs other character with its value", () => {
  const result = normalizeOpponentProfileContext(profilePayload(), {
    profileId: "12345678",
    characterId: 11,
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.act, { id: "7", label: "Act 7" });
  assert.deepEqual(result.targetCharacter.peakRating, { value: 1920, type: "MR" });
  assert.deepEqual(result.targetCharacter.currentRating, { value: 1880, type: "MR" });
  assert.deepEqual(result.otherCharacter, {
    characterId: 22,
    characterDisplayName: "Other",
    rating: 2210,
    ratingType: "MR",
    ratingKind: "peak",
    act: "7",
  });
});

test("does not display values when the payload has no explicit current Act", () => {
  const result = normalizeOpponentProfileContext(
    { pageProps: { characters: [{ character_id: 22, character_name: "Other", master_rating: 2140 }] } },
    { characterId: 11 },
  );
  assert.equal(result.status, "empty");
  assert.equal(result.act, null);
  assert.equal(result.targetCharacter.currentRating, null);
  assert.equal(result.otherCharacter, null);
});

test("does not let a past-Act high value replace the current-Act target", () => {
  const payload = profilePayload();
  payload.pageProps.characters.push({
    character_id: 11,
    character_name: "Target Past Snapshot",
    act: { id: 6, name: "Act 6" },
    master_rating: 3999,
    master_rating_peak: 4999,
  });
  const result = normalizeOpponentProfileContext(payload, { characterId: 11 });
  assert.deepEqual(result.targetCharacter.currentRating, { value: 1880, type: "MR" });
  assert.deepEqual(result.targetCharacter.peakRating, { value: 1920, type: "MR" });
  assert.notEqual(result.otherCharacter?.characterId, 33);
});

test("keeps MR and LP separate and uses current value only when no peak is explicit", () => {
  const payload = {
    currentAct: { id: 7, name: "Act 7", is_current: true },
    characters: [
      { character_id: 11, character_name: "Target", league_info: { league_point: 5000 } },
      { character_id: 22, character_name: "Other LP", league_info: { league_point: 6400 } },
      { character_id: 44, character_name: "Other MR", league_info: { master_rating: 2400 }, master_rating_peak: 2500 },
    ],
  };
  const result = normalizeOpponentProfileContext(payload, { characterId: 11 });
  assert.deepEqual(result.targetCharacter.currentRating, { value: 5000, type: "LP" });
  assert.equal(result.targetCharacter.peakRating, null);
  assert.deepEqual(result.otherCharacter, {
    characterId: 22,
    characterDisplayName: "Other LP",
    rating: 6400,
    ratingType: "LP",
    ratingKind: "current",
    act: "7",
  });
  assert.equal(result.otherCharacter.ratingType, "LP");
});

test("bounds recursive candidate collection", () => {
  const { candidates } = collectProfileContextCandidates(profilePayload());
  assert.ok(candidates.length > 0);
  assert.ok(candidates.length <= 400);
});

test("bounds profile context cache entries and refreshes recency", () => {
  const cache = new Map();
  setBoundedCacheEntry(cache, "a", 1, 2);
  setBoundedCacheEntry(cache, "b", 2, 2);
  setBoundedCacheEntry(cache, "a", 3, 2);
  setBoundedCacheEntry(cache, "c", 4, 2);
  assert.deepEqual([...cache.entries()], [["a", 3], ["c", 4]]);
});

test("normal profile parsing retains current Act and character/rating tuples", () => {
  const player = normalizeProfilePlayer(profilePayload(), {
    profileId: "12345678",
    characterId: 11,
    mr: 1800,
  });
  assert.deepEqual(player.profileAct, { id: "7", label: "Act 7" });
  assert.deepEqual(
    player.profileCharacterRatings.map((entry) => [
      entry.characterId,
      entry.characterDisplayName,
      entry.currentMr,
      entry.peakMr,
      entry.act.id,
    ]),
    [
      [11, "Target", 1880, 1920, "7"],
      [22, "Other", 2140, 2210, "7"],
    ],
  );
});
