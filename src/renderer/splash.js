"use strict";

const quotes = globalThis.MATCH_SESSION_SPLASH_QUOTES ?? [];
const storageKey = "match-session-overlay:splash-quote-order:v1";

function shuffledIds(ids) {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const target = Math.floor(random * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}
function nextQuote() {
  if (!quotes.length) return null;
  const knownIds = new Set(quotes.map(({ id }) => id));
  let state = {};
  try {
    state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    state = {};
  }
  let remaining = Array.isArray(state.remaining)
    ? state.remaining.filter((id) => knownIds.has(id))
    : [];
  if (!remaining.length) {
    remaining = shuffledIds([...knownIds]);
    if (remaining.length > 1 && remaining.at(-1) === state.last) {
      [remaining[0], remaining[remaining.length - 1]] = [
        remaining[remaining.length - 1],
        remaining[0],
      ];
    }
  }
  const id = remaining.pop();
  localStorage.setItem(storageKey, JSON.stringify({ remaining, last: id }));
  return quotes.find((quote) => quote.id === id) ?? quotes[0];
}

const quote = nextQuote();
if (quote) {
  const original = document.querySelector("#splashQuoteOriginal");
  const translation = document.querySelector("#splashQuoteTranslation");
  original.textContent = quote.original;
  translation.textContent = quote.translation;
  document.documentElement.lang = quote.originalLanguage === "ja" ? "ja" : "en";
}
