"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ServiceRequestScheduler } = require("../src/service-request-scheduler");

function createFakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    async tick(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort(([, left], [, right]) => left.due - right.due)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        time = timer.due;
        timer.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      time = target;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function createScheduler(clock, options = {}) {
  return new ServiceRequestScheduler({
    minStartGapMs: 1500, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...options,
  });
}

async function tickSteps(clock, count, milliseconds = 1) {
  for (let index = 0; index < count; index += 1) await clock.tick(milliseconds);
}

test("runs one request at a time and preserves the injected start gap", async () => {
  const clock = createFakeClock();
  const scheduler = createScheduler(clock);
  const starts = [];
  let releaseFirst;
  const first = scheduler.enqueue(() => new Promise((resolve) => { releaseFirst = resolve; }), { priority: "history" });
  const second = scheduler.enqueue(() => { starts.push(clock.now()); }, { priority: "live" });
  starts.push(clock.now());
  await clock.tick(5000);
  assert.deepEqual(starts, [0]);
  releaseFirst();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(starts, [0, 5000], "the gap is between starts, not completion and start");
  await Promise.all([first, second]);
});

test("uses documented priority and FIFO within a priority tier", async () => {
  const clock = createFakeClock();
  const scheduler = createScheduler(clock, { minStartGapMs: 1 });
  const order = [];
  for (const [name, priority] of [["history", "history"], ["social", "social"], ["rank-1", "ranking"], ["rank-2", "ranking"], ["interactive", "interactive"], ["auth", "auth"]]) {
    scheduler.enqueue(() => order.push(name), { priority });
  }
  await tickSteps(clock, 10);
  assert.deepEqual(order, ["history", "auth", "interactive", "rank-1", "rank-2", "social"]);
});

test("bounded priority bursts eventually run waiting history work", async () => {
  const clock = createFakeClock();
  const scheduler = createScheduler(clock, { minStartGapMs: 1, maxPriorityBurst: 3 });
  const order = [];
  scheduler.enqueue(() => order.push("first-live"), { priority: "live" });
  scheduler.enqueue(() => order.push("history"), { priority: "history" });
  for (let index = 1; index <= 7; index += 1) scheduler.enqueue(() => order.push(`live-${index}`), { priority: "live" });
  await tickSteps(clock, 20);
  assert.equal(order.indexOf("history"), 3);
  assert.equal(order.length, 9, "every queued task executes exactly once");
});

test("fairness serves every older lower tier while live and history keep arriving", async () => {
  const clock = createFakeClock();
  const scheduler = createScheduler(clock, { minStartGapMs: 1, maxPriorityBurst: 2 });
  const order = [];
  scheduler.enqueue(() => order.push("initial-live"), { priority: "live" });
  scheduler.enqueue(() => order.push("ranking"), { priority: "ranking" });
  scheduler.enqueue(() => order.push("social"), { priority: "social" });
  scheduler.enqueue(() => order.push("history-1"), { priority: "history" });
  scheduler.enqueue(() => order.push("history-2"), { priority: "history" });
  for (let index = 1; index <= 8; index += 1) {
    scheduler.enqueue(() => order.push(`live-${index}`), { priority: "live" });
  }
  await tickSteps(clock, 30);
  assert.ok(order.indexOf("ranking") >= 0 && order.indexOf("ranking") < order.length - 1);
  assert.ok(order.indexOf("social") >= 0 && order.indexOf("social") < order.length - 1);
  assert.ok(order.indexOf("history-1") >= 0 && order.indexOf("history-2") >= 0);
  assert.equal(order.length, 13, "every priority tier completes exactly once per task");
});

test("cancels matching queued scope and generation without interrupting active work", async () => {
  const clock = createFakeClock();
  const scheduler = createScheduler(clock);
  let releaseActive;
  const active = scheduler.enqueue(() => new Promise((resolve) => { releaseActive = resolve; }), { scope: "history", generation: 1 });
  const obsolete = scheduler.enqueue(() => assert.fail("cancelled task ran"), { scope: "history", generation: 1 });
  const current = scheduler.enqueue(() => "current", { scope: "history", generation: 2 });
  assert.equal(scheduler.cancelScope("history", { generation: 1, reason: "History reset" }), 1);
  await assert.rejects(obsolete, { name: "AbortError", message: "History reset" });
  releaseActive();
  await Promise.resolve();
  await clock.tick(1500);
  assert.equal(await current, "current");
  await active;
});
