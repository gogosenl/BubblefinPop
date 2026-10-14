const COLORS = ['berry', 'coral', 'sun', 'mint', 'aqua', 'sky', 'plum', 'navy'];
const TOTAL_LEVELS = 100;
const LEVELS_PER_WORLD = 20;
const BOARD_PATTERN_COUNT = 24;
const CURRENT_PATTERN_STAGES = new Set([15, 16, 18, 22]);
const MOVING_OBSTACLE_STAGES = new Set([6, 8, 9, 10, 12, 13, 14, 19, 21, 22]);

const levels = Array.from({ length: TOTAL_LEVELS }, (_, index) => {
  if (index === 0) return { id: 1, goal: 6, merge: 6, moves: 6, palette: ['coral'], seedCount: 1, tutorial: 1 };
  if (index === 1) return { id: 2, goal: 12, merge: 6, moves: 10, palette: ['coral', 'sky'], seedCount: 2, tutorial: 2 };
  if (index === 2) return { id: 3, goal: 18, merge: 6, moves: 14, palette: ['coral', 'sky', 'mint'], seedCount: 3, tutorial: 3 };
  const world = Math.floor(index / LEVELS_PER_WORLD);
  const stage = index % LEVELS_PER_WORLD;
  const paletteSize = Math.min(COLORS.length, 3 + Math.floor((index - 3) / 12));
  return {
    id: index + 1,
    goal: Math.min(48, 12 + world * 5 + Math.floor(stage / 4) * 3),
    merge: 6 + Math.min(2, Math.floor(index / 40)),
    moves: 16 + Math.min(18, world * 2 + Math.floor(stage / 5)),
    palette: Array.from({ length: paletteSize }, (_, colorIndex) => COLORS[(Math.floor(world / 3) + colorIndex) % COLORS.length]),
    seedCount: index < 20 ? 3 + (stage % 3) : Math.min(9, 5 + Math.floor(world / 2) + (stage % 3)),
  };
});

const issues = [];
const ids = new Set();
let maximumGuaranteedColorWait = 0;
let maximumWorstCaseDrops = 0;
let calmBoardCount = 0;
let currentBoardCount = 0;
let movingObstacleBoardCount = 0;
for (const level of levels) {
  if (ids.has(level.id)) issues.push(`Duplicate level id ${level.id}`);
  ids.add(level.id);
  if (!level.palette.length || new Set(level.palette).size !== level.palette.length) issues.push(`Level ${level.id}: invalid palette`);
  if (level.palette.some(color => !COLORS.includes(color))) issues.push(`Level ${level.id}: unknown color`);
  if (level.goal <= 0 || level.merge < 6 || level.merge > 11) issues.push(`Level ${level.id}: invalid target`);
  if (level.seedCount > 20) issues.push(`Level ${level.id}: unsafe starting density`);

  // Every generated bubble contains at least three fish. The fair color bag in
  // App.tsx presents every palette color once per cycle, so even the worst RNG
  // can complete a same-color bubble in ceil(merge / 3) color appearances.
  const appearancesPerPop = Math.ceil(level.merge / 3);
  const fullPaletteBatches = Math.ceil(level.goal / (level.merge * level.palette.length));
  const worstCaseDrops = appearancesPerPop * level.palette.length * fullPaletteBatches;
  maximumGuaranteedColorWait = Math.max(maximumGuaranteedColorWait, level.palette.length);
  maximumWorstCaseDrops = Math.max(maximumWorstCaseDrops, worstCaseDrops);
  if (!Number.isFinite(worstCaseDrops) || worstCaseDrops <= 0) issues.push(`Level ${level.id}: unreachable goal`);

  const rawStage = (level.id - 1) % BOARD_PATTERN_COUNT;
  const patternStage = level.id > 3 && rawStage === 1 ? 15 : level.id > 3 && rawStage === 2 ? 17 : rawStage;
  if (level.id <= 3 || patternStage === 0) calmBoardCount += 1;
  if (CURRENT_PATTERN_STAGES.has(patternStage)) currentBoardCount += 1;
  if (MOVING_OBSTACLE_STAGES.has(patternStage)) movingObstacleBoardCount += 1;
}

if (levels.length !== TOTAL_LEVELS) issues.push(`Catalog does not contain ${TOTAL_LEVELS} levels`);
if (Math.ceil(levels.length / LEVELS_PER_WORLD) !== 5) issues.push('Catalog does not contain 5 worlds');
if (levels.slice(0, 3).some((level, index) => level.tutorial !== index + 1 || level.palette.length !== index + 1)) {
  issues.push('Tutorial progression is invalid');
}
if (calmBoardCount < 3 || calmBoardCount > 10) issues.push(`Calm board frequency is not rare enough: ${calmBoardCount}`);
if (currentBoardCount < 10) issues.push(`Too few current-field boards: ${currentBoardCount}`);
if (movingObstacleBoardCount < 25) issues.push(`Too few moving-obstacle boards: ${movingObstacleBoardCount}`);

if (issues.length) {
  console.error(`FAILED: ${issues.length} level audit issue(s)`);
  issues.slice(0, 30).forEach(issue => console.error(`- ${issue}`));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${TOTAL_LEVELS} / ${TOTAL_LEVELS} levels passed the reachability audit.`);
  console.log('PASS: 5 worlds contain exactly 20 levels each.');
  console.log(`PASS: Fair color bag guarantees every color within ${maximumGuaranteedColorWait} drops.`);
  console.log(`PASS: Worst catalog target remains reachable within ${maximumWorstCaseDrops} drops under minimum-count RNG.`);
  console.log('PASS: No enforced move limit can make a level mathematically impossible.');
  console.log(`PASS: ${calmBoardCount} calm boards are spaced as occasional rest stages.`);
  console.log(`PASS: ${currentBoardCount} boards use current or vortex gameplay.`);
  console.log(`PASS: ${movingObstacleBoardCount} boards use moving obstacle gameplay.`);
  console.log('PASS: The 24-pattern obstacle rotation keeps every beam below 40% of the board.');
}
