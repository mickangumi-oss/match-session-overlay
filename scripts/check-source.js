"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function filesUnder(directory, extensions) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(fullPath, extensions));
    else if (extensions.has(path.extname(entry.name))) result.push(fullPath);
  }
  return result;
}

const javascriptFiles = [
  ...filesUnder(path.join(root, "src"), new Set([".js"])),
  ...filesUnder(path.join(root, "test"), new Set([".js"])),
  ...filesUnder(path.join(root, "scripts"), new Set([".js"])),
].filter((file) => !file.endsWith("visual-fixture.js"));

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of filesUnder(path.join(root, "src", "renderer"), new Set([".css"]))) {
  const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) throw new Error(`CSS closing brace mismatch: ${file}`);
  }
  if (depth !== 0) throw new Error(`CSS brace mismatch: ${file}`);
}

for (const file of filesUnder(path.join(root, "src", "renderer"), new Set([".html"]))) {
  const source = fs.readFileSync(file, "utf8");
  const ids = [...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(`Duplicate DOM ids in ${file}: ${[...new Set(duplicates)].join(", ")}`);
  }
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (
  !readme.includes(`公開版: v${packageJson.version}`) &&
  !readme.includes(`開発版: v${packageJson.version}（未公開・動作確認用）`)
) {
  throw new Error("README public or development version does not match package.json");
}
for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  const target = match[1].split("#")[0];
  if (!/^https?:/i.test(target) && !fs.existsSync(path.resolve(root, target))) {
    throw new Error(`README image not found: ${target}`);
  }
}

const tests = spawnSync(process.execPath, ["--test"], { cwd: root, stdio: "inherit" });
if (tests.status !== 0) process.exit(tests.status ?? 1);

console.log(`Checked ${javascriptFiles.length} JavaScript files, CSS, DOM ids, README images, and tests.`);
