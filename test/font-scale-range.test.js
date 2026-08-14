"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("output font-size control accepts thirty through two hundred percent", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");

  assert.match(
    html,
    /id="fontScaleInput" type="range" min="30" max="200" step="5"/,
  );
  assert.equal((main.match(/Math\.max\(0\.3, Number\([^)]*fontScale\)\)/g) ?? []).length, 2);
});

test("graph label scale keeps its independent seventy-five-percent minimum", () => {
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  assert.match(
    html,
    /id="graphLabelScaleInput" type="range" min="75" max="200"/,
  );
});
