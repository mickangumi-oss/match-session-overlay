"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ServiceRequestScheduler } = require("../src/service-request-scheduler");

test("the default scheduler remains single-filed", async () => {
  const scheduler = new ServiceRequestScheduler({ minStartGapMs: 0 });
  let active = 0;
  let maximum = 0;
  const task = () => new Promise((resolve) => {
    active += 1;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active -= 1;
      resolve();
    }, 5);
  });

  await Promise.all([scheduler.enqueue(task), scheduler.enqueue(task)]);
  assert.equal(maximum, 1);
});

test("requests remain queued during the minimum start gap", async () => {
  const scheduler = new ServiceRequestScheduler({ minStartGapMs: 20 });
  const started = [];
  const first = scheduler.enqueue(() => {
    started.push("first");
    return "first";
  }, { priority: "auth" });
  const second = scheduler.enqueue(() => {
    started.push("second");
    return "second";
  }, { priority: "auth" });

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("queued request did not start after the minimum gap")),
      250,
    );
  });
  try {
    assert.equal(await first, "first");
    assert.equal(await Promise.race([second, timeout]), "second");
  } finally {
    clearTimeout(timeoutId);
  }
  assert.deepEqual(started, ["first", "second"]);
});

test("explicitly concurrent work is capped without changing priority semantics", async () => {
  const scheduler = new ServiceRequestScheduler({
    minStartGapMs: 0,
    maxConcurrent: 3,
  });
  let active = 0;
  let maximum = 0;
  const releases = [];
  const task = () => new Promise((resolve) => {
    active += 1;
    maximum = Math.max(maximum, active);
    releases.push(() => {
      active -= 1;
      resolve();
    });
  });

  const requests = Array.from({ length: 5 }, () =>
    scheduler.enqueue(task, {
      priority: "history",
      scope: "history",
      allowConcurrent: true,
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 3);
  assert.equal(scheduler.activeRequests.length, 3);
  releases.splice(0, 3).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  await Promise.all(requests);
  assert.equal(maximum, 3);
});

test("an explicit zero start gap lets ten history requests begin together", async () => {
  const scheduler = new ServiceRequestScheduler({
    minStartGapMs: 20,
    maxConcurrent: 10,
  });
  const started = [];
  const releases = [];
  const requests = Array.from({ length: 10 }, (_, index) =>
    scheduler.enqueue(
      () => {
        started.push(index + 1);
        return new Promise((resolve) => releases.push(resolve));
      },
      {
        priority: "history",
        scope: "history",
        allowConcurrent: true,
        startGapMs: 0,
      },
    ),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  releases.forEach((release) => release());
  await Promise.all(requests);
});
