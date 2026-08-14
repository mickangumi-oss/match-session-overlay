"use strict";

function suggestedInitialLocale(systemLocale) {
  return /^ja(?:-|$)/i.test(String(systemLocale ?? "").trim()) ? "ja-jp" : "en";
}

module.exports = { suggestedInitialLocale };
