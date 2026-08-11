"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRankingRetryController } = require("../src/ranking-retry-controller");

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimer(callback, delayMs) {
      const id = nextId++;
      pending.set(id, { callback, delayMs });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    run(id) {
      const timer = pending.get(id);
      if (!timer) return false;
      pending.delete(id);
      timer.callback();
      return true;
    },
  };
}

test("ranking retry controller replaces duplicate scope timers and runs once", () => {
  const clock = fakeTimers();
  const controller = createRankingRetryController(clock);
  const events = [];
  controller.schedule("same-scope", 5_000, () => events.push("old"));
  const oldId = [...clock.pending.keys()][0];
  controller.schedule("same-scope", 15_000, () => events.push("new"));
  const newId = [...clock.pending.keys()][0];

  assert.equal(clock.pending.size, 1);
  assert.equal(clock.run(oldId), false);
  assert.equal(clock.run(newId), true);
  assert.deepEqual(events, ["new"]);
  assert.equal(controller.size(), 0);
});

test("ranking retry controller cancels one or every pending official request", () => {
  const clock = fakeTimers();
  const controller = createRankingRetryController(clock);
  let calls = 0;
  controller.schedule("all", 5_000, () => { calls += 1; });
  controller.schedule("country", 5_000, () => { calls += 1; });
  controller.clear("all");
  assert.equal(controller.has("all"), false);
  assert.equal(controller.has("country"), true);
  controller.clearAll();
  assert.equal(clock.pending.size, 0);
  assert.equal(controller.size(), 0);
  assert.equal(calls, 0);
});
