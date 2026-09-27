"use strict";

const { performance } = require("node:perf_hooks");

const STAGES = new Set([
  "import.start", "import.page_done", "import.pages_done", "import.merge_done",
  "import.persist_scheduled", "import.flush_settled", "import.summary_sent",
  "import.player_started", "import.player_done", "import.store_loaded",
  "import.context_started", "import.context_done", "import.context_cache", "import.first_page_requested",
  "import.profile_refresh_started", "import.profile_refresh_done", "import.profile_coverage_done",
  "import.act_verify_started", "import.act_verify_done", "import.merge_started",
  "history.self.cache", "history.self.page_done", "history.self.done",
  "history.opponent.cache", "history.opponent.page_done", "history.opponent.done",
  "context.play_started", "context.play_done", "context.histories_started",
  "context.histories_done", "context.profile_peak_done", "context.result_sent",
]);

function createTimingLog({ enabled = false, dev = false, capacity = 128, output = console.log } = {}) {
  const entries = [];
  function record(stage, count = 0) {
    if (!STAGES.has(stage)) return;
    const entry = { atMs: performance.now(), stage, count: Math.min(1000, Math.max(0, Math.floor(Number(count) || 0))) };
    entries.push(entry);
    if (entries.length > capacity) entries.shift();
    if (enabled && dev) output(JSON.stringify({ timing: entries }));
  }
  return { record, snapshot: () => entries.map((entry) => ({ ...entry })) };
}

module.exports = { createTimingLog };
