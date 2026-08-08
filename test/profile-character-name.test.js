"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeProfilePlayer } = require("../src/source-client");

function syntheticProfile(characterNames) {
  return {
    pageProps: {
      synthetic_profile: {
        characters: characterNames.map(
          ({ id, name, mr = null, mrRank = null, lp = null }) => ({
          character_id: id,
          character_display_name: name,
          league_info: {
            master_rating: mr,
            master_rating_ranking: mrRank,
            league_point: lp,
          },
          }),
        ),
      },
    },
  };
}

test("Japanese and English official profile names are preserved verbatim", () => {
  const fallback = { characterId: 26 };
  const japanese = normalizeProfilePlayer(
    syntheticProfile([{ id: 26, name: "豪鬼", mr: 1510 }]),
    fallback,
  );
  const english = normalizeProfilePlayer(
    syntheticProfile([{ id: 26, name: "AKUMA", mr: 1510 }]),
    fallback,
  );
  assert.equal(japanese.characterDisplayName, "豪鬼");
  assert.equal(english.characterDisplayName, "AKUMA");
});

test("character id matching prevents another character name from leaking", () => {
  const profile = syntheticProfile([
    { id: 1, name: "SYNTHETIC ALPHA", mr: 1400 },
    { id: 26, name: "AKUMA", mr: 1510 },
    { id: 9, name: "SYNTHETIC BETA", lp: 18000 },
  ]);
  assert.equal(
    normalizeProfilePlayer(profile, { characterId: 26 }).characterDisplayName,
    "AKUMA",
  );
  assert.equal(
    normalizeProfilePlayer(profile, { characterId: 9 }).characterDisplayName,
    "SYNTHETIC BETA",
  );
});

test("a profile without the selected character never substitutes another name", () => {
  const profile = syntheticProfile([
    { id: 1, name: "SYNTHETIC ALPHA", mr: 1400 },
  ]);
  const result = normalizeProfilePlayer(profile, {
    characterId: 26,
    characterDisplayName: "SYNTHETIC PREVIOUS",
  });
  assert.equal(result, null);
});

test("the selected character keeps its exact official MR ranking", () => {
  const profile = syntheticProfile([
    { id: 1, name: "SYNTHETIC ALPHA", mr: 1600, mrRank: 111 },
    { id: 26, name: "AKUMA", mr: 1510, mrRank: 222 },
  ]);
  const result = normalizeProfilePlayer(profile, { characterId: 26 });
  assert.equal(result.mr, 1510);
  assert.equal(result.mrRank, 222);
});

test("another character's MR ranking is never substituted", () => {
  const profile = syntheticProfile([
    { id: 1, name: "SYNTHETIC ALPHA", mr: 1600, mrRank: 111 },
  ]);
  const result = normalizeProfilePlayer(profile, {
    characterId: 26,
    mr: 1510,
    mrRank: 999,
  });
  assert.equal(result, null);
});

test("an LP character never retains an MR ranking", () => {
  const profile = syntheticProfile([
    { id: 9, name: "SYNTHETIC BETA", lp: 18000 },
  ]);
  const result = normalizeProfilePlayer(profile, {
    characterId: 9,
    mr: 1510,
    mrRank: 999,
  });
  assert.equal(result.mr, null);
  assert.equal(result.mrRank, null);
  assert.equal(result.lp, 18000);
});
