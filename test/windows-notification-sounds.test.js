"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  NO_NOTIFICATION_SOUND,
  listWindowsNotificationSounds,
  resolveWindowsNotificationSound,
  scalePcmWavVolume,
  sanitizeWindowsNotificationSound,
} = require("../src/windows-notification-sounds");

test("lists only synthetic WAV files from the Windows Media directory", (t) => {
  const windowsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mso-sound-test-"));
  t.after(() => fs.rmSync(windowsDirectory, { recursive: true, force: true }));
  const mediaDirectory = path.join(windowsDirectory, "Media");
  fs.mkdirSync(mediaDirectory);
  fs.writeFileSync(path.join(mediaDirectory, "Synthetic Ding.wav"), "synthetic");
  fs.writeFileSync(path.join(mediaDirectory, "ignore.mp3"), "synthetic");

  assert.deepEqual(listWindowsNotificationSounds({ windowsDirectory }), [
    { id: "Synthetic Ding.wav", label: "Synthetic Ding" },
  ]);
});

function syntheticPcm16Wav(samples) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}

test("scales a synthetic PCM WAV without changing its header or source", () => {
  const source = syntheticPcm16Wav([20_000, -20_000, 10_000]);
  const original = Buffer.from(source);
  const adjusted = scalePcmWavVolume(source, 0.25);

  assert.deepEqual(source, original);
  assert.deepEqual([...adjusted.subarray(0, 44)], [...source.subarray(0, 44)]);
  assert.equal(adjusted.readInt16LE(44), 5_000);
  assert.equal(adjusted.readInt16LE(46), -5_000);
  assert.equal(adjusted.readInt16LE(48), 2_500);
});

test("zero notification volume silences synthetic PCM samples", () => {
  const adjusted = scalePcmWavVolume(syntheticPcm16Wav([32_000, -32_000]), 0);
  assert.equal(adjusted.readInt16LE(44), 0);
  assert.equal(adjusted.readInt16LE(46), 0);
});

test("rejects missing or arbitrary sound identifiers", () => {
  const sounds = [{ id: "Synthetic Ding.wav", label: "Synthetic Ding" }];
  assert.equal(
    sanitizeWindowsNotificationSound("Synthetic Ding.wav", sounds),
    "Synthetic Ding.wav",
  );
  assert.equal(sanitizeWindowsNotificationSound("..\\outside.wav", sounds), NO_NOTIFICATION_SOUND);
  assert.equal(sanitizeWindowsNotificationSound("missing.wav", sounds), NO_NOTIFICATION_SOUND);
});

test("resolves only a catalogued synthetic sound", (t) => {
  const windowsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mso-sound-path-test-"));
  t.after(() => fs.rmSync(windowsDirectory, { recursive: true, force: true }));
  const mediaDirectory = path.join(windowsDirectory, "Media");
  fs.mkdirSync(mediaDirectory);
  fs.writeFileSync(path.join(mediaDirectory, "Synthetic Notify.wav"), "synthetic");
  const sounds = listWindowsNotificationSounds({ windowsDirectory });

  assert.equal(
    resolveWindowsNotificationSound("Synthetic Notify.wav", sounds, { windowsDirectory }),
    path.join(mediaDirectory, "Synthetic Notify.wav"),
  );
  assert.equal(resolveWindowsNotificationSound("..\\outside.wav", sounds, { windowsDirectory }), null);
});
