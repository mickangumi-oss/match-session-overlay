"use strict";

// Keep official-service traffic single-filed by default. A caller must opt in
// to bounded overlap explicitly; priority still chooses the next compatible
// waiting request and an active request is never interrupted.
const REQUEST_PRIORITY = Object.freeze({
  live: 0,
  auth: 0,
  interactive: 1,
  ranking: 2,
  social: 3,
  history: 4,
});

function createAbortError(message = "Service request was cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

class ServiceRequestScheduler {
  constructor({
    minStartGapMs = 1500,
    maxPriorityBurst = 3,
    maxConcurrent = 1,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (!Number.isFinite(minStartGapMs) || minStartGapMs < 0) {
      throw new TypeError("minStartGapMs must be a non-negative finite number.");
    }
    if (!Number.isInteger(maxPriorityBurst) || maxPriorityBurst < 1) {
      throw new TypeError("maxPriorityBurst must be a positive integer.");
    }
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new TypeError("maxConcurrent must be a positive integer.");
    }
    this.minStartGapMs = minStartGapMs;
    this.maxPriorityBurst = maxPriorityBurst;
    this.maxConcurrent = maxConcurrent;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = [];
    this.active = new Set();
    this.timer = null;
    this.lastStartedAt = Number.NEGATIVE_INFINITY;
    this.nextSequence = 0;
    this.lastPriority = null;
    this.priorityBurst = 0;
  }

  enqueue(
    task,
    {
      priority = "interactive",
      scope,
      generation,
      allowConcurrent = false,
      startGapMs = null,
    } = {},
  ) {
    if (typeof task !== "function") throw new TypeError("task must be a function.");
    const priorityValue = REQUEST_PRIORITY[priority];
    if (priorityValue === undefined) throw new TypeError(`Unknown request priority: ${priority}`);
    const effectiveStartGapMs = startGapMs == null ? this.minStartGapMs : Number(startGapMs);
    if (!Number.isFinite(effectiveStartGapMs) || effectiveStartGapMs < 0) {
      throw new TypeError("startGapMs must be a non-negative finite number.");
    }

    return new Promise((resolve, reject) => {
      this.pending.push({
        task,
        resolve,
        reject,
        priority,
        priorityValue,
        scope,
        generation,
        allowConcurrent: Boolean(allowConcurrent),
        startGapMs: effectiveStartGapMs,
        sequence: this.nextSequence++, enqueuedAt: this.now(),
      });
      this.#pump();
    });
  }

  // Cancels waiting requests only.  The active request continues so callers
  // should still use their generation check before accepting its result.
  cancel({ scope, generation, predicate, reason } = {}) {
    if (predicate !== undefined && typeof predicate !== "function") {
      throw new TypeError("predicate must be a function.");
    }
    const cancelled = [];
    this.pending = this.pending.filter((entry) => {
      const matches = (scope === undefined || entry.scope === scope)
        && (generation === undefined || entry.generation === generation)
        && (!predicate || predicate(entry));
      if (matches) cancelled.push(entry);
      return !matches;
    });
    for (const entry of cancelled) entry.reject(createAbortError(reason));
    if (cancelled.length) this.#pump();
    return cancelled.length;
  }

  cancelScope(scope, options = {}) {
    return this.cancel({ ...options, scope });
  }

  get size() { return this.pending.length; }
  get activeRequest() { return this.active.values().next().value ?? null; }
  get activeRequests() { return [...this.active]; }

  #pump() {
    if (this.pending.length === 0 || this.active.size >= this.maxConcurrent) return;
    const next = this.#selectNext();
    if (!next) return;
    const delay = Math.max(0, this.lastStartedAt + next.startGapMs - this.now());
    if (delay > 0) {
      if (this.timer === null) {
        this.timer = this.setTimer(() => {
          this.timer = null;
          this.#pump();
        }, delay);
      }
      return;
    }
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    // Remove the selected request only after its own start-gap has elapsed.
    // Keeping it pending while the timer waits lets a newly queued request
    // still participate in the next priority decision.
    this.pending.splice(this.pending.indexOf(next), 1);
    this.#start(next);
    this.#pump();
  }

  #canRunAlongside(entry) {
    if (this.active.size === 0) return true;
    return Boolean(entry?.allowConcurrent) &&
      [...this.active].every((active) => active.allowConcurrent);
  }

  #selectNext() {
    if (this.pending.length === 0) return null;
    const bestPriority = Math.min(...this.pending.map((entry) => entry.priorityValue));
    let candidates = this.pending.filter((entry) => entry.priorityValue === bestPriority);

    // A sustained high-priority stream cannot starve lower work: after a
    // bounded burst, run the oldest request from any lower waiting tier.
    // Choosing a fixed tier here would allow the other lower tiers to starve.
    if (this.lastPriority === bestPriority && this.priorityBurst >= this.maxPriorityBurst) {
      const lower = this.pending.filter((entry) => entry.priorityValue > bestPriority);
      if (lower.length) candidates = lower;
    }
    candidates.sort((left, right) => left.sequence - right.sequence);
    const next = candidates[0];
    if (!this.#canRunAlongside(next)) return null;
    return next;
  }

  #start(entry) {
    this.active.add(entry);
    this.lastStartedAt = this.now();
    this.priorityBurst = this.lastPriority === entry.priorityValue ? this.priorityBurst + 1 : 1;
    this.lastPriority = entry.priorityValue;
    let result;
    try {
      result = entry.task();
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result).then(entry.resolve, entry.reject).finally(() => {
      this.active.delete(entry);
      this.#pump();
    });
  }
}

module.exports = { REQUEST_PRIORITY, ServiceRequestScheduler, createAbortError };
