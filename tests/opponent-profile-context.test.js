const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectProfileContextCandidates,
  normalizeOpponentProfileContext,
  setBoundedCacheEntry,
} = require("../src/opponent-profile-context");
const { normalizeProfilePlayer } = require("../src/source-client");
const { selectOtherCharacterPeakMr } = require("../src/opponent-insight");

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

// Shape captured from the official profile page's __NEXT_DATA__: normal
// profile data has current season + character_league_infos, but no peak field.
function officialProfilePayload() {
  return {
    props: {
      pageProps: {
        play: {
          current_season_id: 13,
          character_league_infos: [
            { character_id: 27, character_name: "Target", league_info: { master_rating: 2137 } },
            { character_id: 8, character_name: "Current Other", league_info: { master_rating: 2114 } },
          ],
        },
      },
    },
  };
}

// Shape returned by the official PLAY > character MR > highest endpoint. The
// endpoint's `master_rating` is a peak because this is the highest view;
// the official request sends peak=false and the endpoint supplies the peak.
function officialPeakProfilePayload({ seasonId = 13 } = {}) {
  return {
    response: {
      current_season_id: seasonId,
      character_league_infos: [
        { character_id: 27, character_name: "Target", league_info: { master_rating: 2400 } },
        { character_id: 8, character_name: "Current Other", league_info: { master_rating: 2164 } },
        { character_id: 11, character_name: "Higher Other", league_info: { master_rating: 2222 } },
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

test("context uses the same peak-MR selector as the final display path", () => {
  const payload = profilePayload();
  const result = normalizeOpponentProfileContext(payload, {
    profileId: "12345678",
    characterId: 11,
  });
  const { candidates, explicitCurrentAct } = collectProfileContextCandidates(payload);
  const selected = selectOtherCharacterPeakMr(
    candidates.filter((candidate) => candidate.actKey === explicitCurrentAct.key),
    11,
  );
  assert.deepEqual(result.otherCharacter, {
    characterId: selected.characterId,
    characterDisplayName: selected.characterDisplayName,
    rating: selected.peakMr,
    ratingType: "MR",
    ratingKind: "peak",
    act: result.act.id,
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

test("keeps MR and LP separate while selecting only another character's peak MR", () => {
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
    characterId: 44,
    characterDisplayName: "Other MR",
    rating: 2500,
    ratingType: "MR",
    ratingKind: "peak",
    act: "7",
  });
});

test("does not treat another character's current MR as its peak MR", () => {
  const result = normalizeOpponentProfileContext(
    {
      currentAct: { id: 7, name: "Act 7", is_current: true },
      characters: [
        { character_id: 11, character_name: "Target", league_info: { master_rating: 1880 } },
        { character_id: 22, character_name: "Other", league_info: { master_rating: 2210 } },
      ],
    },
    { characterId: 11 },
  );
  assert.equal(result.otherCharacter, null);
});

test("uses the confirmed highest-MR endpoint shape without treating profile current MR as peak", () => {
  const withoutPeak = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
  });
  assert.equal(withoutPeak.otherCharacter, null);

  const result = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: officialPeakProfilePayload(),
    peakActId: "13",
  });
  assert.deepEqual(result.otherCharacter, {
    characterId: 11,
    characterDisplayName: "Higher Other",
    rating: 2222,
    ratingType: "MR",
    ratingKind: "peak",
    act: "13",
  });
});

test("uses the official character alpha label for peak candidates", () => {
  const result = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: {
      response: {
        current_season_id: 13,
        character_league_infos: [
          { character_id: 27, character_alpha: "Target", league_info: { master_rating: 2400 } },
          { character_id: 8, character_alpha: "Other Alpha", league_info: { master_rating: 2164 } },
        ],
      },
    },
    peakActId: "13",
  });
  assert.deepEqual(result.otherCharacter, {
    characterId: 8,
    characterDisplayName: "Other Alpha",
    rating: 2164,
    ratingType: "MR",
    ratingKind: "peak",
    act: "13",
  });
});

test("excludes target character and rejects a peak response from another Act", () => {
  const result = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: officialPeakProfilePayload({ seasonId: 12 }),
    peakActId: "13",
  });
  assert.equal(result.otherCharacter, null);

  const targetOnly = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: {
      response: {
        current_season_id: 13,
        character_league_infos: [
          { character_id: 27, character_name: "Target", league_info: { master_rating: 9999 } },
        ],
      },
    },
    peakActId: "13",
  });
  assert.equal(targetOnly.otherCharacter, null);
});

test("keeps the dash when the confirmed peak response has no usable MR or Act", () => {
  const noPeak = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: { response: { current_season_id: 13, character_league_infos: [] } },
    peakActId: "13",
  });
  assert.equal(noPeak.otherCharacter, null);

  const noAct = normalizeOpponentProfileContext(
    { props: { pageProps: { play: { character_league_infos: [] } } } },
    {
      characterId: 27,
      peakProfileData: officialPeakProfilePayload(),
      peakActId: null,
    },
  );
  assert.equal(noAct.otherCharacter, null);
});

test("bounds recursive candidate collection", () => {
  const { candidates } = collectProfileContextCandidates(profilePayload());
  assert.ok(candidates.length > 0);
  assert.ok(candidates.length <= 400);
});

test("bounds official peak character entries before mapping", () => {
  const entries = Array.from({ length: 121 }, (_, index) => ({
    character_id: index + 1,
    character_alpha: `Character ${index + 1}`,
    league_info: { master_rating: 1500 + index },
  }));
  const result = normalizeOpponentProfileContext(officialProfilePayload(), {
    characterId: 27,
    peakProfileData: {
      response: { current_season_id: 13, character_league_infos: entries },
    },
    peakActId: "13",
  });
  assert.equal(result.otherCharacter.rating, 1619);
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
