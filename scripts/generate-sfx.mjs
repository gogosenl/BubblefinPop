import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sampleRate = 44100;
const tau = Math.PI * 2;
const clamp = value => Math.max(-1, Math.min(1, value));
const phaseSweep = (time, startHz, endHz, duration) => {
  const sweep = (endHz - startHz) / Math.max(0.001, duration);
  return tau * (startHz * time + 0.5 * sweep * time * time);
};

let noiseState = 0x6d2b79f5;
const whiteNoise = () => {
  noiseState = Math.imul(noiseState ^ (noiseState >>> 15), 1 | noiseState);
  noiseState ^= noiseState + Math.imul(noiseState ^ (noiseState >>> 7), 61 | noiseState);
  return (((noiseState ^ (noiseState >>> 14)) >>> 0) / 4294967296) * 2 - 1;
};

function writeWave(filename, duration, makeSynth) {
  const synth = makeSynth();
  const frames = Math.ceil(sampleRate * duration);
  const data = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / sampleRate;
    const attack = Math.min(1, frame / 24);
    const release = Math.min(1, (frames - frame) / 90);
    const sample = clamp(Math.tanh(synth(t, duration) * 1.32) * attack * release);
    data.writeInt16LE(Math.round(sample * 32767), frame * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const output = resolve('assets', filename);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.concat([header, data]));
  console.log(output);
}

const bubbleChirp = (t, start, length, startHz, endHz, gain) => {
  const local = t - start;
  if (local < 0 || local > length) return 0;
  const envelope = Math.sin(Math.PI * local / length) ** 0.65 * Math.exp(-local * 2.1);
  return Math.sin(phaseSweep(local, startHz, endHz, length)) * envelope * gain;
};

writeWave('sfx-water-drop.wav', 0.48, () => {
  let filtered = 0;
  let previous = 0;
  return t => {
    const noise = whiteNoise();
    filtered += (noise - filtered) * 0.11;
    const splashBand = (filtered - previous) * Math.exp(-t * 14) * 0.42;
    previous = filtered;
    const waterBody = Math.sin(phaseSweep(t, 118, 58, 0.28)) * Math.exp(-t * 11) * 0.52;
    const membrane = Math.sin(phaseSweep(t, 245, 112, 0.34) + Math.sin(tau * 19 * t) * 0.8) * Math.exp(-t * 9) * 0.26;
    const drops = bubbleChirp(t, 0.075, 0.12, 410, 720, 0.16)
      + bubbleChirp(t, 0.16, 0.1, 520, 840, 0.11)
      + bubbleChirp(t, 0.25, 0.09, 610, 960, 0.075);
    return waterBody + membrane + splashBand + drops;
  };
});

writeWave('sfx-water-merge.wav', 0.82, () => {
  let filtered = 0;
  return (t, duration) => {
    filtered += (whiteNoise() - filtered) * 0.045;
    const progress = t / duration;
    const suctionEnvelope = Math.sin(Math.PI * progress) ** 0.8;
    const suction = Math.sin(phaseSweep(t, 145, 540, duration) + Math.sin(tau * 8 * t) * 1.1) * suctionEnvelope * 0.28;
    const gurgle = Math.sin(phaseSweep(t, 72, 126, duration) + Math.sin(tau * 5.2 * t) * 1.8) * suctionEnvelope * 0.22;
    const bubbles = bubbleChirp(t, 0.05, 0.15, 310, 690, 0.2)
      + bubbleChirp(t, 0.16, 0.13, 430, 850, 0.17)
      + bubbleChirp(t, 0.28, 0.16, 260, 720, 0.18)
      + bubbleChirp(t, 0.43, 0.13, 520, 980, 0.14)
      + bubbleChirp(t, 0.56, 0.14, 380, 910, 0.13);
    const stream = filtered * suctionEnvelope * 0.08;
    return suction + gurgle + bubbles + stream;
  };
});

writeWave('sfx-bubble-release.wav', 1.18, () => {
  let smooth = 0;
  let previous = 0;
  return t => {
    const noise = whiteNoise();
    smooth += (noise - smooth) * 0.16;
    const splash = (smooth - previous) * Math.exp(-Math.max(0, t - 0.015) * 7.5) * 0.62;
    previous = smooth;
    const snapEnvelope = Math.exp(-t * 58) * (1 - Math.exp(-t * 420));
    const membraneSnap = (noise * 0.48 + Math.sin(phaseSweep(t, 165, 64, 0.16)) * 0.52) * snapEnvelope;
    const wetBody = Math.sin(phaseSweep(t, 92, 48, 0.42) + Math.sin(tau * 13 * t)) * Math.exp(-t * 7.2) * 0.38;
    const droplets = bubbleChirp(t, 0.075, 0.15, 480, 920, 0.2)
      + bubbleChirp(t, 0.18, 0.13, 630, 1120, 0.15)
      + bubbleChirp(t, 0.3, 0.17, 350, 860, 0.17)
      + bubbleChirp(t, 0.47, 0.14, 720, 1280, 0.1)
      + bubbleChirp(t, 0.63, 0.18, 420, 1030, 0.12)
      + bubbleChirp(t, 0.81, 0.16, 560, 1180, 0.085);
    return membraneSnap + wetBody + splash + droplets;
  };
});
