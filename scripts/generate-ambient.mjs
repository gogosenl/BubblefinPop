import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sampleRate = 44100;
const duration = 24;
const channels = 2;
const frames = sampleRate * duration;
const data = Buffer.alloc(frames * channels * 2);
const tau = Math.PI * 2;
const clamp = value => Math.max(-1, Math.min(1, value));

const loopSine = (time, cycles, phase = 0) => Math.sin(tau * (cycles * time / duration) + phase);
const smoothWindow = progress => progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * progress) ** 2;

const melody = [
  220.0, 261.63, 293.66, 329.63,
  293.66, 261.63, 220.0, 196.0,
  220.0, 246.94, 293.66, 349.23,
  329.63, 293.66, 246.94, 220.0,
];
const bubbleEvents = [
  { at: 1.2, length: 0.34, start: 360, end: 720, pan: -0.62, gain: 0.025 },
  { at: 4.4, length: 0.29, start: 430, end: 820, pan: 0.48, gain: 0.02 },
  { at: 7.8, length: 0.4, start: 310, end: 670, pan: -0.2, gain: 0.024 },
  { at: 11.3, length: 0.3, start: 510, end: 940, pan: 0.7, gain: 0.018 },
  { at: 15.1, length: 0.42, start: 280, end: 640, pan: 0.24, gain: 0.025 },
  { at: 18.4, length: 0.31, start: 450, end: 870, pan: -0.55, gain: 0.02 },
  { at: 21.6, length: 0.34, start: 380, end: 760, pan: 0.42, gain: 0.021 },
];

const bubbleAt = (time, event) => {
  const local = time - event.at;
  if (local <= 0 || local >= event.length) return 0;
  const progress = local / event.length;
  const phase = tau * (event.start * local + 0.5 * (event.end - event.start) * local * progress);
  return Math.sin(phase) * smoothWindow(progress) * event.gain;
};

for (let frame = 0; frame < frames; frame += 1) {
  const time = frame / sampleRate;

  // Broad, slow water movement. Every modulation completes an integer number
  // of cycles in 24 seconds, so the exported track loops without a seam.
  const tide = 0.7 + 0.3 * loopSine(time, 2, -Math.PI / 2) ** 2;
  const current = (
    Math.sin(tau * 55 * time + loopSine(time, 1) * 0.42) * 0.15
    + Math.sin(tau * 73.3333333333 * time + 0.7 + loopSine(time, 2) * 0.28) * 0.1
    + Math.sin(tau * 82.5 * time + 1.8) * 0.075
    + Math.sin(tau * 110 * time + 2.4 + loopSine(time, 3) * 0.18) * 0.04
  ) * tide;

  // A calm pentatonic glass-water motif. Notes fully fade before each new step
  // so they never click and never compete with gameplay effects.
  const stepLength = duration / melody.length;
  const step = Math.floor(time / stepLength) % melody.length;
  const stepTime = time - step * stepLength;
  const stepProgress = stepTime / stepLength;
  const noteEnvelope = Math.sin(Math.PI * Math.min(1, stepProgress / 0.8)) ** 2 * Math.exp(-stepProgress * 2.25);
  const noteFrequency = melody[step];
  const bell = (
    Math.sin(tau * noteFrequency * stepTime) * 0.055
    + Math.sin(tau * noteFrequency * 2.01 * stepTime + 0.4) * 0.018
    + Math.sin(tau * noteFrequency * 3.99 * stepTime + 1.1) * 0.007
  ) * noteEnvelope;

  let leftBubbles = 0;
  let rightBubbles = 0;
  bubbleEvents.forEach(event => {
    const bubble = bubbleAt(time, event);
    leftBubbles += bubble * Math.sqrt((1 - event.pan) / 2);
    rightBubbles += bubble * Math.sqrt((1 + event.pan) / 2);
  });

  const caustic = Math.sin(tau * 440 * time + loopSine(time, 2) * 1.3)
    * (0.006 + 0.004 * loopSine(time, 4) ** 2);
  const slowPan = loopSine(time, 1) * 0.12;
  const bed = current * 0.72 + bell + caustic;
  const left = clamp(Math.tanh((bed * (1 - slowPan) + leftBubbles) * 1.08) * 0.72);
  const right = clamp(Math.tanh((bed * (1 + slowPan) + rightBubbles) * 1.08) * 0.72);
  data.writeInt16LE(Math.round(left * 32767), frame * 4);
  data.writeInt16LE(Math.round(right * 32767), frame * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28);
header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const output = resolve('assets/ocean-ambient.wav');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, data]));
console.log(output);
