import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type CreatureType = 'berry' | 'coral' | 'sun' | 'mint' | 'aqua' | 'sky' | 'plum' | 'navy';
type Screen = 'home' | 'levels' | 'game' | 'settings';
type Language = 'tr' | 'en';
type GameState = 'playing' | 'won' | 'lost';
type AudioCue = 'drop' | 'merge' | 'pop';
type RescueFlightSpec = {
  id: string;
  type: CreatureType;
  count: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
};
type DentSide = 'left' | 'right' | 'top' | 'bottom';
type DentValues = Record<DentSide, Animated.Value>;
type DentLevels = Record<DentSide, number>;

type Piece = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  driftStrength: number;
  entryDrift: number;
  creatureMotion: Animated.ValueXY;
  creatureRoll: Animated.Value;
  creatureOffsetX: number;
  creatureOffsetY: number;
  creatureAngle: number;
  renderedX?: number;
  renderedY?: number;
  renderedCreatureOffsetX?: number;
  renderedCreatureOffsetY?: number;
  renderedCreatureAngle?: number;
  position: Animated.ValueXY;
  elastic: Animated.ValueXY;
  squashX: number;
  squashY: number;
  renderedSquashX?: number;
  renderedSquashY?: number;
  dents: DentValues;
  dentLevels: DentLevels;
  renderedDentLevels: DentLevels;
  size: number;
  type: CreatureType;
  count: number;
  contents: CreatureType[];
  displayContents?: CreatureType[];
  fresh?: boolean;
  merging?: boolean;
  mergeReceiver?: boolean;
  mergeStartScale?: number;
  mergeDx?: number;
  mergeDy?: number;
  transferType?: CreatureType;
  transferDx?: number;
  transferDy?: number;
  transferAmount?: number;
  transferSources?: Array<{
    id: string;
    x: number;
    y: number;
    size: number;
    count: number;
    totalCount: number;
    indices: number[];
  }>;
  settleCreaturesInstantly?: boolean;
  sleeping?: boolean;
  settleFrames?: number;
  contactFrames?: number;
};

type NextBubble = { id: string; type: CreatureType; count: number; contents: CreatureType[] };

type Level = {
  id: number;
  name: string;
  subtitle: string;
  moves: number;
  goal: number;
  merge: number;
  palette: CreatureType[];
  seed: Array<[number, number, CreatureType]>;
  tutorial?: 1 | 2 | 3;
};

const ROWS = 8;
const COLS = 6;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
// The playfield follows the phone itself instead of being a narrow, cell-sized
// card. Portrait orientation is locked in app.json, so these values are stable
// for the entire round and the physics/render coordinates always stay aligned.
const BOARD_EDGE_GAP = 2;
const BOARD_WIDTH = Math.floor(SCREEN_WIDTH - BOARD_EDGE_GAP * 2);
const BOARD_HEIGHT = Math.max(430, Math.floor(SCREEN_HEIGHT - 188));
const CELL = Math.floor(Math.min(BOARD_WIDTH / COLS, 72));
const BUBBLE_SIZE = CELL + 11;
const BOARD_WALL_INSET = 30;
const HELD_BUBBLE_TOP = 8;
const FAIL_LINE_Y = 58;
const FAIL_LINE_WARNING_MS = 720;
const FLOOR_CLEARANCE = 47;
const BUBBLE_GAP = 0.75;
const MERGE_ANIMATION_MS = 560;
const MERGE_SETTLE_HOLD_MS = 0;
const POP_ANIMATION_MS = 1750;
const RESCUE_FLIGHT_MS = 2450;
const RESCUE_SCORE_COMMIT_MS = RESCUE_FLIGHT_MS - 35;
const collisionDistanceFor = (a: Pick<Piece, 'size'>, b: Pick<Piece, 'size'>) =>
  (a.size + b.size) / 2 + BUBBLE_GAP;
const bubbleSizeForCount = (count: number) => Math.round(
  Math.max(BUBBLE_SIZE * 0.92, Math.min(BUBBLE_SIZE * 1.3, BUBBLE_SIZE * (0.84 + Math.min(count, 9) * 0.05))),
);

type ObstacleKind = 'coral' | 'stone' | 'pearl';
type BoardObstacle = {
  id: string;
  cx: number;
  cy: number;
  length: number;
  thickness: number;
  angle: number;
  kind: ObstacleKind;
};
type BoardLayout = {
  floorSlope: number;
  obstacles: BoardObstacle[];
  water: string;
  depth: string;
  rail: string;
  floor: string;
  floorEdge: string;
};

const BOARD_THEMES = [
  { water: '#d8f3fa', depth: 'rgba(92,196,222,0.2)', rail: '#4676d6', floor: '#9edfdc', floorEdge: '#68c3cc' },
  { water: '#daf6f0', depth: 'rgba(68,193,171,0.2)', rail: '#318fb2', floor: '#87d8c6', floorEdge: '#48b8ae' },
  { water: '#e3f1ff', depth: 'rgba(90,150,225,0.2)', rail: '#526fd0', floor: '#a8d7dc', floorEdge: '#70b6c3' },
  { water: '#e2f4fb', depth: 'rgba(82,171,212,0.22)', rail: '#3a6fc7', floor: '#98d4c8', floorEdge: '#5bb4ac' },
  { water: '#e9efff', depth: 'rgba(113,118,209,0.18)', rail: '#655fc5', floor: '#afcfd1', floorEdge: '#779fae' },
  { water: '#d9f5ff', depth: 'rgba(53,163,218,0.23)', rail: '#2665b6', floor: '#8bd7cf', floorEdge: '#4daeb0' },
] as const;
function boardLayoutForLevel(levelId: number): BoardLayout {
  const stage = (levelId - 1) % 8;
  const world = Math.floor((levelId - 1) / 8);
  const theme = BOARD_THEMES[world % BOARD_THEMES.length] as typeof BOARD_THEMES[number];
  const w = BOARD_WIDTH;
  const h = BOARD_HEIGHT;
  const patterns: Array<Pick<BoardLayout, 'floorSlope' | 'obstacles'>> = [
    { floorSlope: 0, obstacles: [] },
    { floorSlope: 22, obstacles: [] },
    {
      floorSlope: -22,
      obstacles: [
        { id: 'wood-shelf', cx: w * 0.69, cy: h * 0.65, length: w * 0.34, thickness: 30, angle: -9, kind: 'pearl' },
        { id: 'wood-bumper', cx: w * 0.28, cy: h * 0.51, length: 43, thickness: 43, angle: 0, kind: 'stone' },
      ],
    },
    {
      floorSlope: 0,
      obstacles: [
        { id: 'center-beam', cx: w * 0.5, cy: h * 0.61, length: w * 0.4, thickness: 32, angle: 0, kind: 'coral' },
        { id: 'upper-bumper', cx: w * 0.72, cy: h * 0.43, length: 42, thickness: 42, angle: 0, kind: 'stone' },
      ],
    },
    {
      floorSlope: 16,
      obstacles: [
        { id: 'left-ramp', cx: w * 0.31, cy: h * 0.6, length: w * 0.34, thickness: 31, angle: 14, kind: 'stone' },
        { id: 'right-bumper', cx: w * 0.73, cy: h * 0.49, length: 44, thickness: 44, angle: 0, kind: 'pearl' },
      ],
    },
    {
      floorSlope: -16,
      obstacles: [
        { id: 'right-ramp', cx: w * 0.69, cy: h * 0.59, length: w * 0.34, thickness: 31, angle: -14, kind: 'coral' },
        { id: 'left-bumper', cx: w * 0.27, cy: h * 0.46, length: 44, thickness: 44, angle: 0, kind: 'pearl' },
      ],
    },
    {
      floorSlope: 0,
      obstacles: [
        { id: 'split-left', cx: w * 0.28, cy: h * 0.64, length: w * 0.29, thickness: 29, angle: -11, kind: 'pearl' },
        { id: 'split-right', cx: w * 0.72, cy: h * 0.64, length: w * 0.29, thickness: 29, angle: 11, kind: 'pearl' },
        { id: 'split-bumper', cx: w * 0.5, cy: h * 0.45, length: 42, thickness: 42, angle: 0, kind: 'stone' },
      ],
    },
    {
      floorSlope: world % 2 ? -20 : 20,
      obstacles: [
        { id: 'upper-current', cx: w * 0.62, cy: h * 0.5, length: w * 0.34, thickness: 30, angle: world % 2 ? 12 : -12, kind: 'stone' },
        { id: 'lower-current', cx: w * 0.33, cy: h * 0.69, length: w * 0.28, thickness: 28, angle: world % 2 ? -8 : 8, kind: 'coral' },
      ],
    },
  ];
  const pattern = patterns[stage] as Pick<BoardLayout, 'floorSlope' | 'obstacles'>;
  return { ...theme, floorSlope: pattern.floorSlope, obstacles: pattern.obstacles };
}

const DEFAULT_BOARD_LAYOUT = boardLayoutForLevel(1);
const floorSurfaceAt = (layout: BoardLayout, centerX: number) =>
  BOARD_HEIGHT - FLOOR_CLEARANCE + layout.floorSlope * ((centerX - BOARD_WIDTH / 2) / BOARD_WIDTH);
const floorTopForPiece = (piece: Pick<Piece, 'x' | 'size'>, layout: BoardLayout) =>
  floorSurfaceAt(layout, piece.x + piece.size / 2) - piece.size;
const PUFFERFISH_ASSETS: Record<CreatureType, number> = {
  berry: require('./assets/pufferfish-berry-v3.png'),
  coral: require('./assets/pufferfish-coral-v3.png'),
  sun: require('./assets/pufferfish-sun-v3.png'),
  mint: require('./assets/pufferfish-mint-v3.png'),
  aqua: require('./assets/pufferfish-aqua-v3.png'),
  sky: require('./assets/pufferfish-sky-v3.png'),
  plum: require('./assets/pufferfish-plum-v3.png'),
  navy: require('./assets/pufferfish-navy-v3.png'),
};
const HOME_HERO_ASSET = require('./assets/home-hero-pufferfish-v3.png');
const HOME_BACKGROUND_ASSET = require('./assets/underwater-home-bg-v2.png');
const NAV_HOME_ASSET = require('./assets/nav-home-v2.png');
const NAV_LEVELS_ASSET = require('./assets/nav-levels-v2.png');
const NAV_SETTINGS_ASSET = require('./assets/nav-settings-v2.png');
const NAV_PLAY_ASSET = require('./assets/nav-play-v2.png');
const WORLD_BANNER_ASSET = require('./assets/world-banner-frame-v2.png');
const LEVEL_COMPLETE_ASSET = require('./assets/level-complete-badge-v2.png');
const LEVEL_CURRENT_ASSET = require('./assets/level-current-portal-v2.png');
const LEVEL_VICTORY_ASSET = require('./assets/level-victory-pufferfish-v3.png');
const GORSEN_GAMES_LOGO_ASSET = require('./assets/gorsen-games-logo.png');
const CORAL_WRECK_BOARD_ASSET = require('./assets/coral-wreck-board-bg-v1.png');
const SHIPWRECK_WOOD_ASSET = require('./assets/shipwreck-wood-texture-v1.png');
const CORAL_WRECK_SAND_ASSET = require('./assets/coral-wreck-sand-v1.png');
const CORAL_WRECK_SIDE_ASSET = require('./assets/coral-wreck-side-frame-v2.png');
const MUSIC_ASSET = require('./assets/ocean-ambient.wav');
const DROP_SFX_ASSET = require('./assets/sfx-water-drop.wav');
const MERGE_SFX_ASSET = require('./assets/sfx-water-merge.wav');
const POP_SFX_ASSET = require('./assets/sfx-bubble-release.wav');
const MERGE_BUBBLE_PARTICLE_ASSET = require('./assets/merge-water-bubble-v1.png');
const PRELOAD_IMAGE_ASSETS = [
  ...Object.values(PUFFERFISH_ASSETS),
  HOME_HERO_ASSET,
  HOME_BACKGROUND_ASSET,
  NAV_HOME_ASSET,
  NAV_LEVELS_ASSET,
  NAV_SETTINGS_ASSET,
  NAV_PLAY_ASSET,
  WORLD_BANNER_ASSET,
  LEVEL_COMPLETE_ASSET,
  LEVEL_CURRENT_ASSET,
  LEVEL_VICTORY_ASSET,
  GORSEN_GAMES_LOGO_ASSET,
  CORAL_WRECK_BOARD_ASSET,
  SHIPWRECK_WOOD_ASSET,
  CORAL_WRECK_SAND_ASSET,
  CORAL_WRECK_SIDE_ASSET,
  MERGE_BUBBLE_PARTICLE_ASSET,
];
const PRELOAD_AUDIO_ASSETS = [MUSIC_ASSET, DROP_SFX_ASSET, MERGE_SFX_ASSET, POP_SFX_ASSET];
const PRELOAD_ASSETS = [...PRELOAD_IMAGE_ASSETS, ...PRELOAD_AUDIO_ASSETS];
const PROGRESS_KEY = 'puf-puf-unlocked-level';
const LANGUAGE_KEY = 'puf-puf-language';
const MUSIC_KEY = 'puf-puf-music-enabled';
const SFX_KEY = 'bubblefin-sfx-enabled';

const UI = {
  tr: {
    oceanPuzzle: 'OKYANUS BULMACASI', complete: 'TAMAM', underwaterAdventure: 'SU ALTI MACERASI',
    tagline: 'Renkleri birleştir, balonları patlat,\nbalon balıklarını okyanusa kavuştur.', continue: 'DEVAM ET',
    start: 'MACERAYA BAŞLA', level: 'Bölüm', levels: 'BÖLÜMLER', settings: 'AYARLAR', oneFinger: 'TEK PARMAK',
    offline: 'İNTERNETSİZ', relaxing: 'RAHATLATICI', adventureMap: 'MACERA HARİTASI', chooseLevel: 'Bölümünü seç',
    world: 'DÜNYA', locked: 'Kilitli', colors: 'renk', moves: 'hamle', language: 'Dil', music: 'Müzik', soundEffects: 'Ses efektleri',
    completedLevel: 'TAMAMLANDI', currentLevel: 'SIRADAKİ BÖLÜM', congratulations: 'TEBRİKLER!',
    congratulationsCopy: 'Muhteşem oynadın! Balon balıklarını özgür bıraktın.', rescued: 'KURTARILDI',
    musicOn: 'Açık', musicOff: 'Kapalı', turkish: 'Türkçe', english: 'English', settingsCopy: 'Oyun deneyimini sana göre ayarla.',
    home: 'ANA SAYFA', saveNote: 'Seçimlerin bu cihazda otomatik kaydedilir.', goal: 'HEDEF', move: 'HAMLE',
    rescueGoal: 'Kurtarılacak balon balığı', nextBubble: 'BIRAKACAĞIN BALON', seahorse: 'balon balığı', singleColor: 'tek renk balon',
    rule: 'Komşu balonlarda renkleri topla', targetComplete: 'HEDEF TAMAM!', outOfMoves: 'SINIR AŞILDI',
    boundaryFailedCopy: 'Balonlar güvenli çizginin altında kalmalı.',
    free: 'Balon balıkları özgür!', tryAgain: 'Bir kez daha dene', nextLevel: 'SONRAKİ BÖLÜM', replay: 'TEKRAR OYNA',
    retry: 'YENİDEN DENE', returnLevels: 'Bölümlere dön', drop: 'Balona veya alt hizasına bas, kaydır ve bırak!',
    aiming: 'Balonu hizala • parmağını bırakınca düşecek',
    ready: 'Balona ya da alt hizasına basıp kaydır.', rolling: 'Balonlar serbestçe yuvarlanıyor!',
  },
  en: {
    oceanPuzzle: 'OCEAN PUZZLE', complete: 'DONE', underwaterAdventure: 'UNDERWATER ADVENTURE',
    tagline: 'Merge colors, pop the bubbles,\nand set the pufferfish free.', continue: 'CONTINUE',
    start: 'START ADVENTURE', level: 'Level', levels: 'LEVELS', settings: 'SETTINGS', oneFinger: 'ONE FINGER',
    offline: 'OFFLINE', relaxing: 'RELAXING', adventureMap: 'ADVENTURE MAP', chooseLevel: 'Choose a level',
    world: 'WORLD', locked: 'Locked', colors: 'colors', moves: 'moves', language: 'Language', music: 'Music', soundEffects: 'Sound effects',
    completedLevel: 'COMPLETED', currentLevel: 'NEXT LEVEL', congratulations: 'CONGRATULATIONS!',
    congratulationsCopy: 'Beautifully played! You set the pufferfish free.', rescued: 'RESCUED',
    musicOn: 'On', musicOff: 'Off', turkish: 'Türkçe', english: 'English', settingsCopy: 'Tune the game experience your way.',
    home: 'HOME', saveNote: 'Your choices are saved automatically on this device.', goal: 'GOAL', move: 'MOVES',
    rescueGoal: 'Pufferfish to rescue', nextBubble: 'NEXT BUBBLE', seahorse: 'pufferfish', singleColor: 'single-color bubble',
    rule: 'Collect matching colors in neighboring bubbles', targetComplete: 'TARGET COMPLETE!', outOfMoves: 'LIMIT CROSSED',
    boundaryFailedCopy: 'Keep every bubble below the safety line.',
    free: 'Pufferfish are free!', tryAgain: 'Try once more', nextLevel: 'NEXT LEVEL', replay: 'PLAY AGAIN',
    retry: 'TRY AGAIN', returnLevels: 'Back to levels', drop: 'Hold the bubble or its lane, drag and release!',
    aiming: 'Line up the bubble • release to drop',
    ready: 'Hold the bubble or its lane to aim.', rolling: 'The bubbles are rolling freely!',
  },
} as const;

const TUTORIALS = {
  tr: [
    {
      eyebrow: 'ALIŞTIRMA 1 / 3', title: 'Balonu bırak',
      body: 'Üstteki balona veya balonun altındaki dikey hizaya basılı tut. Sağa-sola sürükleyip aynı rengin üzerine bırak.',
      hint: 'Balona ya da alt hizasına bas, kaydır ve bırak.', action: 'OYNA',
    },
    {
      eyebrow: 'ALIŞTIRMA 2 / 3', title: 'Aynı renkleri eşleştir',
      body: 'Artık iki renk var. Gelen balonu yalnızca kendi rengiyle buluştur; farklı renkler birleşmez.',
      hint: 'Gelen rengi bul ve eşleşen balona bırak.', action: 'ANLADIM',
    },
    {
      eyebrow: 'ALIŞTIRMA 3 / 3', title: 'Birleştir ve kurtar',
      body: 'Üç rengi ayrı ayrı topla. Balon hedef sayıya ulaşınca patlar ve balon balıkları özgür kalır. Pembe çizgiyi aşma.',
      hint: 'Üç rengi tamamla, balonları patlat.', action: 'HAZIRIM',
    },
  ],
  en: [
    {
      eyebrow: 'PRACTICE 1 / 3', title: 'Drop the bubble',
      body: 'Hold the bubble or anywhere in its vertical lane. Drag left or right and release above the matching color.',
      hint: 'Hold the bubble or its lane, line up, and release.', action: 'PLAY',
    },
    {
      eyebrow: 'PRACTICE 2 / 3', title: 'Match the colors',
      body: 'There are now two colors. Guide each new bubble to its own color; different colors never merge.',
      hint: 'Find the matching color and release above it.', action: 'GOT IT',
    },
    {
      eyebrow: 'PRACTICE 3 / 3', title: 'Merge and rescue',
      body: 'Collect all three colors separately. A full bubble pops and frees its pufferfish. Stay below the pink line.',
      hint: 'Complete all three colors and pop the bubbles.', action: 'READY',
    },
  ],
} as const;

const CREATURES: Record<CreatureType, { body: string; dark: string; tint: string; label: string }> = {
  berry: { body: '#ff2d95', dark: '#a70052', tint: 'rgba(255,45,149,0.22)', label: 'Pembe' },
  coral: { body: '#ff6a00', dark: '#9e3600', tint: 'rgba(255,106,0,0.22)', label: 'Turuncu' },
  sun: { body: '#ffda00', dark: '#997000', tint: 'rgba(255,218,0,0.24)', label: 'Sarı' },
  mint: { body: '#16b84e', dark: '#066c2b', tint: 'rgba(22,184,78,0.22)', label: 'Yeşil' },
  aqua: { body: '#00a6a6', dark: '#005b61', tint: 'rgba(0,166,166,0.22)', label: 'Turkuaz' },
  sky: { body: '#006cff', dark: '#003c9e', tint: 'rgba(0,108,255,0.22)', label: 'Mavi' },
  plum: { body: '#8a2be2', dark: '#4e118e', tint: 'rgba(138,43,226,0.22)', label: 'Mor' },
  navy: { body: '#20242d', dark: '#07090d', tint: 'rgba(32,36,45,0.22)', label: 'Siyah' },
};

const ALL_COLORS: CreatureType[] = ['berry', 'coral', 'sun', 'mint', 'aqua', 'sky', 'plum', 'navy'];
const COLOR_LABELS: Record<Language, Record<CreatureType, string>> = {
  tr: { berry: 'Pembe', coral: 'Turuncu', sun: 'Sarı', mint: 'Yeşil', aqua: 'Turkuaz', sky: 'Mavi', plum: 'Mor', navy: 'Siyah' },
  en: { berry: 'Pink', coral: 'Orange', sun: 'Yellow', mint: 'Green', aqua: 'Turquoise', sky: 'Blue', plum: 'Purple', navy: 'Black' },
};
const LEVELS_PER_PAGE = 50;
const TOTAL_LEVELS = 800;
const WORLD_NAMES = ['Mercan Bahçesi', 'Köpük Koyu', 'İnci Akıntısı', 'Safir Derinlik', 'Ayışığı Resifi', 'Batık Gemi', 'Kristal Mağara', 'Fırtına Geçidi', 'Yıldız Lagünü', 'Okyanus Kapısı'];
const WORLD_SUBTITLES = ['Renkleri öğren', 'Akıntıyı yönet', 'Sürüleri ayır', 'Derinlere ilerle', 'Zincirler kur', 'Engelleri aş', 'Dar geçitleri çöz', 'Dengeyi koru', 'Usta birleşmeler yap', 'Okyanusu özgür bırak'];
const WORLD_NAMES_EN = ['Coral Garden', 'Bubble Cove', 'Pearl Current', 'Sapphire Depths', 'Moonlight Reef', 'Sunken Ship', 'Crystal Cave', 'Storm Passage', 'Star Lagoon', 'Ocean Gate'];
const WORLD_SUBTITLES_EN = ['Learn the colors', 'Guide the current', 'Separate the schools', 'Dive deeper', 'Build chain reactions', 'Clear the obstacles', 'Solve narrow passages', 'Keep the balance', 'Master every merge', 'Set the ocean free'];

const worldNameForPage = (page: number, language: Language) => {
  const names = language === 'tr' ? WORLD_NAMES : WORLD_NAMES_EN;
  const cycle = Math.floor(page / names.length) + 1;
  const name = names[page % names.length] as string;
  return cycle === 1 ? name : `${name} ${cycle}`;
};
const worldSubtitleForPage = (page: number, language: Language) => {
  const subtitles = language === 'tr' ? WORLD_SUBTITLES : WORLD_SUBTITLES_EN;
  return subtitles[page % subtitles.length] as string;
};

function buildLevels(): Level[] {
  const tutorials: Level[] = [
    { id: 1, name: WORLD_NAMES[0] as string, subtitle: WORLD_SUBTITLES[0] as string, moves: 6, goal: 6, merge: 6, palette: ['coral'], seed: [[7, 1, 'coral']], tutorial: 1 },
    { id: 2, name: WORLD_NAMES[0] as string, subtitle: WORLD_SUBTITLES[0] as string, moves: 10, goal: 12, merge: 6, palette: ['coral', 'sky'], seed: [[7, 1, 'coral'], [7, 4, 'sky']], tutorial: 2 },
    { id: 3, name: WORLD_NAMES[0] as string, subtitle: WORLD_SUBTITLES[0] as string, moves: 14, goal: 18, merge: 6, palette: ['coral', 'sky', 'mint'], seed: [[7, 0, 'coral'], [7, 3, 'sky'], [6, 2, 'mint']], tutorial: 3 },
  ];
  return Array.from({ length: TOTAL_LEVELS }, (_, index) => {
    if (index < tutorials.length) return tutorials[index] as Level;
    const world = Math.floor(index / LEVELS_PER_PAGE);
    const stage = index % LEVELS_PER_PAGE;
    const paletteSize = Math.min(ALL_COLORS.length, 3 + Math.floor((index - 3) / 20));
    const paletteOffset = Math.floor(world / 3) % ALL_COLORS.length;
    const palette = Array.from({ length: paletteSize }, (_, colorIndex) => ALL_COLORS[(paletteOffset + colorIndex) % ALL_COLORS.length] as CreatureType);
    const seedCount = Math.min(20, 8 + Math.floor(world / 2) + (stage % 4));
    const seed: Array<[number, number, CreatureType]> = Array.from({ length: seedCount }, (__, seedIndex) => {
      const row = 7 - Math.floor(seedIndex / COLS);
      const col = seedIndex % COLS;
      const colorIndex = (seedIndex + stage * 2 + world) % palette.length;
      return [row, col, palette[colorIndex] as CreatureType];
    });
    return {
      id: index + 1,
      name: worldNameForPage(world, 'tr'),
      subtitle: worldSubtitleForPage(world, 'tr'),
      moves: 18 + Math.min(34, world * 2 + Math.floor(stage / 5)),
      goal: Math.min(140, 18 + world * 7 + Math.floor(stage / 3) * 2),
      merge: 7 + Math.min(4, Math.floor(index / 160)),
      palette,
      seed,
    };
  });
}

const LEVELS: Level[] = buildLevels();

if (__DEV__) {
  const ids = new Set(LEVELS.map(level => level.id));
  if (LEVELS.length !== TOTAL_LEVELS || ids.size !== TOTAL_LEVELS) {
    throw new Error('Level catalog must contain 800 unique levels.');
  }
  if (LEVELS.slice(0, 3).some((level, index) => level.tutorial !== index + 1 || level.palette.length !== index + 1)) {
    throw new Error('The first three tutorial levels must introduce one color at a time.');
  }
}

