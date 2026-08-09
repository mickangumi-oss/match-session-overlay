"use strict";

const fs = require("node:fs");
const path = require("node:path");

const NO_NOTIFICATION_SOUND = "none";

function windowsMediaDirectory(windowsDirectory = process.env.WINDIR) {
  const root = String(windowsDirectory ?? "").trim();
  return root ? path.join(root, "Media") : "";
}

function listWindowsNotificationSounds({ windowsDirectory } = {}) {
  const mediaDirectory = windowsMediaDirectory(windowsDirectory);
  if (!mediaDirectory) return [];
  try {
    return fs
      .readdirSync(mediaDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".wav")
      .map((entry) => ({
        id: entry.name,
        label: path.basename(entry.name, path.extname(entry.name)),
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );
  } catch {
    return [];
  }
}

function sanitizeWindowsNotificationSound(value, sounds) {
  if (value === NO_NOTIFICATION_SOUND) return NO_NOTIFICATION_SOUND;
  const requested = String(value ?? "");
  return sounds.some((sound) => sound.id === requested)
    ? requested
    : NO_NOTIFICATION_SOUND;
}

function resolveWindowsNotificationSound(value, sounds, { windowsDirectory } = {}) {
  const soundId = sanitizeWindowsNotificationSound(value, sounds);
  if (soundId === NO_NOTIFICATION_SOUND) return null;
  const mediaDirectory = windowsMediaDirectory(windowsDirectory);
  if (!mediaDirectory) return null;
  const soundPath = path.join(mediaDirectory, soundId);
  return path.dirname(soundPath) === path.resolve(mediaDirectory) && fs.existsSync(soundPath)
    ? soundPath
    : null;
}

function scalePcmWavVolume(source, volume) {
  if (!Buffer.isBuffer(source) || source.length < 44) {
    throw new Error("INVALID_WAV");
  }
  if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("INVALID_WAV");
  }
  const gain = Math.min(1, Math.max(0, Number(volume) || 0));
  let formatTag = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataLength = null;
  for (let offset = 12; offset + 8 <= source.length;) {
    const chunkId = source.toString("ascii", offset, offset + 4);
    const chunkLength = source.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkLength > source.length) throw new Error("INVALID_WAV");
    if (chunkId === "fmt " && chunkLength >= 16) {
      formatTag = source.readUInt16LE(chunkDataOffset);
      bitsPerSample = source.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkLength;
    }
    offset = chunkDataOffset + chunkLength + (chunkLength % 2);
  }
  if (formatTag !== 1 || ![8, 16, 24, 32].includes(bitsPerSample) || dataOffset == null) {
    throw new Error("UNSUPPORTED_WAV");
  }

  const result = Buffer.from(source);
  const sampleBytes = bitsPerSample / 8;
  const end = dataOffset + dataLength - (dataLength % sampleBytes);
  for (let offset = dataOffset; offset < end; offset += sampleBytes) {
    if (bitsPerSample === 8) {
      const scaled = Math.round((result.readUInt8(offset) - 128) * gain + 128);
      result.writeUInt8(Math.min(255, Math.max(0, scaled)), offset);
    } else if (bitsPerSample === 16) {
      const scaled = Math.round(result.readInt16LE(offset) * gain);
      result.writeInt16LE(Math.min(32767, Math.max(-32768, scaled)), offset);
    } else if (bitsPerSample === 24) {
      let sample = result[offset] | (result[offset + 1] << 8) | (result[offset + 2] << 16);
      if (sample & 0x800000) sample |= 0xff000000;
      const scaled = Math.min(8388607, Math.max(-8388608, Math.round(sample * gain)));
      result[offset] = scaled & 0xff;
      result[offset + 1] = (scaled >> 8) & 0xff;
      result[offset + 2] = (scaled >> 16) & 0xff;
    } else {
      const scaled = Math.round(result.readInt32LE(offset) * gain);
      result.writeInt32LE(Math.min(2147483647, Math.max(-2147483648, scaled)), offset);
    }
  }
  return result;
}

module.exports = {
  NO_NOTIFICATION_SOUND,
  listWindowsNotificationSounds,
  resolveWindowsNotificationSound,
  scalePcmWavVolume,
  sanitizeWindowsNotificationSound,
};
