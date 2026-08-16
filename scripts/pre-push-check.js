"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function run(command, args, label) {
  process.stdout.write(`\n[pre-push] ${label}\n`);
  const useCommandShell = process.platform === "win32" && command === "pnpm";
  const executable = useCommandShell ? process.env.ComSpec || "cmd.exe" : command;
  const commandArgs = useCommandShell ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    if (result.error) process.stderr.write(`${result.error.stack || result.error}\n`);
    process.stderr.write(`[pre-push] STOP: ${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const publishedTests = gitOutput(["ls-files", "test", "test-local"]).trim();
if (publishedTests) {
  process.stderr.write(`[pre-push] STOP: local test files are tracked:\n${publishedTests}\n`);
  process.exit(1);
}

const localPathPattern = new RegExp(["C:", "Users"].join("\\\\") + "\\\\[^\\\\]+", "i");
const privateKeyPattern = new RegExp(["BEGIN", ".*PRIVATE", "KEY"].join("\\s+"), "i");
const bearerPattern = new RegExp(["Bearer", "[A-Za-z0-9._-]{16,}"].join("\\s+"));
for (const relativePath of gitOutput(["ls-files"]).split(/\r?\n/).filter(Boolean)) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath);
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  if ([localPathPattern, privateKeyPattern, bearerPattern].some((pattern) => pattern.test(text))) {
    process.stderr.write(`[pre-push] STOP: possible private material in ${relativePath}\n`);
    process.exit(1);
  }
}

run("pnpm", ["check"], "source checks");
run("pnpm", ["lint"], "ESLint");
run("pnpm", ["qa:local"], "local Electron QA");
if (process.env.MATCH_OVERLAY_PRE_PUSH_SKIP_BUILD !== "1") {
  run("pnpm", ["build"], "Windows installer build");
}
console.log("\n[pre-push] PASS");