let localIdSequence = 0;
const makePieceId = () => {
  localIdSequence += 1;
  return `${Date.now().toString(36)}-${localIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};
const makeDents = (): DentValues => ({
  left: new Animated.Value(0), right: new Animated.Value(0),
  top: new Animated.Value(0), bottom: new Animated.Value(0),
});
const makeDentLevels = (): DentLevels => ({ left: 0, right: 0, top: 0, bottom: 0 });
const makeCreatureMotion = () => ({
  creatureMotion: new Animated.ValueXY({ x: 0, y: 0 }),
  creatureRoll: new Animated.Value(0),
  creatureOffsetX: 0,
  creatureOffsetY: 0,
  creatureAngle: 0,
});
const ensureCreatureMotion = (piece: Piece) => {
  if (
    !piece.creatureMotion
    || !piece.creatureRoll
    || !Number.isFinite(piece.creatureOffsetX)
    || !Number.isFinite(piece.creatureOffsetY)
    || !Number.isFinite(piece.creatureAngle)
  ) {
    Object.assign(piece, makeCreatureMotion());
  }
};
const randomFrom = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)] as T;
const dominantType = (contents: CreatureType[], fallback: CreatureType): CreatureType => {
  const totals = new Map<CreatureType, number>();
  contents.forEach(type => totals.set(type, (totals.get(type) ?? 0) + 1));
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
};

function makeSeed(level: Level): Piece[] {
  const boardLayout = boardLayoutForLevel(level.id);
  const seedColumns = 4;
  const columnOrders = new Map<number, number[]>();
  const randomizedPieces: Piece[] = level.seed.map(([row, col, type], index) => {
    const amount = 3 + ((row + col + index) % 3);
    const contents = Array.from({ length: amount }, () => type);
    const size = bubbleSizeForCount(amount);
    const wallInset = BOARD_WALL_INSET;
    const layer = Math.floor(index / seedColumns);
    if (!columnOrders.has(layer)) {
      const order = Array.from({ length: seedColumns }, (_, columnIndex) => columnIndex);
      for (let cursor = order.length - 1; cursor > 0; cursor -= 1) {
        const swapIndex = Math.floor(Math.random() * (cursor + 1));
        [order[cursor], order[swapIndex]] = [order[swapIndex] as number, order[cursor] as number];
      }
      columnOrders.set(layer, order);
    }
    const column = (columnOrders.get(layer) as number[])[index % seedColumns] as number;
    const laneWidth = (BOARD_WIDTH - wallInset * 2) / seedColumns;
    const laneJitter = (Math.random() - 0.5) * laneWidth * 0.34;
    const x = Math.max(
      wallInset,
      Math.min(BOARD_WIDTH - size - wallInset, wallInset + column * laneWidth + (laneWidth - size) / 2 + laneJitter),
    );
    const floor = floorSurfaceAt(boardLayout, x + size / 2) - size;
    const y = Math.max(76, floor - layer * BUBBLE_SIZE * (0.78 + Math.random() * 0.13) - Math.random() * 11);
    return {
      id: makePieceId(), x, y,
      vx: (Math.random() - 0.5) * 0.5, vy: Math.random() * 0.35,
      phase: index * 0.73,
      driftStrength: 0.0008,
      entryDrift: 0,
      ...makeCreatureMotion(),
      position: new Animated.ValueXY({ x, y }),
      elastic: new Animated.ValueXY({ x: 1, y: 1 }),
      squashX: 1,
      squashY: 1,
      dents: makeDents(),
      dentLevels: makeDentLevels(),
      renderedDentLevels: makeDentLevels(),
      size,
      type,
      count: contents.length,
      contents,
      fresh: false,
      sleeping: false,
      settleFrames: 0,
      contactFrames: 0,
    };
  });
  // Let the randomized layout settle before the first frame. The player opens
  // onto a natural pile instead of seeing a rigid grid that only loosens after
  // the first drop.
  let settled = randomizedPieces;
  for (let pass = 0; pass < 240; pass += 1) {
    settled = stepPhysics(settled, boardLayout).pieces;
    if (pass > 30 && settled.every(piece => piece.sleeping)) break;
  }
  separateStartingColors(settled, level);
  settled.forEach(piece => {
    piece.position.setValue({ x: piece.x, y: piece.y });
    piece.renderedX = piece.x;
    piece.renderedY = piece.y;
    piece.elastic.setValue({ x: 1, y: 1 });
    piece.squashX = 1;
    piece.squashY = 1;
  });
  return settled;
}

function separateStartingColors(pieces: Piece[], level: Level) {
  if (level.tutorial || level.palette.length < 2) return;
  const adjacency = new Map<string, Set<string>>(pieces.map(piece => [piece.id, new Set<string>()]));
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      const a = pieces[i] as Piece;
      const b = pieces[j] as Piece;
      const distance = Math.hypot(
        a.x + a.size / 2 - (b.x + b.size / 2),
        a.y + a.size / 2 - (b.y + b.size / 2),
      );
      if (distance > ((a.size + b.size) / 2) * 1.055) continue;
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    }
  }

  const assigned = new Map<string, CreatureType>();
  const usage = new Map<CreatureType, number>(level.palette.map(type => [type, 0]));
  const pending = [...pieces];
  while (pending.length) {
    pending.sort((a, b) => {
      const aNeighborColors = new Set(
        [...(adjacency.get(a.id) ?? [])].map(id => assigned.get(id)).filter(Boolean),
      ).size;
      const bNeighborColors = new Set(
        [...(adjacency.get(b.id) ?? [])].map(id => assigned.get(id)).filter(Boolean),
      ).size;
      return bNeighborColors - aNeighborColors
        || (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0)
        || b.y - a.y;
    });
    const piece = pending.shift() as Piece;
    const neighborColors = [...(adjacency.get(piece.id) ?? [])]
      .map(id => assigned.get(id))
      .filter((type): type is CreatureType => Boolean(type));
    const rotation = (level.id + assigned.size) % level.palette.length;
    const candidates = level.palette.map((_, index) => level.palette[(rotation + index) % level.palette.length] as CreatureType);
    candidates.sort((a, b) => {
      const aConflicts = neighborColors.filter(type => type === a).length;
      const bConflicts = neighborColors.filter(type => type === b).length;
      return aConflicts - bConflicts || (usage.get(a) ?? 0) - (usage.get(b) ?? 0);
    });
    const type = candidates[0] as CreatureType;
    assigned.set(piece.id, type);
    usage.set(type, (usage.get(type) ?? 0) + 1);
    piece.type = type;
    piece.contents = Array.from({ length: piece.contents.length }, () => type);
    piece.count = piece.contents.length;
  }
}

function makeNext(level: Level, guaranteedType?: CreatureType): NextBubble {
  const type = guaranteedType ?? randomFrom(level.palette);
  const count = 3 + Math.floor(Math.random() * 3);
  const contents = Array.from({ length: count }, () => type);
  return { id: makePieceId(), type, count, contents };
}

function neighbors(piece: Piece, pieces: Piece[]) {
  return pieces.filter(
    other => {
      const distance = Math.hypot(
        other.x + other.size / 2 - (piece.x + piece.size / 2),
        other.y + other.size / 2 - (piece.y + piece.size / 2),
      );
      return other.type === piece.type && other.id !== piece.id && distance <= (piece.size + other.size) * 0.54;
    },
  );
}

function connectedGroup(start: Piece, pieces: Piece[]) {
  const found = new Map<string, Piece>([[start.id, start]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift() as Piece;
    neighbors(current, pieces).forEach(next => {
      if (!found.has(next.id)) {
        found.set(next.id, next);
        queue.push(next);
      }
    });
  }
  return [...found.values()];
}

function sortableContacts(pieces: Piece[]) {
  const contacts: Array<{ a: Piece; b: Piece }> = [];
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      const a = pieces[i] as Piece;
      const b = pieces[j] as Piece;
      const distance = Math.hypot(
        a.x + a.size / 2 - (b.x + b.size / 2),
        a.y + a.size / 2 - (b.y + b.size / 2),
      );
      if (distance > ((a.size + b.size) / 2) * 1.035) continue;
      const shared = ALL_COLORS.filter(color => a.contents.includes(color) && b.contents.includes(color));
      if (!shared.length) continue;
      contacts.push({ a, b });
    }
  }
  return contacts;
}

const colorContactKey = (a: Piece, b: Piece) => [a.id, b.id].sort().join('|');

type MergeReceiver = {
  color: CreatureType;
  sourceX: number;
  sourceY: number;
  added: number;
  sourcePoints: Array<{
    id: string;
    x: number;
    y: number;
    size: number;
    count: number;
    totalCount: number;
    indices: number[];
  }>;
};

type MergeMotion = {
  color: CreatureType;
  targetX: number;
  targetY: number;
};

function planColorMerges(
  pieces: Piece[],
  preferredId?: string,
  activeIds?: Set<string>,
  forcedContactKeys?: Set<string>,
) {
  const contacts = sortableContacts(pieces);
  if (forcedContactKeys?.size) {
    const existing = new Set(contacts.map(({ a, b }) => colorContactKey(a, b)));
    const byId = new Map(pieces.map(piece => [piece.id, piece]));
    forcedContactKeys.forEach(key => {
      if (existing.has(key)) return;
      const [aId, bId] = key.split('|');
      const a = byId.get(aId as string);
      const b = byId.get(bId as string);
      if (!a || !b || !a.contents.some(color => b.contents.includes(color))) return;
      contacts.push({ a, b });
      existing.add(key);
    });
  }
  const allocations = new Map<string, CreatureType[]>(pieces.map(piece => [piece.id, [...piece.contents]]));
  const affectedIds = new Set<string>();
  const usedReceivers = new Set<string>();
  const receivers = new Map<string, MergeReceiver>();
  const motions = new Map<string, MergeMotion>();
  let groupCount = 0;

  ALL_COLORS.forEach(color => {
    const colorPieces = pieces.filter(piece => piece.contents.includes(color));
    const adjacency = new Map<string, Set<string>>(colorPieces.map(piece => [piece.id, new Set<string>()]));
    contacts.forEach(({ a, b }) => {
      if (!a.contents.includes(color) || !b.contents.includes(color)) return;
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    });
    const unseen = new Set(colorPieces.map(piece => piece.id));
    while (unseen.size) {
      const firstId = unseen.values().next().value as string;
      unseen.delete(firstId);
      const ids = new Set<string>([firstId]);
      const queue = [firstId];
      while (queue.length) {
        const current = queue.shift() as string;
        adjacency.get(current)?.forEach(nextId => {
          if (!unseen.has(nextId)) return;
          unseen.delete(nextId);
          ids.add(nextId);
          queue.push(nextId);
        });
      }
      if (ids.size < 2) continue;
      const members = pieces.filter(piece => ids.has(piece.id));
      if (activeIds && !members.some(piece => activeIds.has(piece.id))) continue;
      const candidates = [...members].sort((a, b) => {
        const freeDifference = Number(!usedReceivers.has(b.id)) - Number(!usedReceivers.has(a.id));
        if (freeDifference) return freeDifference;
        // Keep the settled/lower bubble as the visual anchor. Making the newly
        // dropped bubble the receiver caused the whole group to jump back up at
        // first contact instead of flowing naturally into the resting bubble.
        const sleepingDifference = Number(Boolean(b.sleeping)) - Number(Boolean(a.sleeping));
        if (sleepingDifference) return sleepingDifference;
        const lowerDifference = (b.y + b.size / 2) - (a.y + a.size / 2);
        if (Math.abs(lowerDifference) > 1) return lowerDifference;
        const colorCountDifference = b.contents.filter(type => type === color).length
          - a.contents.filter(type => type === color).length;
        if (colorCountDifference) return colorCountDifference;
        // Only use the dropped bubble as a final tie-breaker when both candidates
        // occupy the same resting position.
        return Number(b.id === preferredId) - Number(a.id === preferredId);
      });
      const receiver = candidates[0] as Piece;
      const originalReceiverCount = receiver.contents.filter(type => type === color).length;
      const total = members.reduce(
        (sum, piece) => sum + (allocations.get(piece.id)?.filter(type => type === color).length ?? 0),
        0,
      );
      if (total <= originalReceiverCount) continue;
      const sources = members.filter(piece => piece.id !== receiver.id);
      sources.forEach(piece => {
        allocations.set(piece.id, (allocations.get(piece.id) ?? []).filter(type => type !== color));
        affectedIds.add(piece.id);
      });
      affectedIds.add(receiver.id);
      const receiverContents = allocations.get(receiver.id) ?? [];
      // Keep every fish already in the receiver in exactly the same order. This
      // preserves its React identity and lets it glide to the roomier layout
      // instead of disappearing and mounting again for a single frame.
      receiverContents.push(...Array.from({ length: total - originalReceiverCount }, () => color));
      allocations.set(receiver.id, receiverContents);
      usedReceivers.add(receiver.id);
      if (!motions.has(receiver.id)) {
        motions.set(receiver.id, {
          color,
          targetX: sources.reduce((sum, piece) => sum + piece.x, 0) / sources.length,
          targetY: sources.reduce((sum, piece) => sum + piece.y, 0) / sources.length,
        });
      }
      sources.forEach(piece => {
        if (!motions.has(piece.id)) motions.set(piece.id, { color, targetX: receiver.x, targetY: receiver.y });
      });
      receivers.set(receiver.id, {
        color,
        sourceX: sources.reduce((sum, piece) => sum + piece.x, 0) / sources.length,
        sourceY: sources.reduce((sum, piece) => sum + piece.y, 0) / sources.length,
        added: total - originalReceiverCount,
        sourcePoints: sources.map(piece => ({
          id: piece.id,
          x: piece.x,
          y: piece.y,
          size: piece.size,
          count: piece.contents.filter(type => type === color).length,
          totalCount: piece.contents.length,
          indices: piece.contents
            .map((type, index) => type === color ? index : -1)
            .filter(index => index >= 0),
        })),
      });
      groupCount += 1;
    }
  });
  return { allocations, affectedIds, receivers, motions, groupCount };
}

function verifyMergePlanner() {
  const fake = (id: string, x: number, y: number, contents: CreatureType[]) => ({
    id, x, y, contents, size: bubbleSizeForCount(contents.length),
  } as Piece);
  const close = BUBBLE_SIZE * 0.82;
  const mixed = [
    fake('a', 0, 0, ['coral', 'sky']),
    fake('b', close, 0, ['coral', 'mint']),
  ];
  const mixedPlan = planColorMerges(mixed, 'a');
  const mixedOutput = [...mixedPlan.allocations.values()].flat();
  if (
    mixedOutput.filter(type => type === 'coral').length !== 2
    || mixedOutput.filter(type => type === 'sky').length !== 1
    || mixedOutput.filter(type => type === 'mint').length !== 1
    || (mixedPlan.allocations.get('a') ?? []).filter(type => type === 'coral').length !== 2
    || (mixedPlan.allocations.get('b') ?? []).includes('coral')
    || !(mixedPlan.allocations.get('a') ?? []).includes('sky')
    || !(mixedPlan.allocations.get('b') ?? []).includes('mint')
  ) throw new Error('Merge planner changed or moved a non-matching color.');

  const parallel = [
    fake('g1', 0, 0, ['mint', 'mint']),
    fake('g2', close, 0, ['mint']),
    fake('y1', close * 4, 0, ['sun']),
    fake('y2', close * 5, 0, ['sun', 'sun']),
  ];
  const parallelPlan = planColorMerges(parallel);
  if (parallelPlan.groupCount !== 2) throw new Error('Independent same-color groups did not merge in parallel.');

  const gatedPlan = planColorMerges(parallel, 'g1', new Set(['g1']));
  if (
    gatedPlan.groupCount !== 1
    || (gatedPlan.allocations.get('y1') ?? []).length !== 1
    || (gatedPlan.allocations.get('y2') ?? []).length !== 2
  ) throw new Error('An unrelated resting color group merged without an active contact.');

  const fastA = fake('fast-a', 0, 0, ['coral', 'coral']);
  const fastB = fake('fast-b', close * 3, 0, ['coral']);
  const fastImpactPlan = planColorMerges(
    [fastA, fastB],
    'fast-b',
    new Set([fastA.id, fastB.id]),
    new Set([colorContactKey(fastA, fastB)]),
  );
  if (fastImpactPlan.groupCount !== 1) {
    throw new Error('A matching high-speed impact was lost before merge resolution.');
  }

  const falling = fake('falling', close, 0, ['plum', 'plum']);
  falling.sleeping = false;
  const resting = fake('resting', close, close, ['plum', 'plum', 'plum']);
  resting.sleeping = true;
  const anchoredPlan = planColorMerges([falling, resting], falling.id);
  if (!anchoredPlan.receivers.has(resting.id) || anchoredPlan.receivers.has(falling.id)) {
    throw new Error('A falling bubble replaced the resting merge anchor.');
  }
}

type ObstacleContact = { nx: number; ny: number; penetration: number; obstacle: BoardObstacle };

function obstacleContact(piece: Piece, obstacle: BoardObstacle, tolerance = 0): ObstacleContact | undefined {
  const radians = obstacle.angle * Math.PI / 180;
  const axisX = Math.cos(radians);
  const axisY = Math.sin(radians);
  // `length` is the complete visible capsule width. Its center segment is
  // therefore shorter by one diameter; using length / 2 here used to create
  // an invisible collision zone beyond both rounded ends.
  const halfLength = Math.max(0, (obstacle.length - obstacle.thickness) / 2);
  const centerX = piece.x + piece.size / 2;
  const centerY = piece.y + piece.size / 2;
  const relativeX = centerX - obstacle.cx;
  const relativeY = centerY - obstacle.cy;
  const projected = Math.max(-halfLength, Math.min(halfLength, relativeX * axisX + relativeY * axisY));
  const closestX = obstacle.cx + axisX * projected;
  const closestY = obstacle.cy + axisY * projected;
  const deltaX = centerX - closestX;
  const deltaY = centerY - closestY;
  const rawDistance = Math.hypot(deltaX, deltaY);
  const collisionDistance = piece.size / 2 + obstacle.thickness / 2 + BUBBLE_GAP + tolerance;
  if (rawDistance >= collisionDistance) return undefined;
  const nx = rawDistance > 0.001 ? deltaX / rawDistance : -axisY;
  const ny = rawDistance > 0.001 ? deltaY / rawDistance : -Math.abs(axisX);
  return { nx, ny, penetration: Math.max(0, collisionDistance - rawDistance), obstacle };
}

function resolveObstacleCollision(piece: Piece, obstacle: BoardObstacle, applyBounce = true) {
  const contact = obstacleContact(piece, obstacle);
  if (!contact) return undefined;
  piece.x += contact.nx * contact.penetration;
  piece.y += contact.ny * contact.penetration;
  if (applyBounce) {
    const normalVelocity = piece.vx * contact.nx + piece.vy * contact.ny;
    if (normalVelocity < 0) {
      piece.vx -= normalVelocity * contact.nx * 1.2;
      piece.vy -= normalVelocity * contact.ny * 1.2;
    }
    piece.vx *= 0.985;
    piece.vy *= 0.965;
  }
  return contact;
}

function stepPhysics(pieces: Piece[], layout: BoardLayout = DEFAULT_BOARD_LAYOUT) {
  const wallInset = BOARD_WALL_INSET;
  const next = pieces;
  const colorContactKeys = new Set<string>();
  next.forEach(piece => {
    // Fast Refresh can preserve Piece objects created by an older bundle.
    // Upgrade them in place before the new internal-creature animation runs.
    ensureCreatureMotion(piece);
    if (!piece.sleeping) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      const fallingDrift = Math.min(1, Math.abs(piece.vy) / 5);
      piece.vx = piece.vx * 0.99 + Math.sin(piece.phase) * piece.driftStrength * fallingDrift;
      piece.vy = Math.min(piece.vy * 0.998 + 0.43, 16.5);
    } else {
      piece.vx = 0;
      piece.vy = 0;
    }
    piece.phase += 0.04;
    piece.squashX = 1;
    piece.squashY = 1;
    (['left', 'right', 'top', 'bottom'] as DentSide[]).forEach(side => {
      piece.dentLevels[side] = 0;
    });
  });

  next.forEach(piece => {
    const floor = floorTopForPiece(piece, layout);
    if (piece.x < wallInset) {
      piece.x = wallInset;
      piece.vx = Math.abs(piece.vx) * 0.58;
    } else if (piece.x > BOARD_WIDTH - piece.size - wallInset) {
      piece.x = BOARD_WIDTH - piece.size - wallInset;
      piece.vx = -Math.abs(piece.vx) * 0.58;
    }
    if (piece.y < -piece.size * 0.62 && piece.vy < 0) {
      piece.y = -piece.size * 0.62;
      piece.vy = 0;
    } else if (piece.y > floor) {
      piece.y = floor;
      const impact = Math.abs(piece.vy);
      // One clearly visible but quickly damped hop: a fast drop rises only a
      // few pixels, then the next contact settles instead of vibrating.
      piece.vy = impact > 1.6 ? -Math.min(3.6, impact * 0.3) : 0;
      piece.vx *= 0.91;
      if (Math.abs(piece.vx) < 0.025) piece.vx = 0;
    }
    layout.obstacles.forEach(obstacle => resolveObstacleCollision(piece, obstacle));
  });

  const removed = new Set<string>();
  for (let i = 0; i < next.length; i += 1) {
    if (removed.has((next[i] as Piece).id)) continue;
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i] as Piece;
      const b = next[j] as Piece;
      if (removed.has(b.id)) continue;
      if (a.sleeping && b.sleeping) continue;
      const ax = a.x + a.size / 2;
      const ay = a.y + a.size / 2;
      const bx = b.x + b.size / 2;
      const by = b.y + b.size / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const rawDistance = Math.hypot(dx, dy);
      const distance = Math.max(0.01, rawDistance);
      const collisionDistance = collisionDistanceFor(a, b);
      if (distance >= collisionDistance) continue;
      const nx = rawDistance < 0.01 ? (i + j) % 2 ? 1 : -1 : dx / distance;
      const ny = rawDistance < 0.01 ? 0 : dy / distance;
      const overlap = collisionDistance - distance;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      const matchingContact = a.contents.some(color => b.contents.includes(color));
      if (matchingContact) colorContactKeys.add(colorContactKey(a, b));
      const aShare = a.sleeping && !b.sleeping ? 0 : b.sleeping && !a.sleeping ? 1 : 0.5;
      const bShare = 1 - aShare;
      a.x -= nx * overlap * aShare;
      a.y -= ny * overlap * aShare;
      b.x += nx * overlap * bShare;
      b.y += ny * overlap * bShare;
      if (relative < 0) {
        const impulse = -(1 + (matchingContact ? 0 : 0.12)) * relative;
        if (a.sleeping && !b.sleeping) {
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        } else if (b.sleeping && !a.sleeping) {
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
        } else {
          a.vx -= impulse * nx * 0.5;
          a.vy -= impulse * ny * 0.5;
          b.vx += impulse * nx * 0.5;
          b.vy += impulse * ny * 0.5;
        }
      }
    }
  }
  const result = removed.size ? next.filter(piece => !removed.has(piece.id)) : next;
  for (let pass = 0; pass < 6; pass += 1) {
    let correctedOverlap = false;
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const a = result[i] as Piece;
        const b = result[j] as Piece;
        if (a.sleeping && b.sleeping) continue;
        const dx = b.x + b.size / 2 - (a.x + a.size / 2);
        const dy = b.y + b.size / 2 - (a.y + a.size / 2);
        const rawDistance = Math.hypot(dx, dy);
        const distance = Math.max(0.01, rawDistance);
        const collisionDistance = collisionDistanceFor(a, b);
        if (distance >= collisionDistance) continue;
        correctedOverlap = true;
        const correction = collisionDistance - distance;
        const nx = rawDistance < 0.01 ? (i + j) % 2 ? 1 : -1 : dx / distance;
        const ny = rawDistance < 0.01 ? 0 : dy / distance;
        const aShare = a.sleeping && !b.sleeping ? 0 : b.sleeping && !a.sleeping ? 1 : 0.5;
        const bShare = 1 - aShare;
        a.x -= nx * correction * aShare;
        a.y -= ny * correction * aShare;
        b.x += nx * correction * bShare;
        b.y += ny * correction * bShare;
      }
    }
    result.forEach(piece => {
      const floor = floorTopForPiece(piece, layout);
      piece.x = Math.max(wallInset, Math.min(BOARD_WIDTH - piece.size - wallInset, piece.x));
      piece.y = Math.min(floor, piece.y);
      layout.obstacles.forEach(obstacle => resolveObstacleCollision(piece, obstacle, false));
    });
    if (!correctedOverlap) break;
  }

  const supported = new Set<string>();
  const bubbleSupported = new Set<string>();
  result.forEach(piece => {
    const floor = floorTopForPiece(piece, layout);
    if (floor - piece.y <= 1.25) supported.add(piece.id);
    const obstacleSupport = layout.obstacles.some(obstacle => {
      const contact = obstacleContact(piece, obstacle, 1.5);
      return Boolean(contact && contact.ny < -0.28);
    });
    if (obstacleSupport) supported.add(piece.id);
  });
  let supportChanged = true;
  while (supportChanged) {
    supportChanged = false;
    result.forEach(piece => {
      if (supported.has(piece.id)) return;
      const centerX = piece.x + piece.size / 2;
      const centerY = piece.y + piece.size / 2;
      const hasSupport = result.some(other => {
        if (!supported.has(other.id) || other.id === piece.id) return false;
        const otherCenterX = other.x + other.size / 2;
        const otherCenterY = other.y + other.size / 2;
        const combinedRadius = (piece.size + other.size) / 2;
        if (otherCenterY - centerY < combinedRadius * 0.26) return false;
        const distance = Math.hypot(otherCenterX - centerX, otherCenterY - centerY);
        return distance <= combinedRadius + BUBBLE_GAP + 1.35;
      });
      if (hasSupport) {
        supported.add(piece.id);
        bubbleSupported.add(piece.id);
        supportChanged = true;
      }
    });
  }
  result.forEach(piece => {
    const floor = floorTopForPiece(piece, layout);
    piece.x = Math.max(wallInset, Math.min(BOARD_WIDTH - piece.size - wallInset, piece.x));
    piece.y = Math.min(floor, piece.y);
    if (!supported.has(piece.id)) {
      piece.sleeping = false;
      piece.settleFrames = 0;
      piece.contactFrames = 0;
      return;
    }
    const onFloor = floor - piece.y <= 1.25;
    const supportingObstacle = layout.obstacles.find(obstacle => {
      const contact = obstacleContact(piece, obstacle, 1.7);
      return Boolean(contact && contact.ny < -0.28);
    });
    const centerX = piece.x + piece.size / 2;
    const centerY = piece.y + piece.size / 2;
    const lowerContacts = result.filter(other => {
      if (!supported.has(other.id) || other.id === piece.id) return false;
      const otherCenterX = other.x + other.size / 2;
      const otherCenterY = other.y + other.size / 2;
      const combinedRadius = (piece.size + other.size) / 2;
      if (otherCenterY - centerY < combinedRadius * 0.26) return false;
      return Math.hypot(otherCenterX - centerX, otherCenterY - centerY) <= combinedRadius + BUBBLE_GAP + 1.5;
    });
    const upperContacts = result.filter(other => {
      if (other.id === piece.id) return false;
      const otherCenterX = other.x + other.size / 2;
      const otherCenterY = other.y + other.size / 2;
      const combinedRadius = (piece.size + other.size) / 2;
      if (centerY - otherCenterY < combinedRadius * 0.24) return false;
      return Math.hypot(otherCenterX - centerX, otherCenterY - centerY) <= combinedRadius + BUBBLE_GAP + 2;
    });
    const hasLeftSupport = lowerContacts.some(other => other.x + other.size / 2 < centerX - 2);
    const hasRightSupport = lowerContacts.some(other => other.x + other.size / 2 > centerX + 2);
    const againstLeftWall = piece.x <= wallInset + 1;
    const againstRightWall = piece.x >= BOARD_WIDTH - piece.size - wallInset - 1;
    const floorDownhill = Math.sign(layout.floorSlope);
    const floorSlopeBlocked = floorDownhill < 0 ? againstLeftWall : floorDownhill > 0 ? againstRightWall : true;
    const slopedFloorSliding = onFloor && Math.abs(layout.floorSlope) > 2 && !floorSlopeBlocked && lowerContacts.length === 0;
    const obstacleRadians = supportingObstacle ? supportingObstacle.angle * Math.PI / 180 : 0;
    const obstacleDownhill = supportingObstacle
      ? Math.sign(Math.sin(obstacleRadians)) * Math.sign(Math.cos(obstacleRadians) || 1)
      : 0;
    const obstacleSlopeBlocked = obstacleDownhill < 0 ? againstLeftWall : obstacleDownhill > 0 ? againstRightWall : true;
    const obstacleSliding = Boolean(supportingObstacle)
      && Math.abs(supportingObstacle?.angle ?? 0) > 3
      && !obstacleSlopeBlocked
      && lowerContacts.length === 0;
    const stablePocket = (onFloor && !slopedFloorSliding)
      || (Boolean(supportingObstacle) && !obstacleSliding)
      || (hasLeftSupport && hasRightSupport)
      || ((againstLeftWall || againstRightWall) && lowerContacts.length > 0);
    const loadWeight = upperContacts.reduce((sum, other) => sum + Math.max(1, other.contents.length / 3), 0);
    const loadBias = loadWeight > 0
      ? upperContacts.reduce((sum, other) => {
        const weight = Math.max(1, other.contents.length / 3);
        const combinedRadius = (piece.size + other.size) / 2;
        return sum + ((other.x + other.size / 2 - centerX) / combinedRadius) * weight;
      }, 0) / loadWeight
      : 0;
    // Small numerical differences in a balanced stack must not wake a resting
    // bubble every other frame. Only a clearly off-centre load starts a slide.
    const loadDirection = Math.abs(loadBias) > 0.14 ? -Math.sign(loadBias) : 0;
    const loadSideBlocked = loadDirection !== 0 && (
      (loadDirection < 0 && againstLeftWall)
      || (loadDirection > 0 && againstRightWall)
      || result.some(other => {
        if (other.id === piece.id) return false;
        const otherCenterX = other.x + other.size / 2;
        const otherCenterY = other.y + other.size / 2;
        const combinedRadius = (piece.size + other.size) / 2;
        // Only same-height and lower bubbles can block the escape direction;
        // the upper bubble is the load that is squeezing this piece sideways.
        if (otherCenterY < centerY - combinedRadius * 0.12) return false;
        const projectedCenterX = centerX + loadDirection * 2.4;
        return Math.hypot(otherCenterX - projectedCenterX, otherCenterY - centerY) < combinedRadius - 0.3;
      })
    );
    const slidingUnderLoad = upperContacts.length > 0 && loadDirection !== 0 && !loadSideBlocked;
    const meaningfulLoadSlide = slidingUnderLoad && (Math.abs(loadBias) > 0.22 || loadWeight >= 4);
    // Sleeping is only valid while the piece still has a genuinely stable
    // pocket. When a merge/pop removes one of its supports, wake it immediately
    // so it can roll into the newly opened space instead of hanging in mid-air.
    if (piece.sleeping && stablePocket && !meaningfulLoadSlide) {
      piece.vx = 0;
      piece.vy = 0;
      piece.entryDrift = 0;
      return;
    }
    if (piece.sleeping) {
      piece.sleeping = false;
      piece.settleFrames = 0;
      piece.contactFrames = 0;
      piece.vy = Math.max(piece.vy, 0.24);
      if (meaningfulLoadSlide) {
        piece.entryDrift = 0;
      } else if (Math.abs(piece.entryDrift) < 0.01) {
        piece.entryDrift = Math.sin(piece.phase) >= 0 ? 0.11 : -0.11;
      }
    }
    piece.contactFrames = (piece.contactFrames ?? 0) + 1;
    if (!stablePocket && lowerContacts.length > 0) {
      const supportCenter = lowerContacts.reduce((sum, other) => sum + other.x + other.size / 2, 0) / lowerContacts.length;
      const downhill = Math.abs(centerX - supportCenter) > 1.5
        ? Math.sign(centerX - supportCenter)
        : Math.abs(centerX - BOARD_WIDTH / 2) > 3
          ? Math.sign(centerX - BOARD_WIDTH / 2)
          : Math.sin(piece.phase) >= 0 ? 1 : -1;
      piece.vx += downhill * 0.075;
    } else if (!onFloor && bubbleSupported.has(piece.id) && piece.contactFrames === 1 && Math.abs(piece.vx) < 0.1) {
      const direction = Math.abs(centerX - BOARD_WIDTH / 2) > 3
        ? Math.sign(centerX - BOARD_WIDTH / 2)
        : Math.sin(piece.phase) >= 0 ? 1 : -1;
      piece.vx = direction * 0.48;
    }
    if (meaningfulLoadSlide) {
      const loadAcceleration = Math.min(0.16, 0.065 + loadWeight * 0.018);
      piece.vx += loadDirection * loadAcceleration;
      piece.vx = Math.max(-3.4, Math.min(3.4, piece.vx));
      piece.contactFrames = 0;
    }
    if (slopedFloorSliding) {
      piece.vx += floorDownhill * Math.min(0.14, 0.055 + Math.abs(layout.floorSlope) * 0.0025);
      piece.vx = Math.max(-3.2, Math.min(3.2, piece.vx));
      piece.contactFrames = 0;
    }
    if (obstacleSliding) {
      piece.vx += obstacleDownhill * 0.085;
      piece.vx = Math.max(-3.2, Math.min(3.2, piece.vx));
      piece.contactFrames = 0;
    }
    // Keep a freshly dropped bubble rolling long enough to leave the shallow
    // crown between two bubbles. The drift fades out, so settled stacks remain
    // completely still and do not regain the old vibration problem.
    if (!onFloor && Math.abs(piece.entryDrift) >= 0.008 && (piece.contactFrames ?? 0) <= 28) {
      piece.vx += piece.entryDrift;
      piece.entryDrift *= 0.92;
      piece.vx = Math.max(-3.4, Math.min(3.4, piece.vx));
    } else if (onFloor) {
      piece.entryDrift = 0;
    }
    piece.vx *= onFloor ? 0.9 : 0.985;
    if (piece.vy > 0) piece.vy *= 0.42;
    const minimumContactFrames = onFloor ? 3 : 8;
    const calm = Math.abs(piece.vx) < 0.14 && Math.abs(piece.vy) < 0.5;
    if (stablePocket && !meaningfulLoadSlide && calm && (piece.contactFrames ?? 0) >= minimumContactFrames) {
      piece.sleeping = true;
      piece.vx = 0;
      piece.vy = 0;
      piece.x = Math.round(piece.x * 20) / 20;
      piece.y = Math.round(piece.y * 20) / 20;
      piece.settleFrames = 1;
    } else {
      piece.sleeping = false;
      piece.settleFrames = 0;
    }
  });
  result.forEach(piece => {
    const maxShift = Math.max(5.4, piece.size * 0.115);
    const targetX = Math.max(-maxShift, Math.min(maxShift, -piece.vx * 1.72));
    const targetY = Math.max(-maxShift * 0.82, Math.min(maxShift * 0.82, -piece.vy * 0.48));
    const targetAngle = Math.max(-24, Math.min(24, piece.vx * 7.4));
    const response = piece.sleeping ? 0.13 : 0.28;
    piece.creatureOffsetX += (targetX - piece.creatureOffsetX) * response;
    piece.creatureOffsetY += (targetY - piece.creatureOffsetY) * response;
    piece.creatureAngle += (targetAngle - piece.creatureAngle) * (piece.sleeping ? 0.09 : 0.18);
    if (piece.sleeping) {
      if (Math.abs(piece.creatureOffsetX) < 0.015) piece.creatureOffsetX = 0;
      if (Math.abs(piece.creatureOffsetY) < 0.015) piece.creatureOffsetY = 0;
      if (Math.abs(piece.creatureAngle) < 0.025) piece.creatureAngle = 0;
    }
  });
  return { pieces: result, structureChanged: removed.size > 0, colorContactKeys };
}

function verifyPhysicsStability() {
  const probe = (id: string, x: number, y: number, sleeping: boolean): Piece => ({
    id, x, y, vx: 0, vy: 0, phase: 0, driftStrength: 0, entryDrift: 0,
    ...makeCreatureMotion(),
    position: {} as Animated.ValueXY,
    elastic: {} as Animated.ValueXY,
    squashX: 1, squashY: 1,
    dents: {} as DentValues,
    dentLevels: makeDentLevels(),
    renderedDentLevels: makeDentLevels(),
    size: BUBBLE_SIZE,
    type: 'coral', count: 3, contents: ['coral', 'coral', 'coral'],
    sleeping, settleFrames: sleeping ? 5 : 0,
  });
  const floorY = BOARD_HEIGHT - BUBBLE_SIZE - FLOOR_CLEARANCE;
  const stableDistance = collisionDistanceFor(
    { size: BUBBLE_SIZE } as Piece,
    { size: BUBBLE_SIZE } as Piece,
  );
  const stableLeft = probe('stable-floor-left', BOARD_WALL_INSET + 8, floorY, true);
  const stableRight = probe('stable-floor-right', BOARD_WIDTH - BUBBLE_SIZE - BOARD_WALL_INSET - 8, floorY, true);
  const stableStack = [stableLeft, stableRight];
  const start = stableStack.flatMap(piece => [piece.x, piece.y]);
  for (let frame = 0; frame < 120; frame += 1) stepPhysics(stableStack);
  const end = stableStack.flatMap(piece => [piece.x, piece.y]);
  if (end.some((value, index) => Math.abs(value - (start[index] as number)) > 0.001)) {
    throw new Error('An unloaded resting bubble moved while asleep.');
  }

  const loadedBase = probe('loaded-base', BOARD_WIDTH / 2 - BUBBLE_SIZE / 2, floorY, true);
  const loadOffsetX = stableDistance * 0.32;
  const loadOffsetY = Math.sqrt(stableDistance ** 2 - loadOffsetX ** 2);
  const loadBubble = probe('load-bubble', loadedBase.x + loadOffsetX, floorY - loadOffsetY, true);
  const loadedBaseStartX = loadedBase.x;
  for (let frame = 0; frame < 40; frame += 1) stepPhysics([loadedBase, loadBubble]);
  if (Math.abs(loadedBase.x - loadedBaseStartX) < 1) {
    throw new Error('A bubble with an off-center load did not slide into open space.');
  }
  const unsupported = probe('unsupported', BOARD_WIDTH / 2, 90, true);
  stepPhysics([unsupported]);
  stepPhysics([unsupported]);
  if (unsupported.sleeping || unsupported.vy <= 0) {
    throw new Error('An unsupported sleeping bubble did not wake and fall.');
  }
  stepPhysics([unsupported]);
  if (unsupported.y <= 90) throw new Error('A woken unsupported bubble did not move downward.');

  const legacyPiece = probe('legacy-fast-refresh-piece', BOARD_WIDTH / 2, 90, false);
  delete (legacyPiece as Partial<Piece>).creatureMotion;
  delete (legacyPiece as Partial<Piece>).creatureRoll;
  delete (legacyPiece as Partial<Piece>).creatureOffsetX;
  delete (legacyPiece as Partial<Piece>).creatureOffsetY;
  delete (legacyPiece as Partial<Piece>).creatureAngle;
  stepPhysics([legacyPiece]);
  if (
    !legacyPiece.creatureMotion
    || !legacyPiece.creatureRoll
    || !Number.isFinite(legacyPiece.creatureOffsetX)
    || !Number.isFinite(legacyPiece.creatureOffsetY)
    || !Number.isFinite(legacyPiece.creatureAngle)
  ) throw new Error('A Piece retained by Fast Refresh was not upgraded safely.');

  const overlapA = probe('overlap-a', BOARD_WIDTH / 2 - BUBBLE_SIZE, floorY, true);
  const overlapB = probe('overlap-b', BOARD_WIDTH / 2 - BUBBLE_SIZE * 0.35, floorY, false);
  stepPhysics([overlapA, overlapB]);
  const separatedDistance = Math.hypot(
    overlapB.x + overlapB.size / 2 - (overlapA.x + overlapA.size / 2),
    overlapB.y + overlapB.size / 2 - (overlapA.y + overlapA.size / 2),
  );
  if (separatedDistance < collisionDistanceFor(overlapA, overlapB) - 0.02) {
    throw new Error('Bubble surfaces remained intersected after collision resolution.');
  }

  const slideBase = probe('slide-base', BOARD_WIDTH / 2, floorY, true);
  const slider = probe('slider', BOARD_WIDTH / 2, floorY - collisionDistanceFor(slideBase, slideBase), false);
  const sliderStartX = slider.x;
  for (let frame = 0; frame < 40; frame += 1) stepPhysics([slideBase, slider]);
  if (slider.sleeping || Math.abs(slider.x - sliderStartX) < 2) {
    throw new Error('A bubble resting on one support did not slide toward an open space.');
  }

  const sleepingBase = probe('sleeping-slide-base', BOARD_WIDTH / 2, floorY, true);
  const sleepingSlider = probe(
    'sleeping-slider',
    BOARD_WIDTH / 2,
    floorY - collisionDistanceFor(sleepingBase, sleepingBase),
    true,
  );
  const sleepingSliderStartX = sleepingSlider.x;
  for (let frame = 0; frame < 40; frame += 1) stepPhysics([sleepingBase, sleepingSlider]);
  if (sleepingSlider.sleeping || Math.abs(sleepingSlider.x - sleepingSliderStartX) < 2) {
    throw new Error('A sleeping bubble did not wake after losing a stable pocket.');
  }

  const capsule: BoardObstacle = {
    id: 'collision-visual-capsule', cx: 150, cy: 140,
    length: 110, thickness: 20, angle: 0, kind: 'stone',
  };
  const radius = BUBBLE_SIZE / 2;
  const visibleRightEdge = capsule.cx + capsule.length / 2;
  const justOutside = probe(
    'obstacle-just-outside',
    visibleRightEdge + radius + BUBBLE_GAP + 0.2 - radius,
    capsule.cy - radius,
    false,
  );
  if (obstacleContact(justOutside, capsule)) {
    throw new Error('An obstacle pushed a bubble before its visible edge.');
  }
  justOutside.x -= 0.4;
  if (!obstacleContact(justOutside, capsule)) {
    throw new Error('An obstacle did not collide at its visible edge.');
  }

  const roundBumper: BoardObstacle = {
    id: 'collision-visual-circle', cx: 150, cy: 140,
    length: 28, thickness: 28, angle: 0, kind: 'pearl',
  };
  const bumperEdge = roundBumper.cx + roundBumper.thickness / 2;
  const circleProbe = probe(
    'bumper-just-outside',
    bumperEdge + radius + BUBBLE_GAP + 0.2 - radius,
    roundBumper.cy - radius,
    false,
  );
  if (obstacleContact(circleProbe, roundBumper)) {
    throw new Error('A round bumper pushed a bubble before its visible edge.');
  }
  circleProbe.x -= 0.4;
  if (!obstacleContact(circleProbe, roundBumper)) {
    throw new Error('A round bumper did not collide at its visible edge.');
  }
}

if (__DEV__) {
  verifyMergePlanner();
  verifyPhysicsStability();
}

function commitPhysicsFrame(pieces: Piece[]) {
  pieces.forEach(piece => {
    ensureCreatureMotion(piece);
    if (
      piece.renderedX === undefined
      || piece.renderedY === undefined
      || Math.abs(piece.x - piece.renderedX) >= 0.03
      || Math.abs(piece.y - piece.renderedY) >= 0.03
    ) {
      piece.position.setValue({ x: piece.x, y: piece.y });
      piece.renderedX = piece.x;
      piece.renderedY = piece.y;
    }
    const renderedCreatureX = piece.renderedCreatureOffsetX ?? Number.NaN;
    const renderedCreatureY = piece.renderedCreatureOffsetY ?? Number.NaN;
    if (
      !Number.isFinite(renderedCreatureX)
      || !Number.isFinite(renderedCreatureY)
      || Math.abs(piece.creatureOffsetX - renderedCreatureX) >= 0.025
      || Math.abs(piece.creatureOffsetY - renderedCreatureY) >= 0.025
      || (piece.creatureOffsetX === 0 && renderedCreatureX !== 0)
      || (piece.creatureOffsetY === 0 && renderedCreatureY !== 0)
    ) {
      piece.creatureMotion.setValue({ x: piece.creatureOffsetX, y: piece.creatureOffsetY });
      piece.renderedCreatureOffsetX = piece.creatureOffsetX;
      piece.renderedCreatureOffsetY = piece.creatureOffsetY;
    }
    const renderedCreatureAngle = piece.renderedCreatureAngle ?? Number.NaN;
    if (
      !Number.isFinite(renderedCreatureAngle)
      || Math.abs(piece.creatureAngle - renderedCreatureAngle) >= 0.04
      || (piece.creatureAngle === 0 && renderedCreatureAngle !== 0)
    ) {
      piece.creatureRoll.setValue(piece.creatureAngle);
      piece.renderedCreatureAngle = piece.creatureAngle;
    }
    const renderedX = piece.renderedSquashX ?? 1;
    const renderedY = piece.renderedSquashY ?? 1;
    if (Math.abs(piece.squashX - renderedX) >= 0.012 || Math.abs(piece.squashY - renderedY) >= 0.012) {
      piece.elastic.setValue({ x: piece.squashX, y: piece.squashY });
      piece.renderedSquashX = piece.squashX;
      piece.renderedSquashY = piece.squashY;
    }
    (['left', 'right', 'top', 'bottom'] as DentSide[]).forEach(side => {
      const target = piece.dentLevels[side] < 0.025 ? 0 : piece.dentLevels[side];
      if (Math.abs(target - piece.renderedDentLevels[side]) >= 0.07 || (target === 0 && piece.renderedDentLevels[side] !== 0)) {
        piece.dents[side].setValue(target);
        piece.renderedDentLevels[side] = target;
      }
    });
  });
}

function Creature({ type, size = BUBBLE_SIZE }: { type: CreatureType; size?: number }) {
  const colors = CREATURES[type];
  const eye = Math.max(4, size * 0.1);
  return (
    <View
      style={[
        styles.creature,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.body,
          borderColor: colors.dark,
          shadowColor: colors.dark,
        },
      ]}
    >
      <View style={styles.ears}>
        <View style={[styles.ear, { backgroundColor: colors.dark, width: size * 0.22, height: size * 0.18 }]} />
        <View style={[styles.ear, { backgroundColor: colors.dark, width: size * 0.22, height: size * 0.18 }]} />
      </View>
      <View style={styles.face}>
        <View style={[styles.eye, { width: eye, height: eye, borderRadius: eye / 2 }]} />
        <View style={[styles.eye, { width: eye, height: eye, borderRadius: eye / 2 }]} />
      </View>
      <View style={[styles.smile, { width: size * 0.24, height: size * 0.12, borderRadius: size * 0.12 }]} />
      <View style={[styles.cheek, styles.cheekLeft]} />
      <View style={[styles.cheek, styles.cheekRight]} />
    </View>
  );
}

const seededUnit = (seed: string, index: number, salt: number) => {
  let hash = 2166136261;
  const value = `${seed}-${index}-${salt}`;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash ^= value.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

function freeSwimRoute(seed: string, index: number, count: number, size: number, miniSize: number) {
  const center = size / 2;
  // The image is 1.38x miniSize, so this radius places its outer edge directly
  // against the inside of the bubble while still keeping it safely clipped.
  const radius = Math.max(2, center - miniSize * 0.69 - 1.5);
  const rows = count <= 3
    ? [count]
    : count <= 6
      ? [3, count - 3]
      : count <= 8
        ? [4, count - 4]
        : [4, 4, count - 8];
  let remaining = index;
  let rowIndex = 0;
  while (rowIndex < rows.length - 1 && remaining >= (rows[rowIndex] as number)) {
    remaining -= rows[rowIndex] as number;
    rowIndex += 1;
  }
  const rowSize = rows[rowIndex] as number;
  const rowSpans = [0, 0.32, 0.54, 0.67];
  const rowSpan = rowSpans[Math.max(0, Math.min(3, rowSize - 1))] as number;
  const horizontal = rowSize <= 1 ? 0 : -rowSpan + rowSpan * 2 * remaining / (rowSize - 1);
  const stackRise = rowIndex * miniSize * 0.86;
  const restingX = radius * horizontal;
  const looseX = (seededUnit(seed, index, 240) - 0.5) * radius * 0.12;
  const rawX = Math.max(-radius * 0.94, Math.min(radius * 0.94, restingX + looseX));
  // Follow the circular floor instead of orbiting around the bubble centre.
  // The lowest row remains flush with the inner wall and extra rows pile upward.
  const floorY = Math.sqrt(Math.max(0, radius * radius - rawX * rawX));
  const rawY = floorY - stackRise;
  const magnitude = Math.hypot(rawX, rawY);
  const guard = magnitude > radius ? radius / magnitude : 1;
  const restingTilt = (seededUnit(seed, index, 97) - 0.5) * 12;
  return {
    center,
    x: rawX * guard,
    y: rawY * guard,
    tilt: restingTilt,
    rotate: `${restingTilt}deg`,
    fallDistance: Math.max(size * 0.48, radius * 1.35 - stackRise),
  };
}
const ESCAPE_PATHS = [
  { x: -78, y: -225, rotate: '-24deg' },
  { x: -43, y: -268, rotate: '-11deg' },
  { x: -13, y: -242, rotate: '-3deg' },
  { x: 25, y: -278, rotate: '9deg' },
  { x: 58, y: -232, rotate: '22deg' },
  { x: 86, y: -258, rotate: '31deg' },
  { x: -94, y: -288, rotate: '-30deg' },
  { x: 8, y: -310, rotate: '4deg' },
  { x: 98, y: -294, rotate: '28deg' },
] as const;
const BUBBLE_PARTICLE_PATHS = [
  { x: -46, y: -42, size: 8 },
  { x: -24, y: -68, size: 5 },
  { x: 2, y: -76, size: 10 },
  { x: 31, y: -61, size: 6 },
  { x: 51, y: -34, size: 9 },
  { x: 59, y: -7, size: 4 },
  { x: -57, y: -12, size: 6 },
  { x: -39, y: 18, size: 4 },
  { x: 37, y: 13, size: 5 },
  { x: -12, y: -91, size: 4 },
  { x: 18, y: -103, size: 7 },
  { x: 68, y: -52, size: 4 },
] as const;
const MERGE_BUBBLE_PATHS = [
  { x: -42, y: -54, size: 15 },
  { x: -18, y: -76, size: 10 },
  { x: 8, y: -88, size: 17 },
  { x: 34, y: -66, size: 12 },
  { x: 48, y: -38, size: 14 },
  { x: -50, y: -27, size: 9 },
  { x: 24, y: -104, size: 8 },
] as const;

function MiniCreature({ type, size }: { type: CreatureType; size: number }) {
  return (
    <Image
      source={PUFFERFISH_ASSETS[type]}
      resizeMode="contain"
      style={{ width: size * 1.38, height: size * 1.38 }}
    />
  );
}

function SwimmingPufferfish({
  type,
  size,
  bubbleSize,
  seed,
  index,
  count,
  settleInstantly,
  smoothLayout,
}: {
  type: CreatureType;
  size: number;
  bubbleSize: number;
  seed: string;
  index: number;
  count: number;
  settleInstantly?: boolean;
  smoothLayout?: boolean;
}) {
  const gravityDrop = useRef(new Animated.Value(0)).current;
  const route = freeSwimRoute(seed, index, count, bubbleSize, size);
  const targetLayoutX = route.center - size * 0.69 + route.x;
  const targetLayoutY = route.center - size * 0.69 + route.y;
  const layoutPosition = useRef(new Animated.ValueXY({ x: targetLayoutX, y: targetLayoutY })).current;
  const didInitializeLayout = useRef(false);
  const didInitializeGravity = useRef(false);

  useEffect(() => {
    if (!didInitializeLayout.current) {
      didInitializeLayout.current = true;
      layoutPosition.setValue({ x: targetLayoutX, y: targetLayoutY });
      return;
    }
    const relocation = smoothLayout
      ? Animated.timing(layoutPosition, {
        toValue: { x: targetLayoutX, y: targetLayoutY },
        duration: MERGE_ANIMATION_MS - 20,
        easing: Easing.bezier(0.2, 0.78, 0.18, 1),
        useNativeDriver: true,
      })
      : Animated.spring(layoutPosition, {
        toValue: { x: targetLayoutX, y: targetLayoutY },
        damping: 13,
        stiffness: 118,
        mass: 0.68,
        useNativeDriver: true,
      });
    relocation.start();
    return () => relocation.stop();
  }, [layoutPosition, smoothLayout, targetLayoutX, targetLayoutY]);

  useEffect(() => {
    if (settleInstantly) {
      gravityDrop.stopAnimation();
      gravityDrop.setValue(0);
      didInitializeGravity.current = true;
      return;
    }
    if (didInitializeGravity.current) return;
    didInitializeGravity.current = true;
    gravityDrop.setValue(-route.fallDistance);
    const settling = Animated.sequence([
      Animated.delay(index * 38),
      Animated.spring(gravityDrop, {
        toValue: 0,
        damping: 8,
        stiffness: 105,
        mass: 0.62,
        useNativeDriver: true,
      }),
    ]);
    settling.start();
    return () => {
      settling.stop();
    };
  }, [gravityDrop, settleInstantly]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: [
          { translateX: layoutPosition.x },
          { translateY: Animated.add(gravityDrop, layoutPosition.y) },
          { rotate: route.rotate },
        ],
      }}
    >
      <MiniCreature type={type} size={size} />
    </Animated.View>
  );
}

const Bubble = React.memo(function Bubble({
  type,
  count,
  contents,
  size = BUBBLE_SIZE,
  dents,
  layoutSeed = `${type}-${count}`,
  creatureMotion,
  creatureRoll,
  creatureFade,
  settleInstantly,
  smoothLayout,
  layoutCount,
}: {
  type: CreatureType;
  count: number;
  contents?: CreatureType[];
  size?: number;
  dents?: DentValues;
  layoutSeed?: string;
  creatureMotion?: Animated.ValueXY;
  creatureRoll?: Animated.Value;
  creatureFade?: Animated.Value;
  settleInstantly?: boolean;
  smoothLayout?: boolean;
  layoutCount?: number;
}) {
  const colors = CREATURES[type];
  const visibleContents = (contents ?? Array.from({ length: count }, () => type)).slice(0, 10);
  const visibleCount = Math.max(visibleContents.length, Math.min(layoutCount ?? visibleContents.length, 10));
  const creatureScale = Math.max(0.25, 0.47 - Math.min(10, visibleCount) * 0.021);
  const miniSize = Math.max(17, Math.min(30, size * creatureScale));
  const layerRotation = creatureRoll
    ? creatureRoll.interpolate({
      inputRange: [-24, 24],
      outputRange: ['-24deg', '24deg'],
      extrapolate: 'clamp',
    })
    : '0deg';

  return (
    <View style={[styles.bubbleFrame, { width: size, height: size, borderRadius: size / 2 }]}>
    <View style={[styles.bubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(226,248,255,0.48)', borderColor: '#68b7d3' }]}>
      <View style={styles.bubbleShine} />
      <View style={styles.waterLine} />
      <View style={[styles.microBubble, { left: '18%', top: '50%' }]} />
      <View style={[styles.microBubble, { right: '16%', top: '31%', width: 4, height: 4 }]} />
      <View style={[styles.microBubble, { right: '24%', bottom: '17%', width: 3, height: 3 }]} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.creatureLayer,
          creatureFade && {
            opacity: creatureFade.interpolate({
              inputRange: [0, 0.06, 0.3, 0.52, 1],
              outputRange: [1, 1, 0.42, 0, 0],
            }),
          },
          {
            transform: [
              { translateX: creatureMotion?.x ?? 0 },
              { translateY: creatureMotion?.y ?? 0 },
              { rotate: layerRotation },
            ],
          },
        ]}
      >
      {visibleContents.map((creatureType, index) => {
        const occurrence = visibleContents.slice(0, index).filter(typeAtIndex => typeAtIndex === creatureType).length;
        return (
        <SwimmingPufferfish
          key={`${layoutSeed}-${creatureType}-${occurrence}`}
          type={creatureType}
          size={miniSize}
          bubbleSize={size}
          seed={layoutSeed}
          index={index}
          count={visibleCount}
          settleInstantly={settleInstantly}
          smoothLayout={smoothLayout}
        />
        );
      })}
      </Animated.View>
      {dents && (
        <>
          <Animated.View style={[styles.dentCut, { left: -size * 0.13, top: size * 0.29, width: size * 0.28, height: size * 0.42, borderRadius: size * 0.2, opacity: dents.left, transform: [{ scale: dents.left.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]} />
          <Animated.View style={[styles.dentCut, { right: -size * 0.13, top: size * 0.29, width: size * 0.28, height: size * 0.42, borderRadius: size * 0.2, opacity: dents.right, transform: [{ scale: dents.right.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]} />
          <Animated.View style={[styles.dentCut, { left: size * 0.29, top: -size * 0.13, width: size * 0.42, height: size * 0.28, borderRadius: size * 0.2, opacity: dents.top, transform: [{ scale: dents.top.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]} />
          <Animated.View style={[styles.dentCut, { left: size * 0.29, bottom: -size * 0.13, width: size * 0.42, height: size * 0.28, borderRadius: size * 0.2, opacity: dents.bottom, transform: [{ scale: dents.bottom.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]} />
        </>
      )}
    </View>
    </View>
  );
});

function RescueFlight({ flight }: { flight: RescueFlightSpec }) {
  const travel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    travel.setValue(0);
    const animation = Animated.timing(travel, {
      toValue: 1,
      duration: RESCUE_FLIGHT_MS,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [travel]);

  const targetX = flight.targetX - flight.startX;
  const targetY = flight.targetY - flight.startY;
  return (
    <View pointerEvents="none" style={styles.rescueFlightLayer}>
      {ESCAPE_PATHS.slice(0, Math.min(flight.count, ESCAPE_PATHS.length)).map((path, index) => {
        const start = 0.045 + index * 0.024;
        const turn1 = start + (1 - start) * 0.14;
        const turn2 = start + (1 - start) * 0.3;
        const turn3 = start + (1 - start) * 0.5;
        const turn4 = start + (1 - start) * 0.69;
        const turn5 = start + (1 - start) * 0.84;
        const wave = (index % 2 ? 1 : -1) * (7 + (index % 3) * 2);
        const scatterX = path.x * 0.58;
        return (
          <Animated.View
            key={`${flight.id}-rescued-${index}`}
            style={[
              styles.escapeSwimmer,
              { left: flight.startX - 17, top: flight.startY - 25 },
              {
                opacity: travel.interpolate({ inputRange: [0, start, start + 0.065, 0.95, 1], outputRange: [0, 0, 1, 1, 0] }),
                transform: [
                  { translateX: travel.interpolate({ inputRange: [0, start, turn1, turn2, turn3, turn4, turn5, 1], outputRange: [0, 0, scatterX * 0.22 + wave, scatterX * 0.55 - wave, scatterX + wave, targetX * 0.46 + scatterX * 0.34, targetX * 0.78 + wave * 0.3, targetX] }) },
                  { translateY: travel.interpolate({ inputRange: [0, start, turn1, turn2, turn3, turn4, turn5, 1], outputRange: [0, 0, -14, targetY * 0.2 - 24, targetY * 0.4 - 34, targetY * 0.62 - 22, targetY * 0.83 - 8, targetY] }) },
                  { rotate: travel.interpolate({ inputRange: [0, start, turn1, turn2, turn3, turn4, turn5, 1], outputRange: ['0deg', '0deg', index % 2 ? '-12deg' : '12deg', index % 2 ? '10deg' : '-10deg', index % 2 ? '-8deg' : '8deg', index % 2 ? '7deg' : '-7deg', index % 2 ? '-4deg' : '4deg', '0deg'] }) },
                  { scaleX: travel.interpolate({ inputRange: [0, 0.24, 0.46, 0.68, 0.86, 1], outputRange: [0.9, 1, 0.94, 1, 0.96, 0.94] }) },
                  { scale: travel.interpolate({ inputRange: [0, start, start + 0.12, 0.76, 0.91, 1], outputRange: [0.32, 0.32, 1.06, 1.02, 0.7, 0.24] }) },
                ],
              },
            ]}
          >
            <View style={[styles.escapeGlow, { backgroundColor: CREATURES[flight.type].tint, shadowColor: CREATURES[flight.type].body }]} />
            <Animated.View style={[styles.swimWake, { opacity: travel.interpolate({ inputRange: [0, start, start + 0.1, 0.88, 1], outputRange: [0, 0, 0.68, 0.3, 0] }), transform: [{ scaleX: travel.interpolate({ inputRange: [0, start + 0.1, 1], outputRange: [0.2, 1, 1.5] }) }] }]} />
            <Image source={PUFFERFISH_ASSETS[flight.type]} resizeMode="contain" style={styles.escapePufferfishImage} />
            <View style={styles.swimBubbleLarge} />
            <View style={styles.swimBubbleSmall} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const GamePiece = React.memo(function GamePiece({ piece, exiting }: { piece: Piece; exiting: boolean }) {
  const vanish = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const fusion = useRef(new Animated.Value(piece.merging ? 0 : 1)).current;
  const sortFlow = useRef(new Animated.Value(0)).current;
  const landing = useRef(new Animated.Value(1)).current;
  const mergeSource = Boolean(piece.merging && piece.contents.length === 0);
  const transferOrigins = (piece.transferSources ?? []).flatMap(source =>
    source.indices
      .filter(sourceIndex => sourceIndex < Math.min(source.totalCount, 10))
      .map(sourceIndex => ({ ...source, sourceIndex })),
  );
  const finalVisibleCount = Math.min(piece.contents.length, 10);
  const displayedVisibleCount = Math.min(piece.displayContents?.length ?? piece.count, 10);
  const finalCreatureScale = Math.max(0.25, 0.47 - finalVisibleCount * 0.021);
  const finalMiniSize = Math.max(17, Math.min(30, piece.size * finalCreatureScale));
  const visibleTransferCount = Math.min(
    8,
    piece.transferAmount ?? 1,
    Math.max(0, finalVisibleCount - displayedVisibleCount),
    transferOrigins.length,
  );

  useEffect(() => {
    landing.stopAnimation();
    if (!piece.fresh) {
      landing.setValue(1);
      return;
    }
    landing.setValue(0);
    const entry = Animated.timing(landing, {
      toValue: 1,
      duration: 540,
      easing: Easing.bezier(0.18, 0.72, 0.24, 1),
      useNativeDriver: true,
    });
    entry.start();
    return () => entry.stop();
  }, [landing, piece.fresh]);

  useEffect(() => {
    if (piece.merging) {
      fusion.stopAnimation();
      squash.stopAnimation();
      sortFlow.stopAnimation();
      fusion.setValue(0);
      squash.setValue(1);
      sortFlow.setValue(0);
      Animated.parallel([
        Animated.timing(squash, { toValue: 1, duration: MERGE_ANIMATION_MS, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(fusion, { toValue: 1, duration: MERGE_ANIMATION_MS - 20, easing: Easing.bezier(0.2, 0.78, 0.18, 1), useNativeDriver: true }),
        Animated.timing(sortFlow, { toValue: 1, duration: MERGE_ANIMATION_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]).start();
    }
  }, [fusion, piece.mergeReceiver, piece.merging, sortFlow, squash]);

  useEffect(() => {
    if (exiting) {
      vanish.stopAnimation();
      vanish.setValue(0);
      piece.elastic.setValue({ x: 1, y: 1 });
      Animated.timing(vanish, {
        toValue: 1,
        duration: POP_ANIMATION_MS,
        easing: Easing.bezier(0.22, 0.72, 0.2, 1),
        useNativeDriver: true,
      }).start();
    }
  }, [exiting, piece.elastic, vanish]);

  return (
    <Animated.View
      testID={`piece-${piece.id}`}
      pointerEvents="none"
      style={[styles.piece, { width: piece.size, height: piece.size, transform: piece.position.getTranslateTransform() }]}
    >
      <Animated.View style={[styles.elasticBody, { width: piece.size, height: piece.size, transform: [{ scaleX: piece.elastic.x }, { scaleY: piece.elastic.y }] }]}> 
      <Animated.View
        style={[
          styles.pieceBody,
          {
          width: piece.size,
          height: piece.size,
          opacity: mergeSource
            ? fusion.interpolate({ inputRange: [0, 0.7, 0.82, 0.96, 1], outputRange: [1, 1, 0.94, 0.18, 0] })
            : vanish.interpolate({ inputRange: [0, 0.96, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: fusion.interpolate({ inputRange: mergeSource ? [0, 1] : [0, 0.48, 1], outputRange: mergeSource ? [0, 0] : [0, piece.mergeDx ?? 0, 0] }) },
            { translateY: fusion.interpolate({ inputRange: mergeSource ? [0, 1] : [0, 0.48, 1], outputRange: mergeSource ? [0, 0] : [0, piece.mergeDy ?? 0, 0] }) },
            { scale: fusion.interpolate({
              inputRange: mergeSource ? [0, 0.68, 0.82, 0.92, 1] : [0, 1],
              outputRange: mergeSource
                ? [1, 1, 1.035, 0.88, 0.06]
                : [piece.mergeStartScale ?? 1, 1],
            }) },
            { scaleX: landing.interpolate({ inputRange: [0, 0.5, 0.78, 1], outputRange: piece.merging ? [1, 1, 1, 1] : [0.94, 0.975, 1.035, 1] }) },
            { scaleY: landing.interpolate({ inputRange: [0, 0.5, 0.78, 1], outputRange: piece.merging ? [1, 1, 1, 1] : [1.075, 1.035, 0.975, 1] }) },
            { scale: squash },
          ],
          },
        ]}
      >
      <Animated.View
        style={[
          styles.motionTrail,
          {
            opacity: landing.interpolate({ inputRange: [0, 0.2, 0.72, 1], outputRange: [0.2, 0.14, 0.04, 0] }),
            transform: [{ scaleY: landing.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1.45, 0.72, 0.25] }) }],
          },
        ]}
      />
      <View style={styles.motionShadow} />
      {exiting && (
        <>
          <Animated.View
            style={[
              styles.completionFlash,
              {
                opacity: vanish.interpolate({ inputRange: [0, 0.07, 0.18, 0.32, 1], outputRange: [0, 0.92, 0.54, 0, 0] }),
                transform: [{ scale: vanish.interpolate({ inputRange: [0, 0.2, 0.38, 1], outputRange: [0.25, 1.15, 1.52, 1.52] }) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.popRing,
              {
                opacity: vanish.interpolate({ inputRange: [0, 0.045, 0.27, 1], outputRange: [0, 1, 0, 0] }),
                transform: [{ scale: vanish.interpolate({ inputRange: [0, 0.27, 1], outputRange: [0.42, 1.82, 2.02] }) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.popRingSecondary,
              {
                opacity: vanish.interpolate({ inputRange: [0, 0.075, 0.31, 1], outputRange: [0, 0.72, 0, 0] }),
                transform: [{ scale: vanish.interpolate({ inputRange: [0, 0.075, 0.31, 1], outputRange: [0.28, 0.5, 2.12, 2.12] }) }],
              },
            ]}
          />
          {BUBBLE_PARTICLE_PATHS.map((path, index) => {
            const start = 0.018 + index * 0.011;
            const end = 0.6 + (index % 4) * 0.025;
            return (
              <Animated.View
                key={`pop-bubble-${index}`}
                style={[
                  styles.effectBubble,
                  {
                    left: piece.size / 2 - path.size / 2,
                    top: piece.size / 2 - path.size / 2,
                    width: path.size,
                    height: path.size,
                    borderRadius: path.size / 2,
                    opacity: vanish.interpolate({ inputRange: [0, start, start + 0.045, end, 1], outputRange: [0, 0, 0.96, 0.58, 0] }),
                    transform: [
                      { translateX: vanish.interpolate({ inputRange: [0, start, 1], outputRange: [0, 0, path.x * 1.25] }) },
                      { translateY: vanish.interpolate({ inputRange: [0, start, 0.38, 1], outputRange: [0, 0, path.y * 0.42, path.y * 1.55] }) },
                      { scale: vanish.interpolate({ inputRange: [0, start, start + 0.08, 1], outputRange: [0.2, 0.2, 1.08, 0.42] }) },
                    ],
                  },
                ]}
              />
            );
          })}
        </>
      )}
      {exiting && ESCAPE_PATHS.slice(0, 5).map((path, index) => (
        <Animated.View
          key={`drop-${index}`}
          style={[
            styles.waterDrop,
            { left: piece.size / 2 - 4, top: piece.size / 2 - 4 },
            {
              opacity: vanish.interpolate({ inputRange: [0, 0.08, 0.6, 1], outputRange: [0, 0.9, 0.55, 0] }),
              transform: [
                { translateX: vanish.interpolate({ inputRange: [0, 1], outputRange: [0, path.x * 0.72] }) },
                { translateY: vanish.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, -22, path.y * 0.48] }) },
                { scale: vanish.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.2, 1, 0.45] }) },
              ],
            },
          ]}
        />
      ))}
      {piece.merging && piece.mergeReceiver && MERGE_BUBBLE_PATHS.map((path, index) => {
        const start = 0.055 + index * 0.026;
        const end = 0.76 + (index % 3) * 0.025;
        return (
          <Animated.Image
            key={`merge-bubble-${index}`}
            source={MERGE_BUBBLE_PARTICLE_ASSET}
            resizeMode="contain"
            style={[
              styles.mergeBubbleParticle,
              {
                left: piece.size / 2 - path.size / 2,
                top: piece.size / 2 - path.size / 2,
                width: path.size,
                height: path.size,
                opacity: fusion.interpolate({ inputRange: [0, start, start + 0.07, end, 1], outputRange: [0, 0, 1, 0.72, 0] }),
                transform: [
                  { translateX: fusion.interpolate({ inputRange: [0, start, 0.55, 1], outputRange: [0, 0, path.x * 0.45, path.x] }) },
                  { translateY: fusion.interpolate({ inputRange: [0, start, 0.52, 1], outputRange: [0, 0, path.y * 0.36, path.y] }) },
                  { scale: fusion.interpolate({ inputRange: [0, start, start + 0.12, 0.72, 1], outputRange: [0.2, 0.2, 1.08, 0.92, 0.56] }) },
                ],
              },
            ]}
          />
        );
      })}
      {mergeSource && (
        <>
          <Animated.View
            style={[
              styles.emptyMergeFlash,
              {
                opacity: fusion.interpolate({ inputRange: [0, 0.68, 0.78, 0.9, 1], outputRange: [0, 0, 0.72, 0.2, 0] }),
                transform: [{ scale: fusion.interpolate({ inputRange: [0, 0.68, 0.88, 1], outputRange: [0.35, 0.35, 1.12, 1.48] }) }],
              },
            ]}
          />
          {MERGE_BUBBLE_PATHS.slice(0, 6).map((path, index) => (
            <Animated.Image
              key={`empty-pop-${index}`}
              source={MERGE_BUBBLE_PARTICLE_ASSET}
              resizeMode="contain"
              style={[
                styles.mergeBubbleParticle,
                {
                  left: piece.size / 2 - path.size / 2,
                  top: piece.size / 2 - path.size / 2,
                  width: path.size,
                  height: path.size,
                  opacity: fusion.interpolate({ inputRange: [0, 0.68, 0.76, 0.96, 1], outputRange: [0, 0, 1, 0.42, 0] }),
                  transform: [
                    { translateX: fusion.interpolate({ inputRange: [0, 0.68, 1], outputRange: [0, 0, path.x * 0.76] }) },
                    { translateY: fusion.interpolate({ inputRange: [0, 0.68, 1], outputRange: [0, 0, path.y * 0.76] }) },
                    { scale: fusion.interpolate({ inputRange: [0, 0.72, 0.84, 1], outputRange: [0.2, 0.2, 1.05, 0.52] }) },
                  ],
                },
              ]}
            />
          ))}
        </>
      )}
      <Animated.View
        style={{
          opacity: vanish.interpolate({ inputRange: [0, 0.055, 0.12, 0.2, 1], outputRange: [1, 1, 0.8, 0, 0] }),
          transform: [
            { scaleX: vanish.interpolate({ inputRange: [0, 0.055, 0.11, 0.18, 0.26, 1], outputRange: [1, 0.94, 1.17, 0.58, 0.06, 0.06] }) },
            { scaleY: vanish.interpolate({ inputRange: [0, 0.055, 0.11, 0.18, 0.26, 1], outputRange: [1, 1.12, 1.04, 0.68, 0.06, 0.06] }) },
          ],
        }}
      >
        <Bubble
          type={piece.type}
          count={piece.mergeReceiver ? piece.displayContents?.length ?? piece.count : piece.count}
          contents={piece.mergeReceiver ? piece.displayContents ?? piece.contents : piece.contents}
          size={piece.size}
          dents={piece.dents}
          layoutSeed={piece.id}
          creatureMotion={piece.creatureMotion}
          creatureRoll={piece.creatureRoll}
          settleInstantly={Boolean(piece.settleCreaturesInstantly || piece.sleeping || piece.merging)}
          smoothLayout={Boolean(piece.merging)}
          layoutCount={piece.mergeReceiver ? finalVisibleCount : undefined}
        />
      </Animated.View>
      </Animated.View>
      {piece.merging && piece.mergeReceiver && piece.transferType && Array.from({ length: visibleTransferCount }, (_, index) => {
        const origin = transferOrigins[index % Math.max(1, transferOrigins.length)]
          ?? { id: piece.id, x: piece.x + (piece.transferDx ?? 0), y: piece.y + (piece.transferDy ?? 0), size: piece.size, count: 1, totalCount: 1, indices: [0], sourceIndex: 0 };
        const sourceVisibleCount = Math.max(1, Math.min(origin.totalCount, 10));
        const sourceCreatureScale = Math.max(0.25, 0.47 - sourceVisibleCount * 0.021);
        const sourceMiniSize = Math.max(17, Math.min(30, origin.size * sourceCreatureScale));
        const sourceRoute = freeSwimRoute(origin.id, origin.sourceIndex, sourceVisibleCount, origin.size, sourceMiniSize);
        const sourceLayoutX = origin.x - piece.x + sourceRoute.center - sourceMiniSize * 0.69 + sourceRoute.x;
        const sourceLayoutY = origin.y - piece.y + sourceRoute.center - sourceMiniSize * 0.69 + sourceRoute.y;
        const finalIndex = Math.min(finalVisibleCount - 1, displayedVisibleCount + index);
        const finalRoute = freeSwimRoute(piece.id, Math.max(0, finalIndex), Math.max(1, finalVisibleCount), piece.size, finalMiniSize);
        const targetLayoutX = finalRoute.center - finalMiniSize * 0.69 + finalRoute.x;
        const targetLayoutY = finalRoute.center - finalMiniSize * 0.69 + finalRoute.y;
        return (
        <Animated.View
          key={`swim-transfer-${index}`}
          style={[
            styles.transferCreature,
            { left: targetLayoutX, top: targetLayoutY, width: finalMiniSize * 1.38, height: finalMiniSize * 1.38 },
            {
              opacity: 1,
              transform: [
                { translateX: sortFlow.interpolate({ inputRange: [0, 1], outputRange: [sourceLayoutX - targetLayoutX, 0] }) },
                { translateY: sortFlow.interpolate({ inputRange: [0, 1], outputRange: [sourceLayoutY - targetLayoutY, 0] }) },
                { rotate: sortFlow.interpolate({ inputRange: [0, 1], outputRange: [sourceRoute.rotate, finalRoute.rotate] }) },
                { scale: sortFlow.interpolate({ inputRange: [0, 1], outputRange: [sourceMiniSize / finalMiniSize, 1] }) },
              ],
            },
          ]}
        >
          <MiniCreature type={piece.transferType as CreatureType} size={finalMiniSize} />
        </Animated.View>
        );
      })}
      </Animated.View>
    </Animated.View>
  );
});

function LoadingDots() {
  const dots = useRef([new Animated.Value(0.45), new Animated.Value(0.45), new Animated.Value(0.45)]).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.stagger(120, dots.map(dot => Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0.45, duration: 260, useNativeDriver: true }),
      ]))),
    );
    pulse.start();
    return () => pulse.stop();
  }, [dots]);
  return (
    <View style={styles.loadingDots}>
      {dots.map((dot, index) => (
        <Animated.View key={index} style={[styles.loaderDot, { opacity: dot, transform: [{ scale: dot }] }]} />
      ))}
    </View>
  );
}

function AssetNavButton({ source, label, onPress, compact = false }: { source: number; label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.assetNavButton, compact && styles.assetNavButtonCompact, pressed && styles.assetNavButtonPressed]}>
      <Image source={source} resizeMode="contain" style={[styles.assetNavIcon, compact && styles.assetNavIconCompact]} />
      {!compact && <Text style={styles.assetNavLabel}>{label}</Text>}
    </Pressable>
  );
}

function BootScreen({ ready, progress, onExitStarted, onFinished, onImageDecoded }: {
  ready: boolean;
  progress: number;
  onExitStarted: () => void;
  onFinished: () => void;
  onImageDecoded: (index: number) => void;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  const bubbleRise = useRef(new Animated.Value(0)).current;
  const progressFill = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const curtain = useRef(new Animated.Value(0)).current;
  const finishingRef = useRef(false);

  useEffect(() => {
    const entranceAnimation = Animated.spring(entrance, {
      toValue: 1,
      damping: 11,
      stiffness: 105,
      mass: 0.72,
      useNativeDriver: true,
    });
    const bubbleAnimation = Animated.loop(Animated.timing(bubbleRise, {
      toValue: 1,
      duration: 2300,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
      isInteraction: false,
    }));
    entranceAnimation.start();
    bubbleAnimation.start();
    return () => {
      entranceAnimation.stop();
      bubbleAnimation.stop();
    };
  }, [bubbleRise, entrance]);

  useEffect(() => {
    if (ready) return;
    Animated.timing(progressFill, {
      toValue: Math.min(0.985, Math.max(0, progress)),
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
      isInteraction: false,
    }).start();
  }, [progress, progressFill, ready]);

  useEffect(() => {
    if (!ready || finishingRef.current) return;
    finishingRef.current = true;
    progressFill.stopAnimation();
    Animated.timing(progressFill, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
      isInteraction: false,
    }).start(() => {
      Animated.delay(180).start(({ finished: delayFinished }) => {
        if (!delayFinished) return;
        Animated.timing(curtain, {
          toValue: 1,
          duration: 560,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
          isInteraction: false,
        }).start(({ finished: covered }) => {
          if (!covered) return;
          exit.setValue(1);
          onExitStarted();
          Animated.delay(120).start(({ finished: holdFinished }) => {
            if (!holdFinished) return;
            Animated.timing(curtain, {
              toValue: 2,
              duration: 720,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
              isInteraction: false,
            }).start(({ finished }) => {
              if (finished) onFinished();
            });
          });
        });
      });
    });
  }, [curtain, exit, onExitStarted, onFinished, progressFill, ready]);

  const bubbleLift = bubbleRise.interpolate({ inputRange: [0, 1], outputRange: [12, -16] });
  return (
    <Animated.View style={styles.bootScreen}>
      <Animated.View
        style={[
          styles.bootVisualLayer,
          {
            opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] }) }],
          },
        ]}
      >
      <ImageBackground source={HOME_BACKGROUND_ASSET} resizeMode="cover" style={styles.bootBackground} imageStyle={styles.bootBackgroundImage}>
        <View style={styles.bootBackgroundTint} />
      </ImageBackground>
      <View style={styles.bootWaterGlow} />
      <Animated.View style={[styles.bootBubble, styles.bootBubbleOne, { transform: [{ translateY: bubbleLift }] }]} />
      <Animated.View style={[styles.bootBubble, styles.bootBubbleTwo, { transform: [{ translateY: Animated.multiply(bubbleLift, -0.7) }] }]} />
      <Animated.View style={[styles.bootBubble, styles.bootBubbleThree, { transform: [{ translateY: Animated.multiply(bubbleLift, 0.55) }] }]} />
      <Animated.View
        style={[
          styles.bootBrand,
          {
            opacity: entrance,
            transform: [
              { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
            ],
          },
        ]}
      >
        <View style={styles.bootTitleBlock}>
          <Text style={styles.homeLogo}>BUBBLEFIN</Text>
          <Text style={styles.homeLogoAccent}>POP</Text>
        </View>
        <Animated.View style={[styles.bootHeroWrap, { transform: [{ translateY: Animated.multiply(bubbleLift, 0.28) }] }]}>
          <View style={styles.bootHeroGlow} />
          <Image source={HOME_HERO_ASSET} resizeMode="contain" style={styles.bootHeroImage} />
        </Animated.View>
      </Animated.View>
      <View style={styles.bootLoadingCard}>
        <View style={styles.bootLoadingHeader}>
          <Text style={styles.bootSubtitle}>{ready ? 'OKYANUS HAZIR' : 'OKYANUS HAZIRLANIYOR'}</Text>
          <Text style={styles.bootProgressPercent}>{Math.round(Math.min(1, progress) * 100)}%</Text>
        </View>
        <View style={styles.bootProgressTrack}>
          <Animated.View style={[styles.bootProgressFill, { width: progressFill.interpolate({ inputRange: [0, 1], outputRange: [0, 246] }) }]}>
            <View style={styles.bootProgressHighlight} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.bootStudioBrand}>
        <Image source={GORSEN_GAMES_LOGO_ASSET} resizeMode="contain" style={styles.bootStudioLogo} />
        <Text style={styles.bootStudio}>GÖRSEN GAMES</Text>
      </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bootTransitionCurtain,
          {
            transform: [{
              translateY: curtain.interpolate({
                inputRange: [0, 1, 2],
                outputRange: [SCREEN_HEIGHT + 30, 0, -SCREEN_HEIGHT - 30],
              }),
            }],
          },
        ]}
      >
        <View style={styles.bootCurtainTopFoam} />
        <View style={styles.bootCurtainGlow} />
        <View style={[styles.bootCurtainBubble, styles.bootCurtainBubbleOne]} />
        <View style={[styles.bootCurtainBubble, styles.bootCurtainBubbleTwo]} />
        <View style={[styles.bootCurtainBubble, styles.bootCurtainBubbleThree]} />
        <View style={styles.bootCurtainBrand}>
          <Image source={GORSEN_GAMES_LOGO_ASSET} resizeMode="contain" style={styles.bootCurtainLogo} />
          <Text style={styles.bootCurtainStudioText}>GÖRSEN GAMES</Text>
        </View>
      </Animated.View>
      <View style={styles.bootPreloadRack} pointerEvents="none">
        {PRELOAD_IMAGE_ASSETS.map((source, index) => (
          <Image key={index} source={source} style={styles.bootPreloadImage} onLoadEnd={() => onImageDecoded(index)} />
        ))}
      </View>
    </Animated.View>
  );
}

function Home({ unlocked, language, onContinue, onLevels, onSettings }: { unlocked: number; language: Language; onContinue: () => void; onLevels: () => void; onSettings: () => void }) {
  const copy = UI[language];
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: -7, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 5, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [float]);

  const currentLevel = Math.min(LEVELS.length, Math.max(1, unlocked));
  const completed = Math.max(0, Math.min(LEVELS.length, unlocked - 1));

  return (
    <ImageBackground source={HOME_BACKGROUND_ASSET} resizeMode="cover" style={styles.home} imageStyle={styles.homeBackgroundImage}>
      <View style={styles.homeTint} />
      <View style={styles.homeTopBar}>
        <View style={styles.homeTopActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.settings} onPress={onSettings} style={({ pressed }) => [styles.homeSettingsButton, pressed && styles.assetNavButtonPressed]}>
          <Image source={NAV_SETTINGS_ASSET} resizeMode="contain" style={styles.homeSettingsIcon} />
        </Pressable>
        <View style={styles.homeProgressPill}>
          <Text style={styles.homeProgressValue}>{completed}</Text>
          <Text style={styles.homeProgressLabel}>{copy.complete}</Text>
        </View>
        </View>
      </View>

      <View style={styles.homeTitleBlock}>
        <Text style={styles.homeEyebrow}>{copy.underwaterAdventure}</Text>
        <Text style={styles.homeLogo}>BUBBLEFIN</Text>
        <Text style={styles.homeLogoAccent}>POP</Text>
      </View>

      <Animated.View style={[styles.homeHeroWrap, { transform: [{ translateY: float }] }]}>
        <View style={styles.homeHeroGlow} />
        <Animated.Image source={HOME_HERO_ASSET} resizeMode="contain" style={styles.homeHeroImage} />
      </Animated.View>

      <View style={styles.homeActionCard}>
        <Text style={styles.homeTagline}>{copy.tagline}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unlocked > 1 ? `${copy.level} ${currentLevel} ${copy.continue}` : copy.start}
          onPress={onContinue}
          style={({ pressed }) => [styles.homePrimaryButton, pressed && styles.homeButtonPressed]}
        >
          <View style={styles.homeButtonShine} />
          <Image source={NAV_PLAY_ASSET} resizeMode="contain" style={styles.homePlayAsset} />
          <View style={styles.homeButtonCopy}>
            <Text style={styles.homePrimaryLabel}>{unlocked > 1 ? copy.continue : copy.start}</Text>
            <Text style={styles.homePrimarySub}>{copy.level} {currentLevel}</Text>
          </View>
          <Text style={styles.homeButtonArrow}>›</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.levels} onPress={onLevels} style={({ pressed }) => [styles.homeSecondaryButton, pressed && styles.homeSecondaryPressed]}>
          <Image source={NAV_LEVELS_ASSET} resizeMode="contain" style={styles.homeSecondaryAsset} />
          <Text style={styles.homeSecondaryLabel}>{copy.levels}</Text>
          <Text style={styles.homeSecondaryMeta}>{LEVELS.length} {language === 'tr' ? 'BÖLÜM' : 'LEVELS'}</Text>
        </Pressable>
      </View>

      <View style={styles.homeBrandFooter} pointerEvents="none">
        <Image source={GORSEN_GAMES_LOGO_ASSET} resizeMode="contain" style={styles.homeBrandLogo} />
        <Text style={styles.homeBrandText}>GÖRSEN GAMES</Text>
      </View>

    </ImageBackground>
  );
}

function Settings({ language, musicEnabled, soundEnabled, onLanguage, onMusic, onSound, onHome, onLevels }: {
  language: Language;
  musicEnabled: boolean;
  soundEnabled: boolean;
  onLanguage: (language: Language) => void;
  onMusic: (enabled: boolean) => void;
  onSound: (enabled: boolean) => void;
  onHome: () => void;
  onLevels: () => void;
}) {
  const copy = UI[language];
  return (
    <ImageBackground source={HOME_BACKGROUND_ASSET} resizeMode="cover" style={styles.settingsPage}>
      <View style={styles.settingsTint} />
      <View style={styles.settingsHeader}>
        <AssetNavButton source={NAV_HOME_ASSET} label={copy.home} onPress={onHome} compact />
        <View style={styles.settingsTitleWrap}>
          <Text style={styles.settingsEyebrow}>{copy.oceanPuzzle}</Text>
          <Text style={styles.settingsTitle}>{copy.settings}</Text>
        </View>
        <AssetNavButton source={NAV_LEVELS_ASSET} label={copy.levels} onPress={onLevels} compact />
      </View>

      <View style={styles.settingsHero}>
        <Image source={NAV_SETTINGS_ASSET} resizeMode="contain" style={styles.settingsHeroIcon} />
        <Text style={styles.settingsCopy}>{copy.settingsCopy}</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>{copy.language}</Text>
        <View style={styles.languageSelector}>
          <Pressable onPress={() => onLanguage('tr')} style={({ pressed }) => [styles.languageOption, language === 'tr' && styles.languageOptionActive, pressed && styles.settingPressed]}>
            <Text style={styles.languageFlag}>TR</Text><Text style={[styles.languageText, language === 'tr' && styles.languageTextActive]}>{copy.turkish}</Text>
          </Pressable>
          <Pressable onPress={() => onLanguage('en')} style={({ pressed }) => [styles.languageOption, language === 'en' && styles.languageOptionActive, pressed && styles.settingPressed]}>
            <Text style={styles.languageFlag}>EN</Text><Text style={[styles.languageText, language === 'en' && styles.languageTextActive]}>{copy.english}</Text>
          </Pressable>
        </View>

        <View style={styles.settingDivider} />
        <View style={styles.musicRow}>
          <View style={styles.musicIconBubble}><Text style={styles.musicIcon}>♫</Text></View>
          <View style={styles.musicCopy}><Text style={styles.settingLabel}>{copy.music}</Text><Text style={styles.settingMeta}>{musicEnabled ? copy.musicOn : copy.musicOff}</Text></View>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: musicEnabled }} onPress={() => onMusic(!musicEnabled)} style={[styles.musicSwitch, musicEnabled && styles.musicSwitchOn]}>
            <Animated.View style={[styles.musicKnob, musicEnabled && styles.musicKnobOn]} />
          </Pressable>
        </View>
        <View style={styles.settingDivider} />
        <View style={styles.musicRow}>
          <View style={styles.musicIconBubble}><Text style={styles.soundIcon}>◉</Text></View>
          <View style={styles.musicCopy}><Text style={styles.settingLabel}>{copy.soundEffects}</Text><Text style={styles.settingMeta}>{soundEnabled ? copy.musicOn : copy.musicOff}</Text></View>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: soundEnabled }} onPress={() => onSound(!soundEnabled)} style={[styles.musicSwitch, soundEnabled && styles.musicSwitchOn]}>
            <Animated.View style={[styles.musicKnob, soundEnabled && styles.musicKnobOn]} />
          </Pressable>
        </View>
        <Text style={styles.settingsSaveNote}>{copy.saveNote}</Text>
      </View>
    </ImageBackground>
  );
}

function LevelCard({ level, order, language, locked, completed, current, onPress }: {
  level: Level;
  order: number;
  language: Language;
  locked: boolean;
  completed: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const copy = UI[language];
  const entrance = useRef(new Animated.Value(0)).current;
  const accent = CREATURES[level.palette[0] as CreatureType].body;

  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      delay: order * 55,
      damping: 15,
      stiffness: 145,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [entrance, level.id, order]);

  return (
    <Animated.View style={[styles.levelTileAnimator, {
      opacity: entrance,
      transform: [
        { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
        { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
      ],
    }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.level} ${level.id}${locked ? `, ${copy.locked}` : ''}`}
        disabled={locked}
        onPress={onPress}
        style={({ pressed }) => [
          styles.levelTile,
          completed && styles.levelTileComplete,
          current && styles.levelTileCurrent,
          locked && styles.levelLocked,
          pressed && styles.cardPressed,
        ]}
      >
        <View style={[styles.levelCardWash, { backgroundColor: accent }]} />
        <View style={styles.levelCardSheen} />
        <View style={styles.levelCardTop}>
          <View style={styles.levelMedallionWrap}>
            {completed && <Image source={LEVEL_COMPLETE_ASSET} resizeMode="contain" style={styles.levelMedallionAsset} />}
            {current && <Image source={LEVEL_CURRENT_ASSET} resizeMode="contain" style={styles.levelMedallionAsset} />}
            {!completed && !current && (
              <View style={[styles.levelLockedMedallion, !locked && { backgroundColor: accent }]}>
                <Text style={styles.levelLockedSymbol}>{locked ? '⌁' : level.id}</Text>
              </View>
            )}
            {(completed || current) && (
              <View style={[styles.levelNumberChip, completed && styles.levelNumberChipComplete]}>
                <Text style={styles.levelNumberChipText}>{completed ? '✓' : level.id}</Text>
              </View>
            )}
          </View>
          <View style={styles.levelCardCopy}>
            <Text style={styles.levelName}>{copy.level} {level.id}</Text>
            <Text style={styles.levelStateLabel}>
              {level.tutorial
                ? language === 'tr' ? `ALIŞTIRMA ${level.tutorial}/3` : `PRACTICE ${level.tutorial}/3`
                : locked ? copy.locked : completed ? copy.completedLevel : current ? copy.currentLevel : copy.currentLevel}
            </Text>
          </View>
        </View>

        <View style={styles.levelColorStrip}>
          {level.palette.slice(0, 6).map((type, index) => (
            <View key={`${type}-${index}`} style={[styles.levelColorPearl, { backgroundColor: CREATURES[type].body }]} />
          ))}
          {level.palette.length > 6 && <Text style={styles.levelMoreColors}>+{level.palette.length - 6}</Text>}
        </View>

        <View style={styles.levelStatsRow}>
          <View style={styles.levelGoalPill}><Text style={styles.levelGoalText}>✦ {level.goal}</Text></View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function LevelSelect({ unlocked, language, onSelect, onHome, onSettings }: { unlocked: number; language: Language; onSelect: (index: number) => void; onHome: () => void; onSettings: () => void }) {
  const copy = UI[language];
  const pageCount = Math.ceil(LEVELS.length / LEVELS_PER_PAGE);
  const [page, setPage] = useState(Math.min(pageCount - 1, Math.floor((Math.max(1, unlocked) - 1) / LEVELS_PER_PAGE)));
  const pageLevels = LEVELS.slice(page * LEVELS_PER_PAGE, (page + 1) * LEVELS_PER_PAGE);
  const dotStart = Math.max(0, Math.min(pageCount - 5, page - 2));
  const visiblePages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => dotStart + index);
  return (
    <ImageBackground source={HOME_BACKGROUND_ASSET} resizeMode="cover" style={styles.levelPage}>
      <View style={styles.levelBackdropTint} pointerEvents="none" />
      <View style={styles.pageHeader}>
        <AssetNavButton source={NAV_HOME_ASSET} label={copy.home} onPress={onHome} compact />
        <View><Text style={styles.eyebrow}>{copy.adventureMap}</Text><Text style={styles.pageTitle}>{copy.chooseLevel}</Text></View>
        <AssetNavButton source={NAV_SETTINGS_ASSET} label={copy.settings} onPress={onSettings} compact />
      </View>
      <ImageBackground source={WORLD_BANNER_ASSET} resizeMode="stretch" style={styles.worldBanner} imageStyle={styles.worldBannerImage}>
        <Text style={styles.worldEyebrow}>{copy.world} {page + 1}</Text>
        <Text style={styles.worldTitle}>{worldNameForPage(page, language)}</Text>
        <Text style={styles.worldSubtitle}>{worldSubtitleForPage(page, language)} • {LEVELS_PER_PAGE} {language === 'tr' ? 'bölüm' : 'levels'}</Text>
      </ImageBackground>
      <View style={styles.pageSwitcher}>
        <Pressable disabled={page === 0} onPress={() => setPage(value => Math.max(0, value - 1))} style={({ pressed }) => [styles.pageArrow, page === 0 && styles.pageArrowDisabled, pressed && styles.iconButtonPressed]}><Text style={styles.pageArrowText}>‹</Text></Pressable>
        <View style={styles.pageDots}>
          {visiblePages.map(index => <View key={index} style={[styles.pageDot, index === page && styles.pageDotActive]} />)}
          <Text style={styles.pageCounter}>{page + 1} / {pageCount}</Text>
        </View>
        <Pressable disabled={page === pageCount - 1} onPress={() => setPage(value => Math.min(pageCount - 1, value + 1))} style={({ pressed }) => [styles.pageArrow, page === pageCount - 1 && styles.pageArrowDisabled, pressed && styles.iconButtonPressed]}><Text style={styles.pageArrowText}>›</Text></Pressable>
      </View>
      <ScrollView style={styles.levelScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.levelGrid}>
        {pageLevels.map((level, order) => {
          const index = level.id - 1;
          const locked = level.id > unlocked;
          const completed = level.id < unlocked;
          const current = level.id === unlocked;
          return (
            <LevelCard
              key={level.id}
              level={level}
              order={order}
              language={language}
              locked={locked}
              completed={completed}
              current={current}
              onPress={() => onSelect(index)}
            />
          );
        })}
      </ScrollView>
    </ImageBackground>
  );
}

