"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const temporaryUserData = fs.mkdtempSync(
  path.join(os.tmpdir(), "mso-stats-resize-qa-"),
);
app.setPath("userData", temporaryUserData);
app.on("quit", () => {
  try {
    fs.rmSync(temporaryUserData, { recursive: true, force: true });
  } catch {
    // The OS temp folder can be cleaned after Chromium releases cache handles.
  }
});
const css = fs.readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "stats.css"), "utf8");

const markup = `<main class="stats-window"><section class="summary">${Array.from(
  { length: 7 },
  (_, index) => `<div class="metric-group"><small>METRIC ${index + 1}</small><strong>${1_400 + index}</strong></div>`,
).join("")}</section><section class="stats-chart"><header><span class="chart-label">MR TREND</span></header><div class="stats-chart-body"><canvas></canvas></div></section></main>`;

const cases = [
  { name: "window-horizontal-7-cards", classes: "horizontal", cardCount: 7, width: 900, smallHeight: 229, largeHeight: 520, chartHeight: 160, cardMinHeight: 44 },
  { name: "overlay-horizontal-1-card", classes: "overlay horizontal", cardCount: 1, width: 520, smallHeight: 229, largeHeight: 420, chartHeight: 160, cardMinHeight: 44 },
  { name: "window-vertical-5-cards", classes: "vertical", cardCount: 5, width: 380, smallHeight: 607, largeHeight: 900, chartHeight: 210, cardMinHeight: 68 },
  { name: "overlay-vertical-7-cards", classes: "overlay vertical", cardCount: 7, width: 380, smallHeight: 759, largeHeight: 980, chartHeight: 210, cardMinHeight: 68 },
  { name: "graph-only", classes: "horizontal no-metrics", cardCount: 0, width: 700, smallHeight: 220, largeHeight: 430 },
  { name: "cards-only", classes: "vertical no-chart", cardCount: 5, width: 380, smallHeight: 474, largeHeight: 760 },
];

const closeTo = (actual, expected, tolerance = 2) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance}px of ${expected}`,
  );
};

app.whenReady().then(async () => {
  const probe = new BrowserWindow({ width: 900, height: 240, backgroundColor: "#050b12" });
  await probe.loadURL("data:text/html,QA");
  await probe.webContents.executeJavaScript(`(() => {
    document.body.innerHTML = ${JSON.stringify(markup)};
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
  })()`);

  const results = [];
  for (const definition of cases) {
    await probe.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.stats-window');
      root.className = ${JSON.stringify(`stats-window ${definition.classes}`)};
      root.style.setProperty('--visible-card-count', ${JSON.stringify(String(definition.cardCount))});
      [...document.querySelectorAll('.metric-group')].forEach((card, index) => {
        card.classList.toggle('hidden', index >= ${definition.cardCount});
      });
    })()`);

    const measurements = [];
    for (const height of [definition.smallHeight, definition.largeHeight]) {
      probe.setContentSize(definition.width, height);
      await new Promise((resolve) => setTimeout(resolve, 60));
      measurements.push(await probe.webContents.executeJavaScript(`(() => {
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return { width: value.width, height: value.height, top: value.top, bottom: value.bottom };
        };
        const summary = document.querySelector('.summary');
        const chart = document.querySelector('.stats-chart');
        const firstCard = document.querySelector('.metric-group:not(.hidden)');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          summary: rect(summary),
          chart: rect(chart),
          chartDisplay: getComputedStyle(chart).display,
          summaryDisplay: getComputedStyle(summary).display,
          summaryRows: getComputedStyle(summary).gridTemplateRows,
          firstCardStyle: firstCard ? {
            height: getComputedStyle(firstCard).height,
            alignSelf: getComputedStyle(firstCard).alignSelf,
            minHeight: getComputedStyle(firstCard).minHeight,
          } : null,
          cards: [...document.querySelectorAll('.metric-group:not(.hidden)')].map(rect),
        };
      })()`));
    }
    results.push({ name: definition.name, small: measurements[0], large: measurements[1] });
  }

  for (let index = 0; index < 4; index += 1) {
    const result = results[index];
    const definition = cases[index];
    const growth = result.large.viewport.height - result.small.viewport.height;
    closeTo(result.small.chart.height, definition.chartHeight);
    closeTo(result.large.chart.height, definition.chartHeight);
    closeTo(result.large.summary.height - result.small.summary.height, growth);
    assert.equal(result.small.chartDisplay, "grid");
    assert.equal(result.small.summaryDisplay, "grid");
    for (const measurement of [result.small, result.large]) {
      assert.ok(measurement.cards.every((card) => card.height >= definition.cardMinHeight));
      const firstCardHeight = measurement.cards[0].height;
      assert.ok(measurement.cards.every((card) => Math.abs(card.height - firstCardHeight) <= 1));
      if (!definition.classes.includes("vertical")) {
        closeTo(firstCardHeight, measurement.summary.height);
      } else {
        closeTo(
          measurement.cards.at(-1).bottom,
          measurement.summary.bottom,
        );
      }
    }
  }

  closeTo(
    results[4].large.chart.height - results[4].small.chart.height,
    results[4].large.viewport.height - results[4].small.viewport.height,
  );
  assert.equal(results[4].small.summaryDisplay, "none");
  closeTo(
    results[5].large.summary.height - results[5].small.summary.height,
    results[5].large.viewport.height - results[5].small.viewport.height,
  );
  assert.equal(results[5].small.chartDisplay, "none");

  process.stdout.write(`STATS_RESIZE_QA=${JSON.stringify(results.map((result) => ({
    name: result.name,
    chart: [result.small.chart.height, result.large.chart.height],
    summary: [result.small.summary.height, result.large.summary.height],
  })))}\n`);
  probe.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
