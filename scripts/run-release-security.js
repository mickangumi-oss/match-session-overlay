"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const securityRoot = path.resolve(root, "..", "_tools", "codex-security");
const stateDirectory = path.join(
  process.env.USERPROFILE || root,
  ".match-session-overlay-security",
);
const cliEntrypoint = path.join(
  securityRoot,
  "cli",
  "node_modules",
  "@openai",
  "codex-security",
  "bin",
  "codex-security.mjs",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const outputDirectory = path.join(
  securityRoot,
  "results",
  "match-session-overlay",
  `v${packageJson.version}`,
);

const options = new Set(process.argv.slice(2));
const supportedOptions = new Set(["--dry-run"]);
for (const option of options) {
  if (!supportedOptions.has(option)) {
    throw new Error(`Unsupported option: ${option}`);
  }
}
const dryRunOnly = options.has("--dry-run");

function isSameOrWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function run(command, args, spawnOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  return result;
}

if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
  throw new Error(`Release version must use SemVer: ${packageJson.version}`);
}
if (!fs.existsSync(cliEntrypoint)) {
  throw new Error(
    `Codex Security CLI is unavailable. Expected: ${cliEntrypoint}`,
  );
}
if (!isSameOrWithin(securityRoot, outputDirectory)) {
  throw new Error(`Security output escaped the tools directory: ${outputDirectory}`);
}
if (isSameOrWithin(root, outputDirectory)) {
  throw new Error(`Security output must be outside the repository: ${outputDirectory}`);
}

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  throw new Error(
    `Codex Security requires Node.js 22.13.0 or later; found ${process.versions.node}`,
  );
}

if (!dryRunOnly) {
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) {
    process.stderr.write(status.stderr || "Unable to inspect the Git worktree.\n");
    process.exit(status.status ?? 2);
  }
  if (status.stdout.trim() !== "") {
    throw new Error(
      "Release security scans require a clean worktree so the result maps to one fixed commit.",
    );
  }
}

const environment = {
  ...process.env,
  CODEX_SECURITY_STATE_DIR: stateDirectory,
};
const commonArguments = [
  cliEntrypoint,
  "scan",
  root,
  "--output-dir",
  outputDirectory,
  "--auth",
  "chatgpt",
];

console.log(`Codex Security target: ${root}`);
console.log(`Codex Security output: ${outputDirectory}`);
console.log("Running credential-free release scan dry-run...");
const dryRun = run(process.execPath, [...commonArguments, "--dry-run"], {
  env: environment,
  stdio: "inherit",
});
if (dryRun.status !== 0) process.exit(dryRun.status ?? 2);

if (dryRunOnly) {
  console.log("Codex Security release scan dry-run passed. No scan was started.");
  process.exit(0);
}

const scanArguments = [
  ...commonArguments,
  "--mode",
  "standard",
  "--headless",
  "--fail-on-severity",
  "medium",
  "--max-cost",
  "5",
  "--codex",
  "features.multi_agent_v2.max_concurrent_threads_per_session=2",
];
if (fs.existsSync(outputDirectory)) scanArguments.push("--archive-existing");

console.log("Running read-only Codex Security release scan...");
const scan = run(process.execPath, scanArguments, {
  env: environment,
  stdio: "inherit",
});
if (scan.status !== 0) {
  console.error(`Codex Security release gate did not pass. Review: ${outputDirectory}`);
  process.exit(scan.status ?? 2);
}

for (const artifact of [
  "scan-manifest.json",
  "findings.json",
  "coverage.json",
  "report.md",
]) {
  const artifactPath = path.join(outputDirectory, artifact);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Codex Security result is incomplete: ${artifactPath}`);
  }
}

const coverage = JSON.parse(
  fs.readFileSync(path.join(outputDirectory, "coverage.json"), "utf8"),
);
if (coverage.completeness !== "complete") {
  throw new Error(
    `Codex Security coverage must be complete; found ${String(coverage.completeness)}`,
  );
}

console.log("Codex Security release gate passed with complete coverage.");
console.log(`Review the report before building: ${path.join(outputDirectory, "report.md")}`);