function Game({ levelIndex, language, onExit, onHome, onSettings, onNext, onComplete, onSound, hasNext }: { levelIndex: number; language: Language; onExit: () => void; onHome: () => void; onSettings: () => void; onNext: () => void; onComplete: () => void; onSound: (cue: AudioCue) => void; hasNext: boolean }) {
  const level = LEVELS[levelIndex] as Level;
  const boardLayout = boardLayoutForLevel(level.id);
  const copy = UI[language];
  const tutorial = level.tutorial ? TUTORIALS[language][level.tutorial - 1] : undefined;
  const nextColorBagRef = useRef<CreatureType[]>([]);
  const drawNextBubble = () => {
    if (!nextColorBagRef.current.length) {
      const refill = [...level.palette];
      for (let index = refill.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [refill[index], refill[swapIndex]] = [refill[swapIndex] as CreatureType, refill[index] as CreatureType];
      }
      nextColorBagRef.current = refill;
    }
    return makeNext(level, nextColorBagRef.current.shift() as CreatureType);
  };
  const [pieces, setPieces] = useState<Piece[]>(() => makeSeed(level));
  const [next, setNext] = useState<NextBubble>(drawNextBubble);
  const [previewNext, setPreviewNext] = useState<NextBubble>(drawNextBubble);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [rescueFlights, setRescueFlights] = useState<RescueFlightSpec[]>([]);
  const [state, setState] = useState<GameState>('playing');
  const [message, setMessage] = useState<string>(tutorial?.hint ?? copy.drop);
  const [tutorialVisible, setTutorialVisible] = useState(Boolean(tutorial));
  const [isAiming, setIsAiming] = useState(false);
  const [launcherVisible, setLauncherVisible] = useState(true);
  const aimX = useRef(new Animated.Value(BOARD_WIDTH / 2)).current;
  const aimXRef = useRef(BOARD_WIDTH / 2);
  const aimingRef = useRef(false);
  const dragGrabOffsetRef = useRef(0);
  const aimFrameRef = useRef<number | null>(null);
  const pendingAimLocationRef = useRef<number | null>(null);
  const heldCreatureMotion = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const heldCreatureRoll = useRef(new Animated.Value(0)).current;
  const launchArrival = useRef(new Animated.Value(1)).current;
  const heldSloshRef = useRef({ x: 0, y: 0, angle: 0 });
  const busy = useRef(false);
  const scoreRef = useRef(0);
  const piecesRef = useRef(pieces);
  const completingRef = useRef<Set<string>>(new Set());
  const mergeAuditNeededRef = useRef(true);
  const resolvingRef = useRef(false);
  const pendingDropIdRef = useRef<string | undefined>(undefined);
  const playerHasDroppedRef = useRef(false);
  const activeMergeIdsRef = useRef<Set<string>>(new Set());
  const forcedColorContactsRef = useRef<Set<string>>(new Set());
  const mergeAnimationRef = useRef(false);
  const resolveBoardRef = useRef<(board: Piece[], focusId?: string, chain?: number) => void>(() => undefined);
  const winScheduledRef = useRef(false);
  const winSettleAttemptsRef = useRef(0);
  const lossScheduledRef = useRef(false);
  const [failLineWarning, setFailLineWarning] = useState(false);
  const failLinePulse = useRef(new Animated.Value(0)).current;
  const goalCollectPulse = useRef(new Animated.Value(0)).current;
  const boardOriginRef = useRef({ x: BOARD_EDGE_GAP, y: 133 });
  const rescueTargetRef = useRef({ x: BOARD_EDGE_GAP + 32, y: 80 });
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const resultReveal = useRef(new Animated.Value(0)).current;
  const victoryFloat = useRef(new Animated.Value(0)).current;
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter(item => item !== timer);
      callback();
    }, delay);
    timersRef.current.push(timer);
  };
  const hasCrossedFailLine = (board: Piece[]) => board.some(piece =>
    !completingRef.current.has(piece.id)
    && Boolean(piece.sleeping)
    && piece.y + 1 < FAIL_LINE_Y,
  );
  const showBoundaryFailure = (delay = 0) => {
    if (lossScheduledRef.current || winScheduledRef.current) return;
    lossScheduledRef.current = true;
    busy.current = true;
    setFailLineWarning(true);
    schedule(() => {
      const activeBoard = piecesRef.current.filter(piece =>
        piece.contents.length > 0 && !completingRef.current.has(piece.id),
      );
      if (scoreRef.current < level.goal && hasCrossedFailLine(activeBoard)) {
        setState('lost');
        return;
      }
      lossScheduledRef.current = false;
      setFailLineWarning(false);
      busy.current = false;
    }, Math.max(FAIL_LINE_WARNING_MS, delay));
  };
  const scheduleResolvedWin = (board: Piece[], delay = 280) => {
    if (scoreRef.current < level.goal
      || completingRef.current.size > 0
      || mergeAnimationRef.current
      || resolvingRef.current) return false;
    const hasCompletedBubble = board.some(piece =>
      piece.contents.length >= level.merge
      && piece.contents.every(type => type === piece.contents[0]),
    );
    if (hasCompletedBubble || sortableContacts(board).length > 0) {
      mergeAuditNeededRef.current = true;
      return false;
    }
    if (winScheduledRef.current) return true;
    winScheduledRef.current = true;
    busy.current = true;
    schedule(() => {
      winScheduledRef.current = false;
      const activeBoard = piecesRef.current.filter(piece =>
        piece.contents.length > 0 && !completingRef.current.has(piece.id),
      );
      if (completingRef.current.size > 0 || mergeAnimationRef.current || resolvingRef.current) return;
      const completedStillWaiting = activeBoard.some(piece =>
        piece.contents.length >= level.merge
        && piece.contents.every(type => type === piece.contents[0]),
      );
      if (completedStillWaiting || sortableContacts(activeBoard).length > 0) {
        mergeAuditNeededRef.current = true;
        return;
      }
      const meaningfulMotion = activeBoard.some(piece =>
        Math.abs(piece.vx) > 0.62 || Math.abs(piece.vy) > 0.82,
      );
      if (meaningfulMotion && winSettleAttemptsRef.current < 6) {
        winSettleAttemptsRef.current += 1;
        scheduleResolvedWin(activeBoard, 260);
        return;
      }
      winSettleAttemptsRef.current = 0;
      winScheduledRef.current = true;
      setState('won');
      onComplete();
    }, delay);
    return true;
  };
  const awakenAfterTopologyChange = (remaining: Piece[]) => {
    if (!remaining.length) return remaining;
    mergeAuditNeededRef.current = true;
    // Re-evaluate support once whenever a merge or pop removes a bubble. Stable
    // bubbles stay asleep; only pieces above the new gap wake and continue falling.
    const result = stepPhysics(remaining, boardLayout);
    commitPhysicsFrame(result.pieces);
    return result.pieces;
  };

  useEffect(() => () => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
    if (aimFrameRef.current !== null) cancelAnimationFrame(aimFrameRef.current);
    aimFrameRef.current = null;
    pendingAimLocationRef.current = null;
    launchArrival.stopAnimation();
    goalCollectPulse.stopAnimation();
  }, []);

  useEffect(() => {
    failLinePulse.stopAnimation();
    if (!failLineWarning) {
      failLinePulse.setValue(0);
      return;
    }
    const warningLoop = Animated.loop(Animated.sequence([
      Animated.timing(failLinePulse, { toValue: 1, duration: 230, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(failLinePulse, { toValue: 0, duration: 230, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    warningLoop.start();
    return () => warningLoop.stop();
  }, [failLinePulse, failLineWarning]);

  useEffect(() => {
    resultReveal.stopAnimation();
    victoryFloat.stopAnimation();
    if (state === 'playing') {
      resultReveal.setValue(0);
      victoryFloat.setValue(0);
      return;
    }
    resultReveal.setValue(0);
    Animated.sequence([
      Animated.delay(120),
      Animated.timing(resultReveal, { toValue: 0.72, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(resultReveal, { toValue: 1, damping: 12, stiffness: 128, mass: 0.72, useNativeDriver: true }),
    ]).start();
    if (state !== 'won') return;
    const floatLoop = Animated.loop(Animated.sequence([
      Animated.timing(victoryFloat, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(victoryFloat, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    floatLoop.start();
    return () => floatLoop.stop();
  }, [resultReveal, state, victoryFloat]);

  const dismissResult = (action: () => void) => {
    Animated.timing(resultReveal, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(action);
  };

  useEffect(() => {
    let frame = 0;
    let previous = 0;
    let accumulator = 0;
    const fixedStep = 1000 / 60;
    const animate = (time: number) => {
      if (!previous) previous = time;
      accumulator += Math.min(34, time - previous);
      previous = time;
      if (state === 'playing' && !mergeAnimationRef.current) {
        let changed = false;
        let stepped = false;
        const impactColorContactKeys = new Set<string>();
        while (accumulator >= fixedStep) {
          const exitingPieces = piecesRef.current.filter(piece => completingRef.current.has(piece.id));
          const activePieces = piecesRef.current.filter(piece => !completingRef.current.has(piece.id));
          // A completely settled board needs no per-frame collision work. This
          // removes thousands of pair checks while the player is aiming and is
          // the main protection against visible hitches on older phones.
          if (!activePieces.some(piece => !piece.sleeping)) {
            accumulator = 0;
            const goalReached = scoreRef.current >= level.goal;
            if (!goalReached && hasCrossedFailLine(activePieces)) {
              showBoundaryFailure();
              break;
            }
            const goalReadyForFinalAudit = goalReached
              && completingRef.current.size === 0
              && !winScheduledRef.current;
            if (playerHasDroppedRef.current && !resolvingRef.current && (mergeAuditNeededRef.current || goalReadyForFinalAudit)) {
              mergeAuditNeededRef.current = false;
              const restingContacts = sortableContacts(activePieces);
              const hasCompletedBubble = activePieces.some(piece =>
                piece.contents.length >= level.merge
                && piece.contents.every(type => type === piece.contents[0]),
              );
              if (restingContacts.length || hasCompletedBubble) {
                resolvingRef.current = true;
                busy.current = true;
                activeMergeIdsRef.current = new Set(restingContacts.flatMap(({ a, b }) => [a.id, b.id]));
                resolveBoardRef.current(piecesRef.current);
              } else if (goalReached && completingRef.current.size === 0) {
                scheduleResolvedWin(activePieces);
              }
            }
            break;
          }
          const result = stepPhysics(activePieces, boardLayout);
          piecesRef.current = [...result.pieces, ...exitingPieces];
          changed = changed || result.structureChanged;
          result.colorContactKeys.forEach(key => impactColorContactKeys.add(key));
          stepped = true;
          accumulator -= fixedStep;
        }
        if (stepped) {
          const activePieces = piecesRef.current.filter(piece => !completingRef.current.has(piece.id));
          commitPhysicsFrame(activePieces);
          if (changed) setPieces([...piecesRef.current]);
          const contacts = sortableContacts(activePieces);
          const contactByKey = new Map(contacts.map(contact => [colorContactKey(contact.a, contact.b), contact]));
          const pieceById = new Map(activePieces.map(piece => [piece.id, piece]));
          impactColorContactKeys.forEach(key => {
            if (contactByKey.has(key)) return;
            const [aId, bId] = key.split('|');
            const a = pieceById.get(aId as string);
            const b = pieceById.get(bId as string);
            if (a && b) contactByKey.set(key, { a, b });
          });
          const turnContacts = [...contactByKey.values()];
          if (playerHasDroppedRef.current && !resolvingRef.current) {
            const pendingId = pendingDropIdRef.current;
            if (turnContacts.length) {
              resolvingRef.current = true;
              busy.current = true;
              mergeAuditNeededRef.current = false;
              // A new impact starts one board-resolution turn. Resolve every matching
              // contact already present in that turn so an older red/blue/etc. pair
              // cannot remain stuck merely because its contact key was seen earlier.
              activeMergeIdsRef.current = new Set(turnContacts.flatMap(({ a, b }) => [a.id, b.id]));
              impactColorContactKeys.forEach(key => forcedColorContactsRef.current.add(key));
              pendingDropIdRef.current = undefined;
              resolveBoardRef.current(piecesRef.current, pendingId);
            } else if (scoreRef.current >= level.goal && completingRef.current.size === 0) {
              scheduleResolvedWin(activePieces, 420);
            }
          }
        }
      } else {
        accumulator = 0;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const reset = () => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
    busy.current = false;
    scoreRef.current = 0;
    completingRef.current.clear();
    mergeAuditNeededRef.current = true;
    resolvingRef.current = false;
    pendingDropIdRef.current = undefined;
    playerHasDroppedRef.current = false;
    activeMergeIdsRef.current.clear();
    forcedColorContactsRef.current.clear();
    mergeAnimationRef.current = false;
    winScheduledRef.current = false;
    winSettleAttemptsRef.current = 0;
    lossScheduledRef.current = false;
    setFailLineWarning(false);
    failLinePulse.stopAnimation();
    failLinePulse.setValue(0);
    goalCollectPulse.stopAnimation();
    goalCollectPulse.setValue(0);
    const seed = makeSeed(level);
    piecesRef.current = seed;
    setPieces(seed);
    nextColorBagRef.current = [];
    setNext(drawNextBubble());
    setPreviewNext(drawNextBubble());
    launchArrival.stopAnimation();
    launchArrival.setValue(1);
    setScore(0);
    setCombo(0);
    setExiting(new Set());
    setRescueFlights([]);
    setMessage(tutorial?.hint ?? copy.drop);
    setTutorialVisible(Boolean(tutorial));
    setLauncherVisible(true);
    aimingRef.current = false;
    dragGrabOffsetRef.current = 0;
    if (aimFrameRef.current !== null) cancelAnimationFrame(aimFrameRef.current);
    aimFrameRef.current = null;
    pendingAimLocationRef.current = null;
    setIsAiming(false);
    aimXRef.current = BOARD_WIDTH / 2;
    aimX.setValue(BOARD_WIDTH / 2);
    heldCreatureMotion.stopAnimation();
    heldCreatureRoll.stopAnimation();
    heldCreatureMotion.setValue({ x: 0, y: 0 });
    heldCreatureRoll.setValue(0);
    heldSloshRef.current = { x: 0, y: 0, angle: 0 };
    setState('playing');
  };

  const finishTurn = (remaining: Piece[]) => {
    mergeAnimationRef.current = false;
    resolvingRef.current = false;
    if (scoreRef.current >= level.goal) {
      busy.current = true;
      mergeAuditNeededRef.current = true;
      scheduleResolvedWin(remaining);
      return;
    }
    if (hasCrossedFailLine(remaining)) {
      showBoundaryFailure(180);
      return;
    }
    setCombo(0);
    setMessage(copy.ready);
    busy.current = false;
  };

  const resolveBoard = (board: Piece[], focusId?: string, chain = 1) => {
    // Popping pieces remain rendered while their fish swim away, but they no
    // longer participate in physics, matching, scoring or later merge turns.
    const cleaned = board.filter(piece => piece.contents.length > 0 && !completingRef.current.has(piece.id));
    const completed = cleaned.filter(piece =>
      piece.contents.length >= level.merge && piece.contents.every(type => type === piece.contents[0]),
    );
    if (completed.length) {
      mergeAnimationRef.current = false;
      winSettleAttemptsRef.current = 0;
      onSound('pop');
      const ids = new Set(completed.map(piece => piece.id));
      completed.forEach(piece => completingRef.current.add(piece.id));
      const completingPieces = piecesRef.current.filter(piece => completingRef.current.has(piece.id));
      const awakenedPieces = awakenAfterTopologyChange(
        piecesRef.current.filter(piece => !completingRef.current.has(piece.id) && piece.contents.length > 0),
      );
      piecesRef.current = [...awakenedPieces, ...completingPieces];
      setExiting(current => new Set([...current, ...ids]));
      const boardOrigin = boardOriginRef.current;
      const rescueTarget = rescueTargetRef.current;
      const newFlights = completed.map(piece => ({
        id: piece.id,
        type: piece.type,
        count: piece.contents.length,
        startX: boardOrigin.x + piece.x + piece.size / 2,
        startY: boardOrigin.y + piece.y + piece.size / 2,
        targetX: rescueTarget.x,
        targetY: rescueTarget.y,
      }));
      setRescueFlights(current => [...current.filter(flight => !ids.has(flight.id)), ...newFlights]);
      setCombo(chain);
      setMessage(completed.length > 1
        ? language === 'tr' ? `Pof! ${completed.length} balon aynı anda özgür kaldı!` : `Pop! ${completed.length} bubbles were freed together!`
        : chain > 1 ? language === 'tr' ? `Muhteşem zincir x${chain}!` : `Amazing chain x${chain}!`
          : language === 'tr' ? 'Pof! Tam renk grubu özgür kaldı!' : 'Pop! A full color group is free!');
      scoreRef.current += completed.reduce((total, piece) => total + piece.contents.length, 0);
      const collectedScore = scoreRef.current;
      schedule(() => {
        setScore(current => Math.max(current, collectedScore));
        goalCollectPulse.stopAnimation();
        goalCollectPulse.setValue(0);
        Animated.sequence([
          Animated.timing(goalCollectPulse, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(goalCollectPulse, { toValue: 0, duration: 260, easing: Easing.out(Easing.back(1.7)), useNativeDriver: true }),
        ]).start();
      }, RESCUE_SCORE_COMMIT_MS);

      // Keep resolving the board after a pop. A disappearing bubble may open a
      // gap, create a new contact and start another merge/pop chain. The result
      // screen is allowed only after every escape animation and chain is over.
      const goalReached = scoreRef.current >= level.goal;
      resolvingRef.current = false;
      busy.current = goalReached;
      pendingDropIdRef.current = undefined;
      activeMergeIdsRef.current.clear();
      forcedColorContactsRef.current.clear();
      mergeAuditNeededRef.current = true;
      if (!goalReached && hasCrossedFailLine(awakenedPieces)) {
        showBoundaryFailure(180);
      } else if (!goalReached) {
        busy.current = false;
      }
      schedule(() => {
        const remaining = piecesRef.current.filter(piece => !ids.has(piece.id) && piece.contents.length > 0);
        setExiting(current => {
          const nextExiting = new Set(current);
          ids.forEach(id => nextExiting.delete(id));
          return nextExiting;
        });
        piecesRef.current = remaining;
        setPieces(remaining);
        mergeAuditNeededRef.current = true;
      }, POP_ANIMATION_MS + 90);
      schedule(() => {
        ids.forEach(id => completingRef.current.delete(id));
        setRescueFlights(current => current.filter(flight => !ids.has(flight.id)));
        if (scoreRef.current >= level.goal) scheduleResolvedWin(piecesRef.current, 320);
      }, RESCUE_FLIGHT_MS + 80);
      return;
    }

    if (chain > 18) {
      finishTurn(cleaned);
      return;
    }

    const currentContacts = sortableContacts(cleaned);
    // Never narrow a merge turn to the freshly dropped bubble. Every matching
    // pair already touching on the board joins the same immediate resolution.
    const activeContactIds = new Set(currentContacts.flatMap(({ a, b }) => [a.id, b.id]));
    activeMergeIdsRef.current.forEach(id => activeContactIds.add(id));
    if (focusId) activeContactIds.add(focusId);
    const activeIds = activeContactIds.size ? activeContactIds : undefined;
    activeMergeIdsRef.current.clear();
    if (!focusId && !activeIds) {
      finishTurn(cleaned);
      return;
    }
    const forcedContacts = new Set(forcedColorContactsRef.current);
    forcedColorContactsRef.current.clear();
    const plan = planColorMerges(cleaned, focusId, activeIds, forcedContacts);
    if (!plan.affectedIds.size) {
      mergeAnimationRef.current = false;
      const settled = cleaned.map(piece => piece.merging ? { ...piece, merging: false } : piece);
      const awakened = awakenAfterTopologyChange(settled);
      const exitingPieces = piecesRef.current.filter(piece => completingRef.current.has(piece.id));
      piecesRef.current = [...awakened, ...exitingPieces];
      setPieces([...piecesRef.current]);
      finishTurn(awakened);
      return;
    }

    mergeAnimationRef.current = true;
    onSound('merge');
    const sorted = cleaned.map(piece => {
      if (!plan.affectedIds.has(piece.id)) return piece.merging ? { ...piece, merging: false } : piece;
      const contents = plan.allocations.get(piece.id) ?? [...piece.contents];
      const receiver = plan.receivers.get(piece.id);
      const motion = plan.motions.get(piece.id);
      const nextSize = contents.length ? bubbleSizeForCount(contents.length) : piece.size;
      const centeredX = piece.x + (piece.size - nextSize) / 2;
      const centeredY = piece.y + (piece.size - nextSize) / 2;
      piece.position.setValue({ x: centeredX, y: centeredY });
      piece.elastic.setValue({ x: 1, y: 1 });
      const fullyAbsorbed = contents.length === 0;
      return {
        ...piece,
        x: centeredX,
        y: centeredY,
        renderedX: centeredX,
        renderedY: centeredY,
        vx: piece.vx * 0.34,
        vy: Math.min(piece.vy * 0.25, 0.6),
        size: nextSize,
        contents,
        count: contents.length,
        type: dominantType(contents, piece.type),
        displayContents: [...piece.contents],
        merging: true,
        mergeReceiver: Boolean(receiver),
        mergeStartScale: receiver ? Math.max(0.76, Math.min(1, piece.size / nextSize)) : 1,
        mergeDx: motion ? (motion.targetX - centeredX) * (fullyAbsorbed ? 0.9 : 0.08) : 0,
        mergeDy: motion ? (motion.targetY - centeredY) * (fullyAbsorbed ? 0.9 : 0.08) : 0,
        transferType: motion?.color ?? receiver?.color,
        transferDx: receiver ? receiver.sourceX - piece.x : 0,
        transferDy: receiver ? receiver.sourceY - piece.y : 0,
        transferAmount: receiver?.added,
        transferSources: receiver?.sourcePoints.map(source => ({
          id: source.id,
          x: source.x,
          y: source.y,
          size: source.size,
          count: source.count,
          totalCount: source.totalCount,
          indices: [...source.indices],
        })),
        sleeping: false,
        settleFrames: 0,
        contactFrames: 0,
      };
    });
    const exitingPieces = piecesRef.current.filter(piece => completingRef.current.has(piece.id));
    piecesRef.current = [...sorted, ...exitingPieces];
    setPieces([...piecesRef.current]);
    setMessage(plan.groupCount > 1
      ? language === 'tr' ? `${plan.groupCount} renk grubu aynı anda birleşiyor!` : `${plan.groupCount} color groups are merging together!`
      : language === 'tr' ? 'Yalnızca aynı renkteki balon balıkları birleşiyor!' : 'Only matching pufferfish merge!');
    schedule(() => {
      mergeAnimationRef.current = false;
      const settled = piecesRef.current
        .filter(piece => piece.contents.length > 0 && !completingRef.current.has(piece.id))
        .map(piece => {
          if (!piece.merging && !piece.mergeReceiver && !piece.displayContents && !piece.transferType) return piece;
          return {
            ...piece,
            merging: false,
            settleCreaturesInstantly: Boolean(piece.mergeReceiver),
            mergeReceiver: undefined,
            mergeStartScale: undefined,
            mergeDx: undefined,
            mergeDy: undefined,
            displayContents: undefined,
            transferType: undefined,
            transferDx: undefined,
            transferDy: undefined,
            transferAmount: undefined,
            transferSources: undefined,
          };
        });
      const awakened = awakenAfterTopologyChange(settled);
      const remainingExitingPieces = piecesRef.current.filter(piece => completingRef.current.has(piece.id));
      piecesRef.current = [...awakened, ...remainingExitingPieces];
      setPieces([...piecesRef.current]);
      schedule(() => resolveBoardRef.current(piecesRef.current, undefined, chain + 1), MERGE_SETTLE_HOLD_MS);
    }, MERGE_ANIMATION_MS);
  };
  resolveBoardRef.current = resolveBoard;

  const alignAimX = (locationX: number) => {
    const diameter = bubbleSizeForCount(next.count);
    return Math.max(diameter / 2 + BOARD_WALL_INSET, Math.min(BOARD_WIDTH - diameter / 2 - BOARD_WALL_INSET, locationX));
  };

  const animateHeldFish = (deltaX: number) => {
    if (Math.abs(deltaX) < 0.12) return;
    const diameter = bubbleSizeForCount(next.count);
    const maxSlosh = Math.min(10, diameter * 0.17);
    const targetX = Math.max(-maxSlosh, Math.min(maxSlosh, -deltaX * 0.82));
    const targetY = Math.min(maxSlosh * 0.34, Math.abs(deltaX) * 0.12);
    const targetAngle = Math.max(-24, Math.min(24, deltaX * 1.55));
    heldSloshRef.current = { x: targetX, y: targetY, angle: targetAngle };
    // Gesture events can arrive faster than the display refresh rate. Starting
    // and cancelling spring sequences for every event overloaded the native
    // animation queue and made the dragged bubble lag behind the finger.
    heldCreatureMotion.stopAnimation();
    heldCreatureRoll.stopAnimation();
    heldCreatureMotion.setValue({ x: targetX, y: targetY });
    heldCreatureRoll.setValue(targetAngle);
  };

  const applyAim = (locationX: number, moveFish = true) => {
    if (!Number.isFinite(locationX)) return;
    const alignedX = alignAimX(locationX - dragGrabOffsetRef.current);
    const deltaX = alignedX - aimXRef.current;
    aimXRef.current = alignedX;
    aimX.setValue(alignedX);
    if (moveFish && aimingRef.current) animateHeldFish(deltaX);
  };

  const moveAim = (locationX: number, moveFish = true) => {
    if (!Number.isFinite(locationX)) return;
    pendingAimLocationRef.current = locationX;
    if (aimFrameRef.current !== null) return;
    aimFrameRef.current = requestAnimationFrame(() => {
      aimFrameRef.current = null;
      const pendingLocation = pendingAimLocationRef.current;
      pendingAimLocationRef.current = null;
      if (pendingLocation !== null) applyAim(pendingLocation, moveFish);
    });
  };

  const flushAim = (locationX: number) => {
    if (aimFrameRef.current !== null) cancelAnimationFrame(aimFrameRef.current);
    aimFrameRef.current = null;
    pendingAimLocationRef.current = null;
    applyAim(locationX);
  };

  const beginAim = (locationX: number) => {
    if (busy.current || state !== 'playing') return;
    // If the slow decorative roll-in is still running, touching the launcher
    // hands control to the player immediately instead of waiting for it.
    launchArrival.stopAnimation();
    launchArrival.setValue(1);
    setLauncherVisible(true);
    heldCreatureMotion.stopAnimation();
    heldCreatureRoll.stopAnimation();
    heldCreatureMotion.setValue({ x: 0, y: 0 });
    heldCreatureRoll.setValue(0);
    heldSloshRef.current = { x: 0, y: 0, angle: 0 };
    aimingRef.current = true;
    dragGrabOffsetRef.current = locationX - aimXRef.current;
    setIsAiming(true);
    setMessage(copy.aiming);
  };

  const cancelAim = () => {
    if (!aimingRef.current) return;
    if (aimFrameRef.current !== null) cancelAnimationFrame(aimFrameRef.current);
    aimFrameRef.current = null;
    pendingAimLocationRef.current = null;
    aimingRef.current = false;
    dragGrabOffsetRef.current = 0;
    setIsAiming(false);
    heldCreatureMotion.stopAnimation();
    heldCreatureRoll.stopAnimation();
    heldCreatureMotion.setValue({ x: 0, y: 0 });
    heldCreatureRoll.setValue(0);
    heldSloshRef.current = { x: 0, y: 0, angle: 0 };
    if (!busy.current) setMessage(copy.drop);
  };

  const dropAt = (locationX: number) => {
    if (busy.current || state !== 'playing') return;
    busy.current = true;
    playerHasDroppedRef.current = true;
    mergeAuditNeededRef.current = true;
    const diameter = bubbleSizeForCount(next.count);
    const alignedX = Math.max(
      diameter / 2 + BOARD_WALL_INSET,
      Math.min(BOARD_WIDTH - diameter / 2 - BOARD_WALL_INSET, locationX),
    );
    aimXRef.current = alignedX;
    aimX.setValue(alignedX);
    const carriedSlosh = heldSloshRef.current;
    const creatureMotion = makeCreatureMotion();
    creatureMotion.creatureOffsetX = carriedSlosh.x;
    creatureMotion.creatureOffsetY = carriedSlosh.y;
    creatureMotion.creatureAngle = carriedSlosh.angle;
    creatureMotion.creatureMotion.setValue({ x: carriedSlosh.x, y: carriedSlosh.y });
    creatureMotion.creatureRoll.setValue(carriedSlosh.angle);
    const newPiece: Piece = {
      id: next.id,
      x: alignedX - diameter / 2,
      y: HELD_BUBBLE_TOP,
      vx: 0,
      vy: 7.4,
      phase: Math.random() * Math.PI * 2,
      driftStrength: 0.0015,
      entryDrift: Math.sin(Math.random() * Math.PI * 2) >= 0 ? 0.14 : -0.14,
      ...creatureMotion,
      position: new Animated.ValueXY({
        x: alignedX - diameter / 2,
        y: HELD_BUBBLE_TOP,
      }),
      elastic: new Animated.ValueXY({ x: 1, y: 1 }),
      squashX: 1,
      squashY: 1,
      dents: makeDents(),
      dentLevels: makeDentLevels(),
      renderedDentLevels: makeDentLevels(),
      size: diameter,
      type: next.type,
      count: next.count,
      contents: [...next.contents],
      fresh: true,
      settleCreaturesInstantly: true,
      sleeping: false,
      settleFrames: 0,
      contactFrames: 0,
    };
    // Preserve the identity of every resting piece. Cloning the whole board here
    // forced React to rebuild every fish layer exactly when the drop began.
    const board = [...piecesRef.current, newPiece];
    pendingDropIdRef.current = newPiece.id;
    piecesRef.current = board;
    setLauncherVisible(false);
    setPieces(board);
    const promotedBubble = previewNext;
    const queuedBubble = drawNextBubble();
    schedule(() => onSound('drop'), 18);
    schedule(() => {
      setNext(promotedBubble);
      setPreviewNext(queuedBubble);
      launchArrival.stopAnimation();
      launchArrival.setValue(0);
      setLauncherVisible(true);
      Animated.timing(launchArrival, {
        toValue: 1,
        duration: 1350,
        easing: Easing.bezier(0.16, 0.78, 0.22, 1),
        useNativeDriver: true,
        isInteraction: false,
      }).start();
    }, 90);
    setMessage(copy.rolling);
    heldCreatureMotion.stopAnimation();
    heldCreatureRoll.stopAnimation();
    heldCreatureMotion.setValue({ x: 0, y: 0 });
    heldCreatureRoll.setValue(0);
    heldSloshRef.current = { x: 0, y: 0, angle: 0 };
    const resolveWhenLanded = (attempt = 0) => {
      schedule(() => {
        if (resolvingRef.current) {
          if (attempt < 120) resolveWhenLanded(attempt + 1);
          return;
        }
        const dropped = piecesRef.current.find(piece => piece.id === newPiece.id);
        const floor = dropped ? floorTopForPiece(dropped, boardLayout) : 0;
        const landed = !dropped
          || dropped.sleeping
          || (dropped.contactFrames ?? 0) >= 2
          || floor - dropped.y <= 1.5;
        if (!landed && attempt < 42) {
          resolveWhenLanded(attempt + 1);
          return;
        }
        if (!landed) {
          // The falling bubble remains fully simulated and its first matching
          // contact is still detected by the physics loop. Do not hold the next
          // launcher hostage while it traverses a tall empty board.
          pendingDropIdRef.current = undefined;
          busy.current = false;
          setMessage(copy.ready);
          return;
        }
        resolvingRef.current = true;
        const focusId = pendingDropIdRef.current ?? newPiece.id;
        const restingContacts = sortableContacts(piecesRef.current);
        activeMergeIdsRef.current = new Set(restingContacts.flatMap(({ a, b }) => [a.id, b.id]));
        pendingDropIdRef.current = undefined;
        resolveBoardRef.current(piecesRef.current, focusId);
      }, attempt === 0 ? 90 : 16);
    };
    resolveWhenLanded();
  };

  const releaseAim = (locationX: number) => {
    if (!aimingRef.current) return;
    flushAim(locationX);
    aimingRef.current = false;
    dragGrabOffsetRef.current = 0;
    setIsAiming(false);
    dropAt(aimXRef.current);
  };

  const heldDiameter = bubbleSizeForCount(next.count);
  const previewDiameter = Math.round(bubbleSizeForCount(previewNext.count) * 0.8);
  const previewCenterX = BOARD_WIDTH - 7 - (previewDiameter + 10) / 2;
  const arrivalOffsetX = previewCenterX - aimXRef.current;
  const remainingRescueCount = Math.max(0, level.goal - score);
  const floorAngle = Math.atan2(boardLayout.floorSlope, BOARD_WIDTH) * 180 / Math.PI;

  return (
    <View style={styles.gamePage}>
      <View style={styles.gameTop}>
        <View style={styles.gameNavPair}>
          <AssetNavButton source={NAV_HOME_ASSET} label={copy.home} onPress={onHome} compact />
          <AssetNavButton source={NAV_LEVELS_ASSET} label={copy.levels} onPress={onExit} compact />
        </View>
        <View style={styles.levelBadge}><Text style={styles.levelBadgeTop}>{copy.level.toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')}</Text><Text style={styles.levelBadgeNumber}>{level.id}</Text></View>
        <View style={styles.gameRightActions}>
          <AssetNavButton source={NAV_SETTINGS_ASSET} label={copy.settings} onPress={onSettings} compact />
        </View>
      </View>

      <View
        style={styles.goalRow}
        onLayout={event => {
          const layout = event.nativeEvent.layout;
          rescueTargetRef.current = { x: layout.x + 32, y: layout.y + layout.height / 2 };
        }}
      >
        <Animated.View
          style={[
            styles.goalRemainingPill,
            {
              transform: [{ scale: goalCollectPulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.13, 1.04] }) }],
            },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.goalCollectRing,
              {
                opacity: goalCollectPulse.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.72, 0] }),
                transform: [{ scale: goalCollectPulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.48] }) }],
              },
            ]}
          />
          <Image source={PUFFERFISH_ASSETS.aqua} resizeMode="contain" style={styles.goalFishIcon} />
          <Text style={styles.goalRemainingCount}>{remainingRescueCount}</Text>
        </Animated.View>
      </View>

      <View style={styles.launchArea}>
        <Text style={styles.gameMessage}>{message}</Text>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.nextPreviewDock,
            {
              width: previewDiameter + 10,
              height: previewDiameter + 10,
              borderRadius: (previewDiameter + 10) / 2,
              borderColor: CREATURES[previewNext.type].body,
              opacity: launcherVisible
                ? launchArrival.interpolate({ inputRange: [0, 0.42, 1], outputRange: [0, 0, 1] })
                : 0,
              transform: [{ scale: launchArrival.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.72, 0.88, 1] }) }],
            },
          ]}
        >
          <Bubble
            type={previewNext.type}
            count={previewNext.count}
            contents={previewNext.contents}
            size={previewDiameter}
            layoutSeed={previewNext.id}
            settleInstantly
          />
        </Animated.View>
      </View>

      <View
        style={[styles.boardShell, { backgroundColor: boardLayout.water }]}
        onLayout={event => {
          const layout = event.nativeEvent.layout;
          boardOriginRef.current = { x: layout.x, y: layout.y };
        }}
      > 
        <Image source={CORAL_WRECK_BOARD_ASSET} resizeMode="cover" style={styles.boardWaterBase} />
        <View style={styles.boardDepthBandOne} pointerEvents="none" />
        <View style={[styles.boardDepthBandTwo, { backgroundColor: boardLayout.depth }]} pointerEvents="none" />
        <View style={styles.boardGlow} />
        <View style={[styles.boardLightRay, styles.boardLightRayOne]} pointerEvents="none" />
        <View style={[styles.boardLightRay, styles.boardLightRayTwo]} pointerEvents="none" />
        <View style={[styles.boardLightRay, styles.boardLightRayThree]} pointerEvents="none" />
        <View style={styles.boardInnerRim} pointerEvents="none" />
        <View style={[styles.boardAmbientBubble, styles.boardAmbientBubbleOne]} pointerEvents="none" />
        <View style={[styles.boardAmbientBubble, styles.boardAmbientBubbleTwo]} pointerEvents="none" />
        <View style={[styles.boardAmbientBubble, styles.boardAmbientBubbleThree]} pointerEvents="none" />
        <View style={[styles.boardAmbientBubble, styles.boardAmbientBubbleFour]} pointerEvents="none" />
        <View style={styles.reefLeft} pointerEvents="none">
          <View style={[styles.reefLeaf, styles.reefLeafLeft]} />
          <View style={[styles.reefLeaf, styles.reefLeafCenter]} />
          <View style={[styles.reefLeaf, styles.reefLeafRight]} />
        </View>
        <View style={styles.reefRight} pointerEvents="none">
          <View style={[styles.coralBranch, styles.coralBranchLeft]} />
          <View style={[styles.coralBranch, styles.coralBranchCenter]} />
          <View style={[styles.coralBranch, styles.coralBranchRight]} />
        </View>
        {boardLayout.obstacles.map(obstacle => {
          const isRoundBumper = Math.abs(obstacle.length - obstacle.thickness) < 0.5;
          return (
            <View
              key={obstacle.id}
              pointerEvents="none"
              style={[
                styles.boardObstacle,
                {
                  left: obstacle.cx - obstacle.length / 2,
                  top: obstacle.cy - obstacle.thickness / 2,
                  width: obstacle.length,
                  height: obstacle.thickness,
                  borderRadius: obstacle.thickness / 2,
                  backgroundColor: '#9a5a27',
                  borderColor: '#5d341d',
                  transform: [{ rotate: `${obstacle.angle}deg` }],
                },
              ]}
            >
              <Image source={SHIPWRECK_WOOD_ASSET} resizeMode="cover" style={styles.boardObstacleTexture} />
              <View style={styles.boardObstacleVarnish} />
              <View style={styles.boardObstacleShine} />
              {!isRoundBumper && <View style={[styles.boardObstaclePearl, styles.boardObstaclePearlLeft]} />}
              {!isRoundBumper && <View style={[styles.boardObstaclePearl, styles.boardObstaclePearlRight]} />}
              {isRoundBumper && <View style={styles.boardObstacleBumperRing} />}
            </View>
          );
        })}
        <View style={styles.leftRail} pointerEvents="none"><Image source={CORAL_WRECK_SIDE_ASSET} resizeMode="stretch" style={styles.sideFrameTexture} /></View>
        <View style={styles.rightRail} pointerEvents="none"><Image source={CORAL_WRECK_SIDE_ASSET} resizeMode="stretch" style={styles.sideFrameTexture} /></View>
        <Animated.View
          style={[
            styles.failLineGlow,
            failLineWarning && styles.failLineGlowWarning,
            failLineWarning && {
              opacity: failLinePulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
              transform: [{ scaleX: failLinePulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.03] }) }],
            },
          ]}
          pointerEvents="none"
        />
        <View style={styles.dropLimit} pointerEvents="none">
          {Array.from({ length: 8 }, (_, index) => (
            <View key={index} style={[styles.dropLimitDash, failLineWarning && styles.dropLimitDashWarning]} />
          ))}
        </View>
        <View
          testID="drop-area"
          accessibilityRole="button"
          accessibilityLabel="Balona veya altındaki hizaya dokun, sürükle ve bırak"
          onStartShouldSetResponder={event => {
            if (busy.current || state !== 'playing') return false;
            const { locationX, locationY } = event.nativeEvent;
            return Math.abs(locationX - aimXRef.current) <= heldDiameter / 2 + 12
              && locationY >= HELD_BUBBLE_TOP - 12
              && locationY <= BOARD_HEIGHT + 12;
          }}
          onMoveShouldSetResponder={() => false}
          onResponderGrant={event => beginAim(event.nativeEvent.locationX)}
          onResponderMove={event => moveAim(event.nativeEvent.locationX)}
          onResponderRelease={event => releaseAim(event.nativeEvent.locationX)}
          onResponderTerminate={cancelAim}
          onResponderTerminationRequest={() => false}
          style={styles.freeDropArea}
        />
        {state === 'playing' && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.heldBubble,
              {
                top: HELD_BUBBLE_TOP - 4,
                width: heldDiameter + 8,
                height: heldDiameter + 8,
                borderRadius: (heldDiameter + 8) / 2,
                borderColor: CREATURES[next.type].body,
                opacity: launcherVisible ? (busy.current ? 0.82 : 1) : 0,
                transform: [
                  {
                    translateX: Animated.add(
                      Animated.subtract(aimX, (heldDiameter + 8) / 2),
                      launchArrival.interpolate({ inputRange: [0, 1], outputRange: [arrivalOffsetX, 0] }),
                    ),
                  },
                  { translateY: launchArrival.interpolate({ inputRange: [0, 0.76, 1], outputRange: [-90, 5, 0] }) },
                  { rotate: launchArrival.interpolate({ inputRange: [0, 1], outputRange: ['420deg', '0deg'] }) },
                  { scale: Animated.multiply(launchArrival.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.62, 1.04, 1] }), isAiming ? 1.045 : 1) },
                ],
              },
            ]}
          >
            <Bubble
              type={next.type}
              count={next.count}
              contents={next.contents}
              size={heldDiameter}
              layoutSeed={next.id}
              creatureMotion={heldCreatureMotion}
              creatureRoll={heldCreatureRoll}
              settleInstantly
            />
          </Animated.View>
        )}
        {pieces.map(piece => <GamePiece key={piece.id} piece={piece} exiting={exiting.has(piece.id)} />)}
        <View style={[styles.floor, { transform: [{ rotate: `${floorAngle}deg` }] }]} pointerEvents="none">
          <Image source={CORAL_WRECK_SAND_ASSET} resizeMode="cover" style={styles.floorTexture} />
          <View style={styles.floorGlow} />
          <View style={[styles.floorPebble, styles.floorPebbleOne]} />
          <View style={[styles.floorPebble, styles.floorPebbleTwo]} />
          <View style={[styles.floorPebble, styles.floorPebbleThree]} />
          <View style={[styles.floorPebble, styles.floorPebbleFour]} />
        </View>
      </View>

      {rescueFlights.map(flight => <RescueFlight key={flight.id} flight={flight} />)}

      {tutorialVisible && tutorial && (
        <View style={styles.tutorialShade}>
          <View style={styles.tutorialCard}>
            <View style={styles.tutorialStepPill}><Text style={styles.tutorialStepText}>{tutorial.eyebrow}</Text></View>
            <View style={styles.tutorialFishRow}>
              {level.palette.map(type => (
                <View key={type} style={[styles.tutorialFishBubble, { borderColor: CREATURES[type].body }]}>
                  <Image source={PUFFERFISH_ASSETS[type]} resizeMode="contain" style={styles.tutorialFishImage} />
                </View>
              ))}
            </View>
            <Text style={styles.tutorialTitle}>{tutorial.title}</Text>
            <Text style={styles.tutorialBody}>{tutorial.body}</Text>
            <View style={styles.tutorialFlowPill}>
              <Text style={styles.tutorialFlowText}>
                {level.tutorial === 1
                  ? language === 'tr' ? 'BASILI TUT  →  HİZALA  →  BIRAK' : 'HOLD  →  AIM  →  RELEASE'
                  : level.tutorial === 2
                    ? language === 'tr' ? 'AYNI RENK  +  AYNI RENK  =  BİRLEŞME' : 'SAME COLOR  +  SAME COLOR  =  MERGE'
                    : language === 'tr' ? 'BİRLEŞTİR  →  DOLDUR  →  PATLAT' : 'MERGE  →  FILL  →  POP'}
              </Text>
            </View>
            {level.tutorial === 3 && (
              <View style={styles.tutorialWarning}><Text style={styles.tutorialWarningText}>— — —  {language === 'tr' ? 'PEMBE ÇİZGİNİN ALTINDA KAL' : 'STAY BELOW THE PINK LINE'}  — — —</Text></View>
            )}
            <Pressable onPress={() => setTutorialVisible(false)} style={({ pressed }) => [styles.tutorialButton, pressed && styles.buttonPressed]}>
              <View style={styles.tutorialButtonShine} />
              <Text style={styles.tutorialButtonText}>{tutorial.action}</Text>
              <Text style={styles.tutorialButtonArrow}>›</Text>
            </Pressable>
          </View>
        </View>
      )}

      {state !== 'playing' && (
        <Animated.View style={[styles.modalShade, { opacity: resultReveal }]}>
          <View style={styles.resultAmbientBubbleOne} />
          <View style={styles.resultAmbientBubbleTwo} />
          <View style={styles.resultAmbientBubbleThree} />
          <Animated.View style={[styles.resultCard, state === 'won' ? styles.resultCardWon : styles.resultCardLost, { opacity: resultReveal, transform: [{ translateY: resultReveal.interpolate({ inputRange: [0, 0.72, 1], outputRange: [54, 10, 0] }) }, { scale: resultReveal.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.78, 0.96, 1] }) }] }]}>
            <View style={styles.resultCardSheen} pointerEvents="none" />
            <View style={[styles.resultLevelPill, state === 'lost' && styles.resultLevelPillLost]}>
              <Text style={styles.resultLevelPillText}>{copy.level.toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')} {level.id}</Text>
            </View>
            {state === 'won' ? (
              <View style={styles.resultVictoryStage}>
                <Animated.View style={[styles.resultVictoryGlow, { opacity: resultReveal, transform: [{ scale: resultReveal.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }] }]} />
                <Animated.Image
                  source={LEVEL_VICTORY_ASSET}
                  resizeMode="contain"
                  style={[styles.resultVictoryImage, {
                    transform: [
                      { translateY: victoryFloat.interpolate({ inputRange: [0, 1], outputRange: [3, -6] }) },
                      { rotate: victoryFloat.interpolate({ inputRange: [0, 1], outputRange: ['-0.8deg', '0.8deg'] }) },
                    ],
                  }]}
                />
                <Animated.Text style={[styles.resultSparkle, styles.resultSparkleLeft, { opacity: resultReveal }]}>✦</Animated.Text>
                <Animated.Text style={[styles.resultSparkle, styles.resultSparkleRight, { opacity: resultReveal }]}>✦</Animated.Text>
              </View>
            ) : (
              <View style={styles.resultFailureStage}>
                <View style={styles.resultFailureGlow} />
                <View style={styles.resultFailureBubble}>
                  <View style={styles.resultFailureWater} />
                  <Image source={PUFFERFISH_ASSETS.navy} resizeMode="contain" style={styles.resultFailureFish} />
                  <View style={styles.resultFailureHighlight} />
                </View>
                <View style={styles.resultAlertBadge}><Text style={styles.resultAlertText}>!</Text></View>
                <View style={styles.resultFailureBubbleSmall} />
              </View>
            )}
            <View style={[styles.resultStatusPill, state === 'won' ? styles.resultStatusWon : styles.resultStatusLost]}>
              <Text style={[styles.resultEyebrow, state === 'lost' && styles.resultEyebrowLost]}>{state === 'won' ? copy.targetComplete : copy.outOfMoves}</Text>
            </View>
            <Text style={styles.resultTitle}>{state === 'won' ? copy.congratulations : copy.tryAgain}</Text>
            <Text style={styles.resultCopy}>{state === 'won' ? copy.congratulationsCopy : copy.boundaryFailedCopy}</Text>
            <View style={[styles.resultScorePill, state === 'lost' && styles.resultScorePillLost]}>
              <Image source={PUFFERFISH_ASSETS[state === 'won' ? 'aqua' : 'coral']} resizeMode="contain" style={styles.resultScoreFish} />
              <View><Text style={styles.resultScoreValue}>{score} / {level.goal}</Text><Text style={styles.resultScoreLabel}>{copy.rescued}</Text></View>
            </View>
            {state === 'won' && hasNext ? (
              <Pressable onPress={() => dismissResult(onNext)} style={({ pressed }) => [styles.primaryButton, styles.resultPrimaryButton, styles.resultPrimaryWon, pressed && styles.buttonPressed]}>
                <View style={styles.resultButtonShine} /><Text style={styles.primaryButtonText}>{copy.nextLevel}</Text><Image source={NAV_PLAY_ASSET} resizeMode="contain" style={styles.resultButtonAsset} />
              </Pressable>
            ) : (
              <Pressable onPress={() => dismissResult(reset)} style={({ pressed }) => [styles.primaryButton, styles.resultPrimaryButton, state === 'won' ? styles.resultPrimaryWon : styles.resultPrimaryLost, pressed && styles.buttonPressed]}>
                <View style={styles.resultButtonShine} /><Text style={styles.primaryButtonText}>{state === 'won' ? copy.replay : copy.retry}</Text><View style={styles.resultRetryIcon}><Text style={styles.resultRetryText}>↻</Text></View>
              </Pressable>
            )}
            <Pressable onPress={() => dismissResult(onExit)} style={({ pressed }) => [styles.textButton, styles.resultLevelsButton, pressed && styles.textButtonPressed]}><Image source={NAV_LEVELS_ASSET} resizeMode="contain" style={styles.resultLevelsAsset} /><Text style={styles.textButtonLabel}>{copy.returnLevels}</Text></Pressable>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [levelIndex, setLevelIndex] = useState(0);
  const [unlocked, setUnlocked] = useState(1);
  const [language, setLanguage] = useState<Language>('tr');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loadedAssetCount, setLoadedAssetCount] = useState(0);
  const [decodedImageCount, setDecodedImageCount] = useState(0);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [introMinimumDone, setIntroMinimumDone] = useState(false);
  const [introProgress, setIntroProgress] = useState(0);
  const [bootVisible, setBootVisible] = useState(true);
  const musicPlayer = useAudioPlayer(MUSIC_ASSET, { updateInterval: 1000, downloadFirst: true });
  const dropSfxPlayer = useAudioPlayer(DROP_SFX_ASSET, { updateInterval: 250, downloadFirst: true });
  const mergeSfxPlayer = useAudioPlayer(MERGE_SFX_ASSET, { updateInterval: 250, downloadFirst: true });
  const popSfxPlayer = useAudioPlayer(POP_SFX_ASSET, { updateInterval: 250, downloadFirst: true });
  const scene = useRef(new Animated.Value(0)).current;
  const transitioning = useRef(false);
  const bootTransitionStarted = useRef(false);
  const transitionFrames = useRef<number[]>([]);
  const progressLoaded = useRef(false);
  const preferencesLoaded = useRef(false);
  const decodedImagesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let mounted = true;
    PRELOAD_ASSETS.forEach(source => {
      void Asset.fromModule(source).downloadAsync()
        .catch(() => undefined)
        .finally(() => {
          if (mounted) setLoadedAssetCount(count => Math.min(PRELOAD_ASSETS.length, count + 1));
        });
    });
    const introStartedAt = Date.now();
    const progressTimer = setInterval(() => {
      if (!mounted) return;
      const progress = Math.min(1, (Date.now() - introStartedAt) / 1850);
      setIntroProgress(progress);
      if (progress >= 1) {
        setIntroMinimumDone(true);
        clearInterval(progressTimer);
      }
    }, 60);
    return () => {
      mounted = false;
      clearInterval(progressTimer);
    };
  }, []);

  useEffect(() => () => {
    transitionFrames.current.forEach(frame => cancelAnimationFrame(frame));
    transitionFrames.current = [];
    scene.stopAnimation();
  }, [scene]);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(PROGRESS_KEY), AsyncStorage.getItem(LANGUAGE_KEY), AsyncStorage.getItem(MUSIC_KEY), AsyncStorage.getItem(SFX_KEY)])
      .then(([progressValue, languageValue, musicValue, soundValue]) => {
        const saved = Number(progressValue);
        if (Number.isFinite(saved)) setUnlocked(Math.max(1, Math.min(LEVELS.length + 1, saved)));
        if (languageValue === 'tr' || languageValue === 'en') setLanguage(languageValue);
        if (musicValue === 'true' || musicValue === 'false') setMusicEnabled(musicValue === 'true');
        if (soundValue === 'true' || soundValue === 'false') setSoundEnabled(soundValue === 'true');
        else if (musicValue === 'true' || musicValue === 'false') setSoundEnabled(musicValue === 'true');
      })
      .catch(() => undefined)
      .finally(() => {
        progressLoaded.current = true;
        preferencesLoaded.current = true;
        setPreferencesReady(true);
      });
  }, []);

  useEffect(() => {
    if (progressLoaded.current) void AsyncStorage.setItem(PROGRESS_KEY, String(unlocked)).catch(() => undefined);
  }, [unlocked]);

  useEffect(() => {
    if (preferencesLoaded.current) void AsyncStorage.setItem(LANGUAGE_KEY, language).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    musicPlayer.loop = true;
    musicPlayer.volume = 0.24;
    dropSfxPlayer.loop = false;
    dropSfxPlayer.volume = 0.54;
    mergeSfxPlayer.loop = false;
    mergeSfxPlayer.volume = 0.48;
    popSfxPlayer.loop = false;
    popSfxPlayer.volume = 0.6;
    void setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, [dropSfxPlayer, mergeSfxPlayer, musicPlayer, popSfxPlayer]);

  useEffect(() => {
    if (!musicEnabled) {
      musicPlayer.pause();
    }
    if (preferencesLoaded.current) void AsyncStorage.setItem(MUSIC_KEY, String(musicEnabled)).catch(() => undefined);
  }, [musicEnabled, musicPlayer]);

  useEffect(() => {
    if (!soundEnabled) {
      dropSfxPlayer.pause();
      mergeSfxPlayer.pause();
      popSfxPlayer.pause();
    }
    if (preferencesLoaded.current) void AsyncStorage.setItem(SFX_KEY, String(soundEnabled)).catch(() => undefined);
  }, [dropSfxPlayer, mergeSfxPlayer, popSfxPlayer, soundEnabled]);

  const playGameSound = (cue: AudioCue) => {
    if (!soundEnabled) return;
    const player = cue === 'drop' ? dropSfxPlayer : cue === 'merge' ? mergeSfxPlayer : popSfxPlayer;
    player.pause();
    void player.seekTo(0)
      .then(() => player.play())
      .catch(() => player.play());
  };

  const withTransition = (change: () => void) => {
    if (transitioning.current) return;
    transitioning.current = true;
    scene.stopAnimation();
    Animated.timing(scene, {
      toValue: 0,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      isInteraction: false,
    }).start(({ finished }) => {
      if (!finished) {
        transitioning.current = false;
        return;
      }
      change();
      scene.setValue(0);
      // Give React a full committed frame to mount the destination screen while
      // it is invisible. Starting the entrance animation in the same callback
      // made heavy screens render halfway through the fade and visibly hitch.
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(() => {
          Animated.timing(scene, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
          }).start(() => {
            transitioning.current = false;
            if (musicEnabled && !musicPlayer.playing) musicPlayer.play();
          });
        });
        transitionFrames.current.push(secondFrame);
      });
      transitionFrames.current.push(firstFrame);
    });
  };

  const changeMusic = (enabled: boolean) => {
    setMusicEnabled(enabled);
    if (enabled) musicPlayer.play();
    else musicPlayer.pause();
  };

  const changeSound = (enabled: boolean) => {
    setSoundEnabled(enabled);
    if (enabled) return;
    dropSfxPlayer.pause();
    mergeSfxPlayer.pause();
    popSfxPlayer.pause();
  };

  const chooseLevel = (index: number) => {
    withTransition(() => {
      setLevelIndex(index);
      setScreen('game');
    });
  };

  const nextLevel = () => {
    withTransition(() => {
      const next = Math.min(levelIndex + 1, LEVELS.length - 1);
      setUnlocked(current => Math.max(current, next + 1));
      setLevelIndex(next);
    });
  };

  const completeLevel = () => {
    setUnlocked(current => Math.max(current, Math.min(levelIndex + 2, LEVELS.length + 1)));
  };

  const markImageDecoded = (index: number) => {
    if (decodedImagesRef.current.has(index)) return;
    decodedImagesRef.current.add(index);
    setDecodedImageCount(decodedImagesRef.current.size);
  };

  const beginBootExit = () => {
    if (bootTransitionStarted.current) return;
    bootTransitionStarted.current = true;
    scene.stopAnimation();
    // The water curtain is fully opaque here. Mounting the home scene in one
    // committed frame behind it prevents logo ghosting and partially drawn UI.
    scene.setValue(1);
  };

  const finishBoot = () => {
    scene.setValue(1);
    setBootVisible(false);
    const musicFrame = requestAnimationFrame(() => {
      if (musicEnabled && !musicPlayer.playing) musicPlayer.play();
    });
    transitionFrames.current.push(musicFrame);
  };

  const resourceUnitCount = PRELOAD_ASSETS.length + PRELOAD_IMAGE_ASSETS.length + 1;
  const completedResourceUnits = loadedAssetCount + decodedImageCount + (preferencesReady ? 1 : 0);
  const resourceProgress = Math.min(1, completedResourceUnits / resourceUnitCount);
  const bootProgress = Math.min(resourceProgress, introProgress);
  const bootReady = loadedAssetCount >= PRELOAD_ASSETS.length
    && decodedImageCount >= PRELOAD_IMAGE_ASSETS.length
    && preferencesReady
    && introMinimumDone;

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={bootVisible || screen === 'home' || screen === 'settings' ? 'light-content' : 'dark-content'} backgroundColor={bootVisible || screen === 'home' || screen === 'settings' ? '#0799c8' : '#eefaff'} />
      <Animated.View
        pointerEvents={bootVisible ? 'none' : 'auto'}
        style={[
          styles.scene,
          {
            opacity: scene,
            transform: [
              { translateY: scene.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              { scale: scene.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
            ],
          },
        ]}
      >
        {screen === 'home' && (
          <Home
            unlocked={unlocked}
            language={language}
            onContinue={() => chooseLevel(Math.min(LEVELS.length - 1, Math.max(0, unlocked - 1)))}
            onLevels={() => withTransition(() => setScreen('levels'))}
            onSettings={() => withTransition(() => setScreen('settings'))}
          />
        )}
        {screen === 'settings' && (
          <Settings
            language={language}
            musicEnabled={musicEnabled}
            soundEnabled={soundEnabled}
            onLanguage={setLanguage}
            onMusic={changeMusic}
            onSound={changeSound}
            onHome={() => withTransition(() => setScreen('home'))}
            onLevels={() => withTransition(() => setScreen('levels'))}
          />
        )}
        {screen === 'levels' && (
          <LevelSelect
            unlocked={unlocked}
            language={language}
            onSelect={chooseLevel}
            onHome={() => withTransition(() => setScreen('home'))}
            onSettings={() => withTransition(() => setScreen('settings'))}
          />
        )}
        {screen === 'game' && (
          <Game
            key={levelIndex}
            levelIndex={levelIndex}
            language={language}
            onExit={() => withTransition(() => setScreen('levels'))}
            onHome={() => withTransition(() => setScreen('home'))}
            onSettings={() => withTransition(() => setScreen('settings'))}
            onNext={nextLevel}
            onComplete={completeLevel}
            onSound={playGameSound}
            hasNext={levelIndex < LEVELS.length - 1}
          />
        )}
      </Animated.View>
      {bootVisible && (
        <BootScreen
          ready={bootReady}
          progress={bootProgress}
          onExitStarted={beginBootExit}
          onFinished={finishBoot}
          onImageDecoded={markImageDecoded}
        />
      )}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eefaff' },
  scene: { flex: 1 },
  bootScreen: { ...StyleSheet.absoluteFill, zIndex: 100, overflow: 'hidden', backgroundColor: 'transparent' },
  bootVisualLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#047eb5' },
  bootBackground: { ...StyleSheet.absoluteFill },
  bootBackgroundImage: { opacity: 1 },
  bootBackgroundTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,74,132,0.2)' },
  bootWaterGlow: { position: 'absolute', width: SCREEN_WIDTH * 1.45, height: SCREEN_WIDTH * 1.45, borderRadius: SCREEN_WIDTH, top: -SCREEN_WIDTH * 0.72, backgroundColor: 'rgba(129,235,255,0.13)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)' },
  bootBubble: { position: 'absolute', borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.66)', backgroundColor: 'rgba(179,242,255,0.16)', shadowColor: '#d9fbff', shadowOpacity: 0.44, shadowRadius: 9 },
  bootBubbleOne: { width: 62, height: 62, left: 28, top: '20%' },
  bootBubbleTwo: { width: 34, height: 34, right: 38, top: '28%' },
  bootBubbleThree: { width: 88, height: 88, right: -25, bottom: '18%' },
  bootBrand: { alignItems: 'center', marginTop: -76 },
  bootTitleBlock: { alignItems: 'center', zIndex: 3 },
  bootHeroWrap: { width: Math.min(304, SCREEN_WIDTH * 0.82), height: Math.min(252, SCREEN_HEIGHT * 0.32), alignItems: 'center', justifyContent: 'center', marginTop: -8 },
  bootHeroGlow: { position: 'absolute', width: '76%', aspectRatio: 1, borderRadius: 999, backgroundColor: 'rgba(189,247,255,0.27)', shadowColor: '#fff', shadowOpacity: 0.72, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  bootHeroImage: { width: '100%', height: '100%' },
  bootLoadingCard: { position: 'absolute', bottom: 78, width: 286, minHeight: 67, borderRadius: 22, paddingHorizontal: 17, paddingVertical: 11, backgroundColor: 'rgba(239,252,255,0.94)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.98)', shadowColor: '#023f69', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 9 },
  bootLoadingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  bootSubtitle: { color: '#276d8d', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 1.2 },
  bootProgressTrack: { width: 250, height: 14, borderRadius: 8, overflow: 'hidden', backgroundColor: '#cce8f1', borderWidth: 1, borderColor: '#afd6e4' },
  bootProgressFill: { position: 'absolute', left: 1, top: 1, height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: '#31cbd8', shadowColor: '#fff', shadowOpacity: 0.85, shadowRadius: 6 },
  bootProgressHighlight: { position: 'absolute', left: 5, right: 5, top: 1, height: 4, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.62)' },
  bootProgressPercent: { color: '#0d7dad', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  bootStudioBrand: { position: 'absolute', bottom: 22, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 38, borderRadius: 19, backgroundColor: 'rgba(3,45,105,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  bootStudioLogo: { width: 32, height: 32, borderRadius: 8, marginRight: 8 },
  bootStudio: { color: 'rgba(229,250,255,0.94)', fontSize: 10, fontWeight: '900', letterSpacing: 2.1 },
  bootTransitionCurtain: { ...StyleSheet.absoluteFill, zIndex: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#08a9d1', borderTopWidth: 2, borderTopColor: 'rgba(255,255,255,0.88)', shadowColor: '#003f72', shadowOpacity: 0.38, shadowRadius: 18, shadowOffset: { width: 0, height: -8 }, elevation: 24 },
  bootCurtainTopFoam: { position: 'absolute', left: '-8%', top: -24, width: '116%', height: 54, borderRadius: 999, backgroundColor: 'rgba(225,252,255,0.92)', borderWidth: 5, borderColor: 'rgba(255,255,255,0.72)' },
  bootCurtainGlow: { position: 'absolute', width: SCREEN_WIDTH * 1.25, height: SCREEN_WIDTH * 1.25, borderRadius: SCREEN_WIDTH, top: -SCREEN_WIDTH * 0.42, backgroundColor: 'rgba(145,239,255,0.24)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
  bootCurtainBubble: { position: 'absolute', borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(212,249,255,0.18)' },
  bootCurtainBubbleOne: { width: 52, height: 52, left: 36, top: '24%' },
  bootCurtainBubbleTwo: { width: 26, height: 26, right: 48, top: '39%' },
  bootCurtainBubbleThree: { width: 78, height: 78, right: -18, bottom: '18%' },
  bootCurtainBrand: { width: 148, height: 145, borderRadius: 32, alignItems: 'center', justifyContent: 'center', paddingTop: 10, paddingBottom: 9, backgroundColor: 'rgba(239,253,255,0.96)', borderWidth: 3, borderColor: '#fff', shadowColor: '#034c7a', shadowOpacity: 0.34, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 12 },
  bootCurtainLogo: { width: 94, height: 94, borderRadius: 23 },
  bootCurtainStudioText: { marginTop: 7, color: '#075986', fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 1.7, textAlign: 'center' },
  bootPreloadRack: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  bootPreloadImage: { position: 'absolute', width: 1, height: 1 },
  assetNavButton: { minWidth: 104, height: 72, borderRadius: 22, backgroundColor: 'rgba(240,252,255,0.94)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, shadowColor: '#075786', shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  assetNavButtonCompact: { minWidth: 0, width: 46, height: 46, borderRadius: 23, paddingHorizontal: 0 },
  assetNavButtonPressed: { transform: [{ translateY: 2 }, { scale: 0.95 }], opacity: 0.92, shadowOpacity: 0.1, elevation: 2 },
  assetNavIcon: { width: 43, height: 43 },
  assetNavIconCompact: { width: 42, height: 42 },
  assetNavLabel: { color: '#286783', fontSize: 9, fontWeight: '900', letterSpacing: 0.65, marginTop: 2 },
  home: { flex: 1, alignItems: 'center', overflow: 'hidden', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  homeBackgroundImage: { opacity: 1 },
  homeTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,73,133,0.12)' },
  homeTopBar: { width: '100%', maxWidth: 410, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  homeTopActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  homeSettingsButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#075786', shadowOpacity: 0.2, shadowRadius: 7, elevation: 4 },
  homeSettingsIcon: { width: 38, height: 38 },
  homeProgressPill: { minWidth: 63, height: 40, borderRadius: 20, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.94)', shadowColor: '#075786', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  homeProgressValue: { color: '#0875b3', fontSize: 16, lineHeight: 16, fontWeight: '900' },
  homeProgressLabel: { color: '#6394ad', fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 0.7 },
  homeTitleBlock: { alignItems: 'center', marginTop: 2, zIndex: 3 },
  homeEyebrow: { color: '#d9f8ff', fontSize: 10, fontWeight: '900', letterSpacing: 2.2, textShadowColor: 'rgba(0,62,104,0.45)', textShadowRadius: 5 },
  homeLogo: { color: '#fff', fontSize: 42, lineHeight: 43, fontWeight: '900', letterSpacing: 2.4, textShadowColor: '#056a9b', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 9 },
  homeLogoAccent: { color: '#ffdd55', fontSize: 31, lineHeight: 34, fontWeight: '900', letterSpacing: 1.8, textShadowColor: '#b35b24', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 6 },
  homeHeroWrap: { width: Math.min(318, SCREEN_WIDTH * 0.84), height: Math.min(275, SCREEN_HEIGHT * 0.34), alignItems: 'center', justifyContent: 'center', marginTop: -5, marginBottom: -4 },
  homeHeroGlow: { position: 'absolute', width: '76%', aspectRatio: 1, borderRadius: 999, backgroundColor: 'rgba(186,246,255,0.3)', shadowColor: '#fff', shadowOpacity: 0.82, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  homeHeroImage: { width: '100%', height: '100%' },
  homeActionCard: { width: '100%', maxWidth: 390, borderRadius: 27, backgroundColor: 'rgba(244,253,255,0.92)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.96)', padding: 12, shadowColor: '#064f7d', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 9 },
  homeTagline: { color: '#315f78', fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  homePrimaryButton: { height: 64, borderRadius: 21, backgroundColor: '#ff5e8c', borderWidth: 2, borderColor: '#ffb5c9', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, overflow: 'hidden', shadowColor: '#9e1748', shadowOpacity: 0.36, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 7 },
  homeButtonShine: { position: 'absolute', left: 9, right: 9, top: 5, height: 18, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  homeButtonPressed: { transform: [{ translateY: 3 }, { scale: 0.985 }], shadowOpacity: 0.16, elevation: 2 },
  homePlayAsset: { width: 49, height: 49, marginRight: 9 },
  homeButtonCopy: { flex: 1 },
  homePrimaryLabel: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 0.8, textShadowColor: 'rgba(120,0,40,0.22)', textShadowRadius: 3 },
  homePrimarySub: { color: '#ffe5ed', fontSize: 10, fontWeight: '800', marginTop: 1 },
  homeButtonArrow: { color: '#fff', fontSize: 34, lineHeight: 36, fontWeight: '600', marginTop: -3 },
  homeSecondaryButton: { height: 48, borderRadius: 17, backgroundColor: '#e8f7fb', borderWidth: 1.5, borderColor: '#b7deeb', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 9 },
  homeSecondaryAsset: { width: 43, height: 43, marginRight: 7 },
  homeSecondaryPressed: { transform: [{ scale: 0.985 }], backgroundColor: '#d9f0f6' },
  homeSecondaryIcon: { color: '#1782b6', fontSize: 22, marginRight: 11 },
  homeSecondaryLabel: { flex: 1, color: '#22627f', fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  homeSecondaryMeta: { color: '#6592a8', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  homeBrandFooter: { marginTop: 'auto', minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 18, backgroundColor: 'rgba(3,45,105,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)', shadowColor: '#03234f', shadowOpacity: 0.28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  homeBrandLogo: { width: 34, height: 34, borderRadius: 9, marginRight: 9 },
  homeBrandText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.7, textShadowColor: 'rgba(0,25,66,0.72)', textShadowRadius: 4 },
  settingsPage: { flex: 1, alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 },
  settingsTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,87,139,0.23)' },
  settingsHeader: { width: '100%', maxWidth: 410, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingsTitleWrap: { alignItems: 'center' },
  settingsEyebrow: { color: '#dcfaff', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, textShadowColor: '#075786', textShadowRadius: 4 },
  settingsTitle: { color: '#fff', fontSize: 25, fontWeight: '900', textShadowColor: '#075786', textShadowRadius: 6 },
  settingsHero: { alignItems: 'center', marginTop: 14 },
  settingsHeroIcon: { width: 112, height: 112 },
  settingsCopy: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center', textShadowColor: '#075786', textShadowRadius: 5, marginTop: -5 },
  settingsCard: { width: '100%', maxWidth: 390, borderRadius: 28, backgroundColor: 'rgba(246,253,255,0.95)', borderWidth: 2, borderColor: '#fff', padding: 18, marginTop: 17, shadowColor: '#064f7d', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 9 },
  settingLabel: { color: '#275c78', fontSize: 15, fontWeight: '900' },
  languageSelector: { flexDirection: 'row', gap: 10, marginTop: 12 },
  languageOption: { flex: 1, height: 55, borderRadius: 17, backgroundColor: '#e8f4f8', borderWidth: 2, borderColor: '#c7e3ec', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  languageOptionActive: { backgroundColor: '#278cd0', borderColor: '#92d5ff', shadowColor: '#1167a4', shadowOpacity: 0.25, shadowRadius: 6, elevation: 4 },
  settingPressed: { transform: [{ scale: 0.97 }] },
  languageFlag: { color: '#ff638e', fontSize: 11, fontWeight: '900', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, marginRight: 7 },
  languageText: { color: '#4b758a', fontSize: 13, fontWeight: '900' },
  languageTextActive: { color: '#fff' },
  settingDivider: { height: 1, backgroundColor: '#d6e9ef', marginVertical: 18 },
  musicRow: { flexDirection: 'row', alignItems: 'center' },
  musicIconBubble: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e3f7ff', borderWidth: 2, borderColor: '#a8ddf1', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  musicIcon: { color: '#1c8fc8', fontSize: 25, fontWeight: '900' },
  soundIcon: { color: '#1c8fc8', fontSize: 22, lineHeight: 24, fontWeight: '900' },
  musicCopy: { flex: 1 },
  settingMeta: { color: '#7096a8', fontSize: 11, fontWeight: '800', marginTop: 2 },
  musicSwitch: { width: 58, height: 34, borderRadius: 17, backgroundColor: '#b8cbd4', padding: 4, justifyContent: 'center' },
  musicSwitchOn: { backgroundColor: '#26c880' },
  musicKnob: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', shadowColor: '#17475c', shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  musicKnobOn: { transform: [{ translateX: 24 }] },
  settingsSaveNote: { color: '#7897a6', fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 17 },
  primaryButton: { minWidth: 230, height: 62, borderRadius: 31, backgroundColor: '#3568e8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, shadowColor: '#173fa7', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 7 }, elevation: 7, borderWidth: 2, borderColor: '#84a4f4' },
  buttonPressed: { transform: [{ translateY: 3 }, { scale: 0.975 }], opacity: 0.94, shadowOpacity: 0.12, elevation: 2 },
  primaryButtonText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1.1 },
  playArrow: { color: '#fff', fontSize: 31, fontWeight: '500', marginLeft: 16, marginTop: -2 },
  tinyHint: { color: '#88a0b2', fontSize: 12, fontWeight: '600', marginTop: 22 },
  creature: { borderWidth: 3, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  ears: { position: 'absolute', top: -3, width: '72%', flexDirection: 'row', justifyContent: 'space-between' },
  ear: { borderRadius: 9, transform: [{ rotate: '8deg' }] },
  face: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', marginTop: -3 },
  eye: { backgroundColor: '#223848', borderWidth: 1.5, borderColor: '#fff' },
  smile: { marginTop: 5, borderBottomWidth: 2.5, borderColor: '#654058' },
  cheek: { position: 'absolute', width: 6, height: 3, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)', top: '58%' },
  cheekLeft: { left: '19%' },
  cheekRight: { right: '19%' },
  bubbleFrame: { alignItems: 'center', justifyContent: 'center' },
  bubble: { backgroundColor: 'rgba(242,252,255,0.78)', borderWidth: 2.5, borderColor: '#8ac9df', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  creatureLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bubbleShine: { position: 'absolute', left: '17%', top: '11%', width: '24%', height: '12%', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', transform: [{ rotate: '-28deg' }] },
  waterLine: { position: 'absolute', left: '9%', right: '9%', top: '25%', height: 2, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.66)', transform: [{ rotate: '-3deg' }] },
  microBubble: { position: 'absolute', width: 5, height: 5, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.86)', backgroundColor: 'rgba(212,244,255,0.28)' },
  dentCut: { position: 'absolute', zIndex: 20, backgroundColor: '#d9f3fb', borderWidth: 1, borderColor: 'rgba(255,255,255,0.82)' },
  miniCreature: { borderWidth: 1.3, alignItems: 'center', justifyContent: 'center', shadowColor: '#31516a', shadowOpacity: 0.12, shadowRadius: 1 },
  miniEar: { position: 'absolute', top: -2, width: 4, height: 4, borderRadius: 2 },
  miniFace: { width: '52%', flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },
  miniEye: { width: 2.5, height: 3.5, borderRadius: 2, backgroundColor: '#263a49' },
  countBadge: { position: 'absolute', right: -2, bottom: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#7dbbd2', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countText: { color: '#315b74', fontSize: 10, fontWeight: '900' },
  emptyMergeFlash: { position: 'absolute', zIndex: 18, left: '17%', right: '17%', top: '17%', bottom: '17%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)', shadowColor: '#d8f8ff', shadowOpacity: 0.95, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  transferCreature: { position: 'absolute', zIndex: 30, left: BUBBLE_SIZE / 2 - 13, top: BUBBLE_SIZE / 2 - 18, width: 28, height: 38, alignItems: 'center', justifyContent: 'center' },
  motionTrail: { position: 'absolute', left: '29%', top: -34, width: '42%', height: 54, borderRadius: 999, backgroundColor: '#fff' },
  motionShadow: { position: 'absolute', left: '17%', right: '17%', bottom: -5, height: 9, borderRadius: 999, backgroundColor: 'rgba(46,91,112,0.16)', transform: [{ scaleX: 1.08 }] },
  escapeSwimmer: { position: 'absolute', zIndex: 12, left: BUBBLE_SIZE / 2 - 17, top: BUBBLE_SIZE / 2 - 25, width: 34, height: 50, alignItems: 'center', justifyContent: 'center' },
  rescueFlightLayer: { ...StyleSheet.absoluteFill, zIndex: 36, overflow: 'visible' },
  escapePufferfishImage: { width: 42, height: 42 },
  escapeGlow: { position: 'absolute', width: 39, height: 39, borderRadius: 20, opacity: 0.58, shadowOpacity: 0.85, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
  swimWake: { position: 'absolute', zIndex: -1, left: -20, top: 22, width: 29, height: 7, borderRadius: 999, backgroundColor: 'rgba(191,238,255,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.82)' },
  swimBubbleLarge: { position: 'absolute', right: -5, bottom: 8, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: '#fff', backgroundColor: 'rgba(168,229,255,0.5)' },
  swimBubbleSmall: { position: 'absolute', right: -9, bottom: 20, width: 4, height: 4, borderRadius: 2, borderWidth: 0.8, borderColor: '#fff', backgroundColor: 'rgba(168,229,255,0.42)' },
  waterDrop: { position: 'absolute', zIndex: 11, left: BUBBLE_SIZE / 2 - 4, top: BUBBLE_SIZE / 2 - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(174,231,255,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  popRing: { position: 'absolute', zIndex: 10, left: -5, right: -5, top: -5, bottom: -5, borderRadius: 999, borderWidth: 4, borderColor: 'rgba(163,229,255,0.95)', backgroundColor: 'rgba(210,244,255,0.18)' },
  popRingSecondary: { position: 'absolute', zIndex: 9, left: 2, right: 2, top: 2, bottom: 2, borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.96)' },
  effectBubble: { position: 'absolute', zIndex: 16, borderWidth: 1.25, borderColor: 'rgba(255,255,255,0.96)', backgroundColor: 'rgba(149,226,255,0.36)', shadowColor: '#b7efff', shadowOpacity: 0.72, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  mergeEffectBubble: { zIndex: 7, backgroundColor: 'rgba(214,247,255,0.54)', borderColor: 'rgba(255,255,255,0.9)' },
  mergeBubbleParticle: { position: 'absolute', zIndex: 19 },
  completionFlash: { position: 'absolute', zIndex: 8, left: '14%', right: '14%', top: '14%', bottom: '14%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.86)', shadowColor: '#a8ecff', shadowOpacity: 0.94, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  levelPage: { flex: 1, paddingHorizontal: 20, paddingTop: 14 },
  levelBackdropTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(232,249,255,0.78)' },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  circleButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#446b88', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4, borderWidth: 1, borderColor: '#e1eef5' },
  iconButtonPressed: { transform: [{ translateY: 2 }, { scale: 0.94 }], opacity: 0.88, elevation: 1 },
  backText: { fontSize: 34, lineHeight: 36, color: '#3568e8', fontWeight: '600', marginTop: -4 },
  eyebrow: { textAlign: 'center', fontSize: 11, color: '#6f8da2', fontWeight: '900', letterSpacing: 1.4 },
  pageTitle: { fontSize: 24, color: '#21425e', fontWeight: '900', marginTop: 2 },
  headerSpacer: { width: 44 },
  levelPath: { position: 'absolute', left: '50%', top: 130, bottom: 60, width: 5, borderRadius: 3, backgroundColor: '#d7e8f1' },
  levelCard: { height: 104, backgroundColor: '#fff', borderRadius: 25, marginBottom: 22, flexDirection: 'row', alignItems: 'center', padding: 16, width: '92%', shadowColor: '#416178', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 7 }, elevation: 4, borderWidth: 2, borderColor: '#e6f0f5' },
  levelLeft: { alignSelf: 'flex-start' },
  levelRight: { alignSelf: 'flex-end' },
  worldBanner: { height: 105, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 17, justifyContent: 'center', backgroundColor: 'rgba(7,87,134,0.82)', overflow: 'hidden', shadowColor: '#075786', shadowOpacity: 0.27, shadowRadius: 12, shadowOffset: { width: 0, height: 7 }, elevation: 6 },
  worldBannerImage: { borderRadius: 24 },
  worldEyebrow: { color: '#cbd8ff', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  worldTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 2 },
  worldSubtitle: { color: '#dfe7ff', fontSize: 12, fontWeight: '700', marginTop: 3 },
  pageSwitcher: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pageArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dce9f1' },
  pageArrowDisabled: { opacity: 0.3 },
  pageArrowText: { color: '#3568e8', fontSize: 25, lineHeight: 28, fontWeight: '800' },
  pageDots: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16 },
  pageDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#c8dae5' },
  pageDotActive: { width: 19, backgroundColor: '#3568e8' },
  pageCounter: { color: '#55788f', fontSize: 10, fontWeight: '900', marginLeft: 5, minWidth: 42 },
  levelScroll: { flex: 1 },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 30, gap: 10 },
  levelTileAnimator: { width: '48.4%' },
  levelTile: { width: '100%', minHeight: 166, borderRadius: 25, backgroundColor: '#f9fdff', padding: 11, borderWidth: 2, borderColor: '#dcebf2', shadowColor: '#315b75', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4, overflow: 'hidden' },
  levelTileComplete: { borderColor: '#86ddba', backgroundColor: '#f3fff9' },
  levelTileCurrent: { borderColor: '#65a7ed', backgroundColor: '#f5faff', shadowColor: '#1765ae', shadowOpacity: 0.27, elevation: 7 },
  levelLocked: { opacity: 0.64, backgroundColor: '#edf4f7', borderColor: '#d7e4ea' },
  levelCardWash: { position: 'absolute', left: -28, top: -48, width: 116, height: 116, borderRadius: 58, opacity: 0.13 },
  levelCardSheen: { position: 'absolute', left: 7, right: 7, top: 5, height: 27, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.52)' },
  levelCardTop: { flexDirection: 'row', alignItems: 'center', minHeight: 76 },
  levelMedallionWrap: { width: 73, height: 73, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  levelMedallionAsset: { width: 73, height: 73 },
  levelLockedMedallion: { width: 53, height: 53, borderRadius: 27, backgroundColor: '#9fb3bf', borderWidth: 4, borderColor: 'rgba(255,255,255,0.86)', alignItems: 'center', justifyContent: 'center', shadowColor: '#355467', shadowOpacity: 0.18, shadowRadius: 5, elevation: 3 },
  levelLockedSymbol: { color: '#fff', fontSize: 19, fontWeight: '900' },
  levelNumberChip: { position: 'absolute', minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3568e8', borderWidth: 2.5, borderColor: '#fff', shadowColor: '#17478e', shadowOpacity: 0.25, shadowRadius: 4, elevation: 4 },
  levelNumberChipComplete: { backgroundColor: '#20b76a' },
  levelNumberChipText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  levelCardCopy: { flex: 1, marginLeft: 3 },
  levelStateLabel: { color: '#7c9bad', fontSize: 7.5, lineHeight: 11, fontWeight: '900', letterSpacing: 0.45, marginTop: 3 },
  levelColorStrip: { height: 25, borderRadius: 13, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(222,241,248,0.78)', marginTop: 2 },
  levelColorPearl: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: '#fff', marginHorizontal: -0.5, shadowColor: '#315b75', shadowOpacity: 0.18, shadowRadius: 2, elevation: 2 },
  levelMoreColors: { color: '#608096', fontSize: 8, fontWeight: '900', marginLeft: 3 },
  levelStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 },
  cardPressed: { transform: [{ scale: 0.98 }] },
  levelNumber: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#3568e8', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#aac4ff', marginBottom: 6 },
  levelNumberComplete: { backgroundColor: '#20b76a', borderColor: '#a8edcf' },
  levelNumberLocked: { backgroundColor: '#9aafbd', borderColor: '#cddae1' },
  levelNumberText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  levelCopy: { flex: 1, marginLeft: 14 },
  levelName: { fontSize: 15, color: '#26465e', fontWeight: '900' },
  levelSubtitle: { fontSize: 10, color: '#7690a2', fontWeight: '700', marginTop: 3 },
  levelGoalPill: { height: 25, borderRadius: 13, backgroundColor: '#fff1be', paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  levelGoalText: { color: '#ae7600', fontSize: 10, fontWeight: '900' },
  levelArrow: { fontSize: 31, color: '#ff5f8d', fontWeight: '700' },
  gamePage: { flex: 1, alignItems: 'center', backgroundColor: '#e9f8fe', paddingTop: 5, paddingHorizontal: BOARD_EDGE_GAP },
  gameTop: { width: BOARD_WIDTH, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gameNavPair: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  gameRightActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  levelBadge: { alignItems: 'center' },
  levelBadgeTop: { color: '#7892a5', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  levelBadgeNumber: { color: '#294b64', fontSize: 24, fontWeight: '900', lineHeight: 25 },
  goalRow: { width: BOARD_WIDTH, height: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, marginTop: 4 },
  goalRemainingPill: { minWidth: 92, height: 47, flexDirection: 'row', alignItems: 'center', paddingLeft: 4, paddingRight: 16, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 2, borderColor: '#fff', shadowColor: '#315f78', shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  goalCollectRing: { position: 'absolute', left: 3, top: 2, width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#8df1ff', backgroundColor: 'rgba(187,248,255,0.28)', shadowColor: '#68e7ff', shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  goalFishIcon: { width: 42, height: 42, marginRight: 8 },
  goalRemainingCount: { minWidth: 24, color: '#176f99', fontSize: 22, lineHeight: 25, fontWeight: '900', textAlign: 'center' },
  launchArea: { width: BOARD_WIDTH, height: 29, alignItems: 'center', justifyContent: 'center' },
  nextPreviewDock: { position: 'absolute', zIndex: 12, right: 7, top: -48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(241,252,255,0.96)', borderWidth: 2.5, shadowColor: '#155f83', shadowOpacity: 0.34, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 11 },
  launchBubbleRing: { position: 'absolute', top: 30, left: BOARD_WIDTH / 2 - 36, width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', shadowColor: '#396c87', shadowOpacity: 0.14, shadowRadius: 8, elevation: 4 },
  gameMessage: { color: '#4c7188', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  dropPointerText: { position: 'absolute', left: BOARD_WIDTH / 2 - 7, bottom: 13, color: '#ff6793', fontWeight: '900', fontSize: 24, lineHeight: 20 },
  boardShell: { width: BOARD_WIDTH, height: BOARD_HEIGHT, borderRadius: 29, backgroundColor: '#c9edf7', overflow: 'hidden', borderWidth: 3, borderColor: '#f9feff', shadowColor: '#174e82', shadowOpacity: 0.27, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 8 },
  boardWaterBase: { ...StyleSheet.absoluteFill, backgroundColor: '#d8f3fa' },
  boardDepthBandOne: { position: 'absolute', left: '-18%', top: 112, width: '136%', height: 190, borderRadius: 999, backgroundColor: 'rgba(172,226,242,0.1)' },
  boardDepthBandTwo: { position: 'absolute', left: '-25%', bottom: 28, width: '150%', height: 225, borderRadius: 999, backgroundColor: 'rgba(92,196,222,0.09)' },
  boardGlow: { position: 'absolute', width: '156%', height: '44%', left: '-28%', top: -88, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  boardLightRay: { position: 'absolute', top: -34, width: 30, height: 310, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.13)' },
  boardLightRayOne: { left: 57, transform: [{ rotate: '9deg' }] },
  boardLightRayTwo: { left: 132, width: 18, opacity: 0.72, transform: [{ rotate: '5deg' }] },
  boardLightRayThree: { right: 55, width: 38, opacity: 0.66, transform: [{ rotate: '-10deg' }] },
  boardInnerRim: { position: 'absolute', left: 3, right: 3, top: 3, bottom: 3, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(105,190,220,0.34)' },
  boardAmbientBubble: { position: 'absolute', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)', backgroundColor: 'rgba(220,249,255,0.18)' },
  boardAmbientBubbleOne: { width: 12, height: 12, left: 24, top: 112 },
  boardAmbientBubbleTwo: { width: 7, height: 7, left: 37, top: 135 },
  boardAmbientBubbleThree: { width: 14, height: 14, right: 25, top: 159 },
  boardAmbientBubbleFour: { width: 8, height: 8, right: 43, top: 185 },
  reefLeft: { position: 'absolute', left: 15, bottom: 43, width: 52, height: 50 },
  reefLeaf: { position: 'absolute', bottom: 0, width: 12, borderRadius: 8, backgroundColor: 'rgba(42,180,164,0.44)', borderWidth: 1, borderColor: 'rgba(231,255,250,0.38)' },
  reefLeafLeft: { left: 5, height: 33, transform: [{ rotate: '-18deg' }] },
  reefLeafCenter: { left: 22, height: 48, transform: [{ rotate: '5deg' }] },
  reefLeafRight: { left: 38, height: 27, transform: [{ rotate: '22deg' }] },
  reefRight: { position: 'absolute', right: 18, bottom: 43, width: 51, height: 48 },
  coralBranch: { position: 'absolute', bottom: 0, width: 9, borderRadius: 7, backgroundColor: 'rgba(255,125,147,0.4)', borderWidth: 1, borderColor: 'rgba(255,235,240,0.42)' },
  coralBranchLeft: { left: 5, height: 29, transform: [{ rotate: '-21deg' }] },
  coralBranchCenter: { left: 22, height: 46, transform: [{ rotate: '2deg' }] },
  coralBranchRight: { left: 38, height: 34, transform: [{ rotate: '24deg' }] },
  boardObstacle: { position: 'absolute', zIndex: 2, borderWidth: 2.5, overflow: 'hidden', shadowColor: '#173f61', shadowOpacity: 0.32, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
  boardObstacleTexture: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  boardObstacleVarnish: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(25,111,112,0.08)' },
  boardObstacleShine: { position: 'absolute', left: 9, right: 9, top: 2, height: 3, borderRadius: 4, backgroundColor: 'rgba(255,244,207,0.58)' },
  boardObstaclePearl: { position: 'absolute', top: '50%', width: 7, height: 7, borderRadius: 4, marginTop: -3.5, backgroundColor: '#e2ab43', borderWidth: 1, borderColor: 'rgba(255,243,183,0.88)' },
  boardObstaclePearlLeft: { left: 13 },
  boardObstaclePearlRight: { right: 13 },
  boardObstacleBumperRing: { position: 'absolute', left: 5, right: 5, top: 5, bottom: 5, borderRadius: 999, borderWidth: 2, borderColor: 'rgba(226,171,67,0.82)' },
  leftRail: { position: 'absolute', zIndex: 6, left: 0, top: 0, bottom: 0, width: BOARD_WALL_INSET, backgroundColor: '#087d8c', borderRightWidth: 1.5, borderRightColor: '#f6c752', shadowColor: '#123c55', shadowOpacity: 0.26, shadowRadius: 5, shadowOffset: { width: 2, height: 0 }, overflow: 'hidden' },
  rightRail: { position: 'absolute', zIndex: 6, right: 0, top: 0, bottom: 0, width: BOARD_WALL_INSET, backgroundColor: '#087d8c', borderRightWidth: 1.5, borderRightColor: '#f6c752', shadowColor: '#123c55', shadowOpacity: 0.26, shadowRadius: 5, shadowOffset: { width: -2, height: 0 }, overflow: 'hidden', transform: [{ scaleX: -1 }] },
  sideFrameTexture: { position: 'absolute', left: -BOARD_WALL_INSET * 2.95, top: 0, bottom: 0, width: BOARD_WALL_INSET * 6.65, height: '100%' },
  failLineGlow: { position: 'absolute', left: 16, right: 16, top: FAIL_LINE_Y - 4, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,82,126,0.12)', zIndex: 4 },
  failLineGlowWarning: { backgroundColor: 'rgba(255,35,70,0.52)', shadowColor: '#ff163f', shadowOpacity: 0.95, shadowRadius: 12, elevation: 5 },
  dropLimit: { position: 'absolute', left: 18, right: 18, top: FAIL_LINE_Y, height: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 5 },
  dropLimitDash: { flex: 1, height: 4, marginHorizontal: 3, borderRadius: 3, backgroundColor: '#ff6689', borderWidth: 0.7, borderColor: 'rgba(255,255,255,0.88)', shadowColor: '#ff376f', shadowOpacity: 0.35, shadowRadius: 3, elevation: 1 },
  dropLimitDashWarning: { height: 5, backgroundColor: '#ff163f', borderColor: '#fff4f6', shadowColor: '#c9002e', shadowOpacity: 0.9, shadowRadius: 7, elevation: 5 },
  freeDropArea: { ...StyleSheet.absoluteFill, zIndex: 1 },
  heldBubble: { position: 'absolute', left: 0, zIndex: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.5)', shadowColor: '#245f80', shadowOpacity: 0.24, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  piece: { position: 'absolute', width: BUBBLE_SIZE, height: BUBBLE_SIZE, zIndex: 3 },
  elasticBody: { position: 'absolute', left: 0, top: 0, width: BUBBLE_SIZE, height: BUBBLE_SIZE },
  pieceBody: { position: 'absolute', left: 0, top: 0, width: BUBBLE_SIZE, height: BUBBLE_SIZE },
  floor: { position: 'absolute', bottom: -39, left: -25, right: -25, height: 84, borderRadius: 42, backgroundColor: '#e8cf8f', borderTopWidth: 4, borderColor: '#7ebfc0', overflow: 'hidden' },
  floorTexture: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  floorGlow: { position: 'absolute', left: 32, right: 32, top: 7, height: 18, borderRadius: 12, backgroundColor: 'rgba(226,255,248,0.3)' },
  floorPebble: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(65,156,169,0.26)', borderWidth: 1, borderColor: 'rgba(232,255,252,0.33)' },
  floorPebbleOne: { width: 14, height: 8, left: 52, top: 20, transform: [{ rotate: '-12deg' }] },
  floorPebbleTwo: { width: 20, height: 10, left: 101, top: 11, transform: [{ rotate: '9deg' }] },
  floorPebbleThree: { width: 12, height: 7, right: 84, top: 22, transform: [{ rotate: '18deg' }] },
  floorPebbleFour: { width: 18, height: 9, right: 38, top: 12, transform: [{ rotate: '-8deg' }] },
  tutorialShade: { ...StyleSheet.absoluteFill, zIndex: 30, backgroundColor: 'rgba(4,38,62,0.76)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  tutorialCard: { width: '100%', maxWidth: 368, alignItems: 'center', borderRadius: 32, backgroundColor: '#f7fdff', borderWidth: 3, borderColor: '#b9edfb', paddingHorizontal: 22, paddingTop: 22, paddingBottom: 19, shadowColor: '#001d35', shadowOpacity: 0.42, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 20, overflow: 'hidden' },
  tutorialStepPill: { minWidth: 132, height: 29, borderRadius: 15, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dff8ff', borderWidth: 1.5, borderColor: '#9bdff2' },
  tutorialStepText: { color: '#17769a', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  tutorialFishRow: { minHeight: 88, marginTop: 13, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tutorialFishBubble: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(220,248,255,0.82)', borderWidth: 3, shadowColor: '#287a9c', shadowOpacity: 0.16, shadowRadius: 6, elevation: 4 },
  tutorialFishImage: { width: 63, height: 63 },
  tutorialTitle: { color: '#173f59', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  tutorialBody: { color: '#58768a', fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center', marginTop: 9 },
  tutorialFlowPill: { width: '100%', minHeight: 45, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8f8fd', borderWidth: 1.5, borderColor: '#b9e5f2', marginTop: 15 },
  tutorialFlowText: { color: '#24657f', fontSize: 10.5, fontWeight: '900', textAlign: 'center', letterSpacing: 0.25 },
  tutorialWarning: { marginTop: 9, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: '#fff0f5' },
  tutorialWarningText: { color: '#e84f79', fontSize: 8.5, fontWeight: '900', textAlign: 'center' },
  tutorialButton: { width: '100%', height: 58, borderRadius: 29, marginTop: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18b97c', borderWidth: 2, borderColor: '#7fe3bc', shadowColor: '#08714e', shadowOpacity: 0.27, shadowRadius: 9, shadowOffset: { width: 0, height: 6 }, elevation: 7, overflow: 'hidden' },
  tutorialButtonShine: { position: 'absolute', left: 15, right: 15, top: 5, height: 17, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)' },
  tutorialButtonText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.7 },
  tutorialButtonArrow: { position: 'absolute', right: 20, color: '#fff', fontSize: 35, fontWeight: '500', lineHeight: 37 },
  modalShade: { ...StyleSheet.absoluteFill, zIndex: 20, backgroundColor: 'rgba(4,35,61,0.83)', alignItems: 'center', justifyContent: 'center', padding: 22, overflow: 'hidden' },
  resultAmbientBubbleOne: { position: 'absolute', width: 132, height: 132, borderRadius: 66, borderWidth: 3, borderColor: 'rgba(205,245,255,0.33)', backgroundColor: 'rgba(116,213,240,0.1)', left: -46, top: '15%' },
  resultAmbientBubbleTwo: { position: 'absolute', width: 70, height: 70, borderRadius: 35, borderWidth: 2, borderColor: 'rgba(255,255,255,0.32)', backgroundColor: 'rgba(116,213,240,0.08)', right: 12, top: '8%' },
  resultAmbientBubbleThree: { position: 'absolute', width: 104, height: 104, borderRadius: 52, borderWidth: 2, borderColor: 'rgba(205,245,255,0.25)', backgroundColor: 'rgba(116,213,240,0.07)', right: -38, bottom: '11%' },
  resultCard: { width: '100%', maxWidth: 370, alignItems: 'center', backgroundColor: '#f8fdff', borderRadius: 35, paddingHorizontal: 23, paddingTop: 25, paddingBottom: 17, borderWidth: 3, overflow: 'visible', shadowColor: '#001d35', shadowOpacity: 0.43, shadowRadius: 30, shadowOffset: { width: 0, height: 17 }, elevation: 18 },
  resultCardWon: { borderColor: '#aee9fa', backgroundColor: '#f5fcff' },
  resultCardLost: { borderColor: '#ffd0da', backgroundColor: '#fff9fb' },
  resultCardSheen: { position: 'absolute', left: 12, right: 12, top: 9, height: 74, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.58)' },
  resultLevelPill: { position: 'absolute', right: 16, top: 14, minWidth: 68, height: 27, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e1f7ff', borderWidth: 1.5, borderColor: '#afe3f5', zIndex: 8 },
  resultLevelPillLost: { backgroundColor: '#fff0f3', borderColor: '#ffc5d2' },
  resultLevelPillText: { color: '#46768e', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  resultVictoryStage: { width: 224, height: 177, alignItems: 'center', justifyContent: 'center', marginTop: -88, marginBottom: -8 },
  resultVictoryGlow: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,225,92,0.22)', shadowColor: '#fff1a6', shadowOpacity: 0.92, shadowRadius: 27, shadowOffset: { width: 0, height: 0 } },
  resultVictoryImage: { width: 202, height: 212 },
  resultSparkle: { position: 'absolute', color: '#ffd653', fontSize: 28, fontWeight: '900', textShadowColor: '#fff4a5', textShadowRadius: 7 },
  resultSparkleLeft: { left: 0, top: 34, transform: [{ rotate: '-14deg' }] },
  resultSparkleRight: { right: 2, top: 61, transform: [{ rotate: '12deg' }] },
  resultFailureStage: { width: 174, height: 151, alignItems: 'center', justifyContent: 'center', marginTop: -76, marginBottom: 2 },
  resultFailureGlow: { position: 'absolute', width: 148, height: 148, borderRadius: 74, backgroundColor: 'rgba(255,100,137,0.16)', shadowColor: '#ff8aa5', shadowOpacity: 0.76, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  resultFailureBubble: { width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: 'rgba(220,246,255,0.94)', borderWidth: 5, borderColor: '#fff', shadowColor: '#174d69', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  resultFailureWater: { position: 'absolute', left: -12, right: -12, bottom: -12, height: 67, borderRadius: 40, backgroundColor: '#bceaf4', borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.85)', transform: [{ rotate: '-4deg' }] },
  resultFailureFish: { width: 93, height: 93, marginTop: 10 },
  resultFailureHighlight: { position: 'absolute', left: 21, top: 15, width: 42, height: 13, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.82)', transform: [{ rotate: '-18deg' }] },
  resultAlertBadge: { position: 'absolute', right: 3, top: 15, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff5d82', borderWidth: 4, borderColor: '#fff', shadowColor: '#9d1238', shadowOpacity: 0.34, shadowRadius: 7, elevation: 9 },
  resultAlertText: { color: '#fff', fontSize: 25, lineHeight: 28, fontWeight: '900' },
  resultFailureBubbleSmall: { position: 'absolute', left: 4, top: 19, width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)', backgroundColor: 'rgba(162,226,244,0.32)' },
  resultStatusPill: { height: 28, borderRadius: 14, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  resultStatusWon: { backgroundColor: '#e4fbf2', borderColor: '#a9ead1' },
  resultStatusLost: { backgroundColor: '#fff0f3', borderColor: '#ffc4d1' },
  resultEyebrow: { color: '#149567', fontSize: 10, fontWeight: '900', letterSpacing: 1.35 },
  resultEyebrowLost: { color: '#df4268' },
  resultTitle: { color: '#183f5a', fontSize: 27, fontWeight: '900', marginTop: 8, textAlign: 'center', letterSpacing: -0.3 },
  resultCopy: { color: '#66869a', fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center', marginTop: 7, marginBottom: 12, paddingHorizontal: 4 },
  resultScorePill: { height: 57, minWidth: 160, borderRadius: 29, backgroundColor: '#e8f9ff', borderWidth: 2, borderColor: '#b8e7f7', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginBottom: 14, shadowColor: '#4a95b2', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  resultScorePillLost: { backgroundColor: '#fff2f5', borderColor: '#ffd0da' },
  resultScoreFish: { width: 48, height: 48, marginRight: 8 },
  resultScoreValue: { color: '#167cb1', fontSize: 18, lineHeight: 20, fontWeight: '900' },
  resultScoreLabel: { color: '#6f96aa', fontSize: 7, fontWeight: '900', letterSpacing: 0.9 },
  nextLevelLoader: { minWidth: 240, height: 62, borderRadius: 31, backgroundColor: '#edf3ff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 2, borderColor: '#cbd9fa' },
  loadingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loaderDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3568e8' },
  nextLevelText: { color: '#3560b9', fontSize: 12, fontWeight: '900', marginLeft: 10 },
  resultPrimaryButton: { width: '100%', minWidth: 0, height: 64, overflow: 'hidden' },
  resultPrimaryWon: { backgroundColor: '#18b87b', borderColor: '#82e4bd', shadowColor: '#08724d' },
  resultPrimaryLost: { backgroundColor: '#ef5279', borderColor: '#ffafc2', shadowColor: '#a11944' },
  resultButtonShine: { position: 'absolute', left: 13, right: 13, top: 5, height: 18, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  resultButtonAsset: { position: 'absolute', right: 8, width: 52, height: 52 },
  resultRetryIcon: { position: 'absolute', right: 13, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.19)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' },
  resultRetryText: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '700' },
  textButton: { paddingHorizontal: 18, paddingVertical: 12, marginTop: 4, borderRadius: 18 },
  resultLevelsButton: { minWidth: 176, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  resultLevelsAsset: { width: 31, height: 31, marginRight: 5 },
  textButtonPressed: { backgroundColor: '#edf5f9', transform: [{ scale: 0.97 }] },
  textButtonLabel: { color: '#648097', fontWeight: '800', fontSize: 13 },
});
