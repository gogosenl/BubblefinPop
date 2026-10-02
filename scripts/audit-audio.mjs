import { readFileSync } from 'node:fs';

const files = [
  { label: 'drop', path: 'assets/sfx-water-drop.wav', minimumDuration: 0.35, maximumDuration: 0.65, expectedChannels: 1 },
  { label: 'merge', path: 'assets/sfx-water-merge.wav', minimumDuration: 0.65, maximumDuration: 1.0, expectedChannels: 1 },
  { label: 'pop', path: 'assets/sfx-bubble-release.wav', minimumDuration: 0.95, maximumDuration: 1.35, expectedChannels: 1 },
  { label: 'music', path: 'assets/ocean-ambient.wav', minimumDuration: 23.9, maximumDuration: 24.1, expectedChannels: 2 },
];

let failed = false;
for (const { label, path, minimumDuration, maximumDuration, expectedChannels } of files) {
  const wave = readFileSync(path);
  const channels = wave.readUInt16LE(22);
  const sampleRate = wave.readUInt32LE(24);
  const bitDepth = wave.readUInt16LE(34);
  const dataBytes = wave.readUInt32LE(40);
  const samples = dataBytes / 2;
  const duration = samples / channels / sampleRate;
  let peak = 0;
  let clipped = 0;
  let squareSum = 0;
  for (let offset = 44; offset < 44 + dataBytes; offset += 2) {
    const sample = wave.readInt16LE(offset);
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    squareSum += sample * sample;
    if (absolute >= 32767) clipped += 1;
  }
  const frameCount = samples / channels;
  let maximumSeamDelta = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    const first = wave.readInt16LE(44 + channel * 2);
    const last = wave.readInt16LE(44 + ((frameCount - 1) * channels + channel) * 2);
    maximumSeamDelta = Math.max(maximumSeamDelta, Math.abs(first - last));
  }
  const rms = Math.sqrt(squareSum / samples) / 32768;
  const valid = channels === expectedChannels
    && sampleRate === 44100
    && bitDepth === 16
    && duration >= minimumDuration
    && duration <= maximumDuration
    && clipped === 0
    && maximumSeamDelta < 256;
  if (!valid) failed = true;
  console.log(`${valid ? 'PASS' : 'FAIL'} ${label}: ${duration.toFixed(2)}s, ${channels === 1 ? 'mono' : 'stereo'} ${sampleRate}Hz/${bitDepth}-bit, peak ${(peak / 32768 * 100).toFixed(1)}%, RMS ${(20 * Math.log10(Math.max(rms, 0.000001))).toFixed(1)}dB, clipped ${clipped}, seam ${maximumSeamDelta}`);
}

if (failed) process.exitCode = 1;
