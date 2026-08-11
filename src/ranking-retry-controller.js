"use strict";

function createRankingRetryController({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const timers = new Map();

  function clear(key) {
    const timer = timers.get(key);
    if (timer != null) clearTimer(timer);
    timers.delete(key);
  }

  function clearAll() {
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear();
  }

  function schedule(key, delayMs, callback) {
    clear(key);
    const timer = setTimer(() => {
      timers.delete(key);
      callback();
    }, delayMs);
    timers.set(key, timer);
  }

  return {
    schedule,
    clear,
    clearAll,
    has: (key) => timers.has(key),
    size: () => timers.size,
  };
}

module.exports = { createRankingRetryController };
