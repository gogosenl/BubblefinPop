import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const runtimeWidth = Number(process.env.RUNTIME_WIDTH ?? 367);
const runtimeHeight = Number(process.env.RUNTIME_HEIGHT ?? 800);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
  fileName: 'App.tsx',
}).outputText;

class MockValue {
  constructor(value = 0) { this.value = value; }
  setValue(value) { this.value = value; }
  stopAnimation() {}
  interpolate() { return this; }
}

class MockValueXY {
  constructor(value = { x: 0, y: 0 }) {
    this.x = new MockValue(value.x);
    this.y = new MockValue(value.y);
  }
  setValue(value) { this.x.setValue(value.x); this.y.setValue(value.y); }
  stopAnimation() {}
  getTranslateTransform() { return []; }
}

const inertAnimation = () => ({ start(callback) { callback?.(); }, stop() {} });
const Animated = {
  Value: MockValue,
  ValueXY: MockValueXY,
  View: 'Animated.View',
  Image: 'Animated.Image',
  add: () => new MockValue(),
  subtract: () => new MockValue(),
  timing: inertAnimation,
  spring: inertAnimation,
  sequence: inertAnimation,
  parallel: inertAnimation,
  stagger: inertAnimation,
  loop: inertAnimation,
  delay: inertAnimation,
};
const Easing = new Proxy({ bezier: () => value => value }, { get: target => target.bezier });
const reactNative = {
  Animated,
  Dimensions: { get: () => ({ width: runtimeWidth, height: runtimeHeight }) },
  Easing,
  Image: 'Image',
  ImageBackground: 'ImageBackground',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: 'StatusBar',
  StyleSheet: { create: styles => styles, absoluteFill: {} },
  Text: 'Text',
  View: 'View',
};

const mockRequire = specifier => {
  if (specifier === 'react-native') return reactNative;
  if (specifier === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {} };
  if (specifier === 'expo-asset') return { Asset: { loadAsync: async () => {} } };
  if (specifier === 'expo-audio') return { setAudioModeAsync: async () => {}, useAudioPlayer: () => ({}) };
  if (specifier === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
  if (specifier.startsWith('./assets/')) return 1;
  return nodeRequire(specifier);
};

const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  require: mockRequire,
  __DEV__: true,
  console,
  process,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
}, { filename: 'App.runtime-check.cjs' });

console.log(`PASS: Runtime physics, merge, and 24-pattern route verifiers completed at ${runtimeWidth}x${runtimeHeight}.`);
