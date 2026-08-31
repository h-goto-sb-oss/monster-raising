// maps.js
// 歩けるマップの定義。町・内装5・ダンジョン3階層を、MapScene が読める
// ひとつの形にそろえる。
//
// 座標の決まりごと (素材集の grid_v2/GRID_SPEC.md):
//   1マス = 64x64px。矩形は [x, y, width, height] のマス単位。原点は左上。
//   人物は足元1マスの当たり判定で、絵は下中央そろえ(最大96x112px)。
//
// マップの絵は「床も建物も家具も焼き込み済みの1枚絵」なので、
// ここで持つのは当たり判定と、踏むと何かが起きるマス(triggers)だけ。
//
// 通行判定の作り方が2種類あるのは素材のJSONがそうなっているから:
//   町・内装 -> collisions(通れない矩形)の列挙。それ以外は通れる。
//   ダンジョン -> walkable_tiles(通れるマスのホワイトリスト)。載っていなければ壁。

import townLayout from '../data/maps/town.json';
import homeLayout from '../data/maps/interior_home.json';
import churchLayout from '../data/maps/interior_church.json';
import shopLayout from '../data/maps/interior_item_shop.json';
import ranchLayout from '../data/maps/interior_ranch.json';
import breedingLayout from '../data/maps/interior_breeding.json';
import floor01 from '../data/maps/floor_01.json';
import floor02 from '../data/maps/floor_02.json';
import floor03 from '../data/maps/floor_03.json';
import { ITEM_BY_ID } from '../engine/items.js';

export const TILE = 64;

/** 人物の歩行スプライトシート。1枚に8コマ、コマは96x112。 */
export const CHAR_FRAME = { width: 96, height: 112 };
export const CHAR_SHEETS = {
  hero: '/assets/field/chars/hero.png',
  priestess: '/assets/field/chars/priestess.png',
  shopkeeper: '/assets/field/chars/shopkeeper.png',
  storekeeper: '/assets/field/chars/storekeeper.png',
  rancher: '/assets/field/chars/rancher.png',
  fusionmaster: '/assets/field/chars/fusionmaster.png',
};

// 町をうろつく住人。素材集の characters_townsfolk_01..03 の12人(1人=1行)。
// 主人公と同じ8コマ構成なので、歩かせ方も同じで済む。
for (let i = 1; i <= 12; i += 1) {
  CHAR_SHEETS[`townsfolk_${i}`] = `/assets/field/chars/townsfolk_${i}.png`;
}

/** コマの並び: 正面A,正面B,背面A,背面B,左A,左B,右A,右B */
export const DIR_FRAME = { down: 0, up: 2, left: 4, right: 6 };

/**
 * マップに置く「物」の絵。人物と違って1枚絵で、下中央そろえで置く。
 * 宝箱は閉/開で大きさが変わらないように書き出してある
 * (monster_project/build_field_assets.py が2枚の外接矩形の和で切っている)。
 *
 * 階段も置きものにした。もとはフロアの絵に 2x2マス(128px)で焼き込まれていて、
 * 宝箱・どうぐ・人物が全部64pxグリッドに乗っているなかで階段だけ倍の大きさだった。
 * build_field_assets.py が絵から消して 64px のスプライトを書き出すので、
 * ここで1マスに置き直す。焼き込みでなくなったので「1階の上り階段だけ出さない」
 * (= ダンジョンの入口から引き返せない) も素直に書ける。
 */
export const OBJECT_IMAGES = {
  chestClosed: '/assets/field/objects/chest_closed.png',
  chestOpen: '/assets/field/objects/chest_open.png',
  stairsUp: '/assets/field/objects/stairs_up.png',
  stairsDown: '/assets/field/objects/stairs_down.png',
};

const FLOOR_LAYOUTS = [floor01, floor02, floor03];
const FLOOR_IMAGES = ['/assets/field/floor_01.png', '/assets/field/floor_02.png', '/assets/field/floor_03.png'];

// --------------------------------------------------------------- 通行判定

/** cols x rows の通行フラグ。1 = 通れない。 */
function emptyGrid(cols, rows) {
  return { cols, rows, cells: new Uint8Array(cols * rows) };
}

function blockRect(grid, [x, y, w, h]) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < grid.cols && yy < grid.rows) grid.cells[yy * grid.cols + xx] = 1;
    }
  }
}

function openTile(grid, x, y) {
  if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) grid.cells[y * grid.cols + x] = 0;
}

const key = (x, y) => `${x},${y}`;

/**
 * 共通のマップ定義を組み立てる。
 * @returns {{id,label,imageUrl,cols,rows,grid,npcs,triggers,tint,bgColor}}
 */
function makeMap({
  id, label, imageUrl, cols, rows, grid,
  npcs = [], wanderers = [], objects = [], triggers = {}, tint = null, bgColor = 0x0d1016,
}) {
  return {
    id, label, imageUrl, cols, rows, grid, npcs, wanderers, objects, triggers, tint, bgColor,
    isBlocked(x, y) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
      return grid.cells[y * cols + x] === 1;
    },
    triggerAt(x, y) {
      return triggers[key(x, y)] || null;
    },
  };
}

// ------------------------------------------------------------------- 町

/**
 * 町から外へ出る道は南の石畳(x=14..17, y=23)。看板が立っているのもここ。
 * 「町の南の道を出る = ダンジョンへ旅立つ」という素直な作りにしてある。
 */
const TOWN_GATE_TILES = [[14, 23], [15, 23], [16, 23], [17, 23]];

/** 内装の入口。町側の扉マスと、そこから出てきたときに立つマス。 */
export const TOWN_DOORS = {
  home: { interior: 'home', label: 'あずけ所' },
  church: { interior: 'church', label: '教会' },
  item_shop: { interior: 'item_shop', label: 'どうぐ屋' },
  ranch: { interior: 'ranch', label: 'モンスター牧場' },
  breeding: { interior: 'breeding', label: '配合施設' },
};

/**
 * 町をうろつく住人。tile が持ち場、radius がそこから離れてよいマス数。
 * 広場と南北の道ぞいに散らして、どこを歩いても誰かが視界に入るようにした。
 * 建物や崖のマスは MapScene 側が弾くので、ここは「持ち場」を決めるだけでよい。
 *
 * 主人公とは当たり判定を持たない(すり抜ける)ので、住人が道をふさいで
 * 進めなくなることは起こらない。扉・階段のマスには乗らないようにもしてある。
 */
const TOWN_WANDERERS = [
  { sheet: 'townsfolk_7', tile: [10, 13], radius: 2 },  // 吟遊詩人 (広場の南西)
  { sheet: 'townsfolk_9', tile: [21, 10], radius: 2 },  // 赤いドレスの女性 (広場の東)
  { sheet: 'townsfolk_8', tile: [26, 12], radius: 2 },  // 鍛冶屋 (東の空き地)
  // 子供は scale で背丈を落とす。素材は全員112pxに揃っているので、
  // そのままだと子供が大人と同じ大きさに見えてしまう。
  { sheet: 'townsfolk_3', tile: [5, 12], radius: 2, scale: 0.72 },  // 黄色い服の子供 (西の空き地)
  { sheet: 'townsfolk_12', tile: [16, 15], radius: 2 }, // 料理人 (南の道)
  { sheet: 'townsfolk_4', tile: [12, 18], radius: 2 },  // 青い帽子 (南西の草地)
  { sheet: 'townsfolk_6', tile: [21, 18], radius: 2 },  // 釣り人 (南東の草地)
];

export function buildTownMap() {
  const [cols, rows] = townLayout.map_tiles;
  const grid = emptyGrid(cols, rows);
  townLayout.collisions.forEach((c) => blockRect(grid, c.rect_tiles));

  const triggers = {};
  Object.entries(townLayout.doors).forEach(([doorId, [x, y]]) => {
    const door = TOWN_DOORS[doorId];
    if (!door) return;
    // 扉のマスは建物の当たり判定の内側にある。ここだけは踏ませて、
    // 踏んだ瞬間に内装へ切り替える。
    openTile(grid, x, y);
    triggers[key(x, y)] = { type: 'door', interior: door.interior, label: door.label, doorId };
  });
  TOWN_GATE_TILES.forEach(([x, y]) => {
    triggers[key(x, y)] = { type: 'townGate' };
  });

  return makeMap({
    id: 'town',
    label: 'まち',
    imageUrl: '/assets/field/town.png',
    cols, rows, grid, triggers,
    wanderers: TOWN_WANDERERS,
    bgColor: 0x2e5b2a,
  });
}

/** 町のはじめの立ち位置(広場の中央)。 */
export const TOWN_SPAWN = { x: 16, y: 12, facing: 'down' };

/** 内装から町へ出たときに立つマス = 扉の1マス下。 */
export function townSpawnForDoor(doorId) {
  const d = townLayout.doors[doorId];
  if (!d) return TOWN_SPAWN;
  return { x: d[0], y: d[1] + 1, facing: 'down' };
}

/** 町へ帰るときの立ち位置。南の門から帰ってきた場合は門の1マス上。 */
export const TOWN_GATE_SPAWN = { x: 16, y: 22, facing: 'up' };

// ---------------------------------------------------------------- 内装

// 内装はすべて 16x12マス。木の壁が外周1マスぶん(col1/col14, row1/row10)を
// 占めていて、床は x=2..13, y=2..9。扉は下の壁にあいた [7,10] と [8,10]。
const INTERIOR_FLOOR = { x0: 2, y0: 2, x1: 13, y1: 9 };

const INTERIORS = {
  home: {
    layout: homeLayout,
    label: 'あずけ所',
    image: '/assets/field/interior_home.png',
    doorId: 'home',
    // 主人公の家。専用の建物素材が無いので、預け屋はここに間借りしている。
    npc: { id: 'storekeeper', sheet: 'storekeeper', name: '預け屋', tile: [10, 3], facing: 'down' },
    screen: 'storage',
    actionLabel: 'あずけ所を みる',
    line: '「モンスターを あずかるよ。……と 言いたいところだが、まだ 準備中でね。」',
  },
  church: {
    layout: churchLayout,
    label: '教会',
    image: '/assets/field/interior_church.png',
    doorId: 'church',
    // 女僧侶は祭壇の前に **内装の絵として** 描き込まれている。
    // 絵の彼女はろうそくと祭壇に重なっていて、消すと祭壇まで消えてしまう
    // (素材集に同じ祭壇の単体絵が無く、描き足すことになる)。
    // かわりに「絵の彼女」をそのまま話しかけられる人にした。
    // こうすれば同じ姿の人が2人にならず、すり抜けもしなくなる。
    paintedNpc: { id: 'priestess', name: '女僧侶', tile: [7, 4] },
    screen: 'church',
    actionLabel: '話を きく',
    line: '「おかえりなさい。傷を いやすのは 入口の司祭が やっていますよ。」',
  },
  item_shop: {
    layout: shopLayout,
    label: 'どうぐ屋',
    image: '/assets/field/interior_item_shop.png',
    doorId: 'item_shop',
    npc: { id: 'shopkeeper', sheet: 'shopkeeper', name: '道具屋', tile: [7, 3], facing: 'down' },
    screen: 'shop',
    actionLabel: '見せてもらう',
    line: '「いらっしゃい！ ……売り買いは まだ できないんだ。すまないね。」',
  },
  ranch: {
    layout: ranchLayout,
    label: 'モンスター牧場',
    image: '/assets/field/interior_ranch.png',
    doorId: 'ranch',
    npc: { id: 'rancher', sheet: 'rancher', name: '牧場主', tile: [4, 3], facing: 'down' },
    screen: 'ranch',
    actionLabel: 'モンスターを 見る',
    line: '「うちの子たちに 会っていくかい？ パーティーの 入れかえも ここでどうぞ。」',
  },
  breeding: {
    layout: breedingLayout,
    label: '配合施設',
    image: '/assets/field/interior_breeding.png',
    doorId: 'breeding',
    npc: { id: 'fusionmaster', sheet: 'fusionmaster', name: '配合マスター', tile: [11, 3], facing: 'down' },
    screen: 'fusion',
    actionLabel: '配合する',
    line: '「2体の 血を まぜてみるか。……覚悟は いいな。」',
  },
};

export const INTERIOR_IDS = Object.keys(INTERIORS);

export function interiorInfo(id) {
  return INTERIORS[id] || null;
}

export function buildInteriorMap(id) {
  const def = INTERIORS[id];
  if (!def) return null;
  const [cols, rows] = def.layout.room_tiles;
  const grid = emptyGrid(cols, rows);

  // まず全部を壁にして、床の範囲だけ開ける(外周の木の壁を表現する)。
  grid.cells.fill(1);
  for (let y = INTERIOR_FLOOR.y0; y <= INTERIOR_FLOOR.y1; y += 1) {
    for (let x = INTERIOR_FLOOR.x0; x <= INTERIOR_FLOOR.x1; x += 1) openTile(grid, x, y);
  }
  def.layout.collisions.forEach((c) => blockRect(grid, c.rect_tiles));
  // 配合施設の魔法陣は collisions に入っていないが、乗られると絵が壊れる。
  if (def.layout.reserved_device_rect_tiles) blockRect(grid, def.layout.reserved_device_rect_tiles);

  const triggers = {};
  def.layout.door_tiles.forEach(([x, y]) => {
    openTile(grid, x, y);
    triggers[key(x, y)] = { type: 'exitInterior', doorId: def.doorId };
  });

  // NPC は2種類ある。
  //   npc        … スプライトを置いて描く人
  //   paintedNpc … 内装の絵に描き込まれている人。絵はそのまま、当たり判定と
  //                「話しかけられる」ことだけを足す(スプライトは描かない)。
  const npcs = [];
  if (def.npc) npcs.push(def.npc);
  if (def.paintedNpc) npcs.push({ ...def.paintedNpc, painted: true });
  npcs.forEach((n) => blockRect(grid, [n.tile[0], n.tile[1], 1, 1]));

  return makeMap({
    id: `interior:${id}`,
    label: def.label,
    imageUrl: def.image,
    cols, rows, grid, npcs, triggers,
    bgColor: 0x090a0d,
  });
}

/** 内装に入ったときの立ち位置 = 扉の1マス上(部屋の内側)。 */
export function interiorSpawn(id) {
  const def = INTERIORS[id];
  const [x, y] = def.layout.door_tiles[0];
  return { x, y: y - 1, facing: 'up' };
}

// ------------------------------------------------------------ ダンジョン

/**
 * ダンジョンごとの色味。フロアの絵は3枚しかないので12本で使い回す。
 * 戦闘背景と同じ区分で色を変え、「同じ穴を歩かされている」感じを薄める。
 */
export const DUNGEON_TINT = {
  grassland: 0xa8d59a,
  cave: 0x9fb6d8,
  ancient_ruins: 0xc4a8e0,
  snow_mountain: 0xcfe4f5,
  lava_cavern: 0xe89a7a,
};

export function floorLayout(floorIndex) {
  return FLOOR_LAYOUTS[floorIndex % FLOOR_LAYOUTS.length];
}

// -------------------------------------------------------- フロアの置きもの

/**
 * フロアの絵に描かれている置きものを調べたときの一言。
 * キーは各フロアJSONの collisions[].name。
 *
 * 「調べても何も起きない」は、遊ぶ側からは 反応しない = 壊れている に見える。
 * 動かせない物にも一言返させて、「これは ただの飾りだ」と分かるようにする。
 * (1階の大扉だけは 開きそうにしか見えないので、絵ごと消してある。
 *  build_field_assets.py の ERASE / STRIP_COLLISIONS を参照)
 */
const PROP_LINES = {
  iron_gate: '鉄の柵だ。太い くさりで 床に とめられていて、びくともしない。',
  pillar_a: '古い石柱。天井を ささえている。',
  pillar_b: '古い石柱。天井を ささえている。',
  spikes: '床から とげが 突き出ている。うっかり 乗らないように しよう。',
  ancient_altar: '古い祭壇。ろうそくの火が なぜか まだ 消えていない。',
  rune_pedestal: '文字の ほられた 台座。何と 書いてあるのかは 分からない。',
  blue_crystal: '青い水晶。ひんやりと 光っている。',
  red_crystal: '赤い水晶。さわると ほんのり あたたかい。',
};

// ------------------------------------------------------------ 宝箱の置き場所

/**
 * 各フロア図の「宝箱を置いてよいマス」。フロアの絵は3枚しかないので、
 * ここも3枚ぶんだけ持てばよい(floorIndex % 3 でフロア図を選ぶのと同じ)。
 *
 * 置く場所は手で選んである。条件は2つ:
 *   1. 通れるマス(walkable_tiles に載っている)であること。
 *      宝箱のマスは **通れなくする** ので、元から壁のマスに置くと
 *      「壁の中の宝箱」になって、どこからも開けられない。
 *   2. 部屋のすみ・行き止まりであること。
 *      通路のまん中を塞ぐと、運が悪いと先へ進めなくなる。
 * 念のため下の pickChests が「階段どうしが行き来できるか」を必ず確かめ、
 * ふさいでしまう位置は捨てる。
 */
const FLOOR_CHEST_SPOTS = [
  // floor_01: 北西の部屋のすみ / 大扉を消した跡の北東の部屋 / 中央 / 南の広間の両すみ
  [[2, 2], [8, 5], [17, 2], [5, 10], [17, 10]],
  // floor_02: 西の小部屋 / 2本の柱にはさまれた奥 / 北東のすみ / 南のすみ
  [[2, 2], [5, 2], [8, 3], [17, 2], [2, 10], [13, 10]],
  // floor_03: 祭壇わきの左右 / 東西の広間のすみ / 南の小部屋
  [[7, 2], [11, 2], [2, 4], [17, 4], [7, 11], [12, 11]],
];

/** 1フロアに置く宝箱の数。 */
const CHESTS_PER_FLOOR = 2;

// ---------------------------------------------------------- 床に落ちどうぐ
//
// 「床に薬草が落ちてたりするのもいいかも」(博史さん) の実装。
// 宝箱との差はここではっきりつけてある:
//
//            置き場所        取り方              中身
//   宝箱     すみ・行き止まり  となりに立って調べる  大金 / 上位のどうぐ / からっぽ
//   落ちどうぐ 通れるマスどこでも 踏むだけ           安い消耗品を1コ
//
// 落ちどうぐのマスは **通れるまま** にする。通れなくすると、拾えないうえに
// 道をふさぐ。踏んで拾うので、そもそも通れないと拾えない。

/** 1フロアに落ちている数。 */
const FLOOR_ITEMS_PER_FLOOR = 3;

/** 落ちどうぐ同士をこのマス数(マンハッタン距離)より近づけない。 */
const FLOOR_ITEM_MIN_GAP = 5;

/**
 * 床に落ちている安物。推奨レベルの帯で品ぞろえが変わる。
 * (itemId, 重み) の並び。個数はいつも1コ — 「落ちている」のは1本の薬草であって、
 * 3本たばねて置いてあるわけではない。
 *
 * ここに載せた品は宝箱には入れない(monster_project/build_dungeons.py の
 * FLOOR_LITTER が、宝箱の表に混ざっていないか検証している)。
 */
const FLOOR_ITEM_BANDS = [
  // [推奨レベルの上限, [[itemId, 重み], ...]]
  [4, [['item_yakusou', 5], ['item_dokukeshisou', 2], ['item_mahounomizu', 2]]],
  [12, [['item_yakusou', 4], ['item_mahounomizu', 3], ['item_dokukeshisou', 2]]],
  [24, [['item_yakusou', 3], ['item_mahounomizu', 3], ['item_dokukeshisou', 2]]],
  [Infinity, [['item_mahounomizu', 3], ['item_yakusou', 3], ['item_dokukeshisou', 1]]],
];

/** 重みを展開した「くじの束」。中身は itemId の配列。 */
function floorItemPool(dungeon) {
  const rec = dungeon.recommendedLevel || 1;
  const band = FLOOR_ITEM_BANDS.find(([max]) => rec <= max) || FLOOR_ITEM_BANDS[FLOOR_ITEM_BANDS.length - 1];
  const pool = [];
  band[1].forEach(([itemId, weight]) => {
    // 絵の無いどうぐは床に置かない。床のどうぐは絵で「そこに何かある」と
    // 気づかせるものなので、絵が無いと拾えるものだと分からない。
    const item = ITEM_BY_ID[itemId];
    if (!item || !item.icon) return;
    for (let i = 0; i < weight; i += 1) pool.push(itemId);
  });
  return pool;
}

/** 文字列 -> 32bit の整数 (FNV-1a)。ダンジョン+階から同じ配置を作るために使う。 */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** hash32 を種にした線形合同法。Math.random と違って毎回同じ順番が出る。 */
function seededShuffle(list, seed) {
  const out = list.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** grid 上で (sx,sy) から (tx,ty) へ歩いて行けるか(幅優先)。 */
function reachable(grid, cols, rows, [sx, sy], [tx, ty]) {
  if (sx === tx && sy === ty) return true;
  const seen = new Uint8Array(cols * rows);
  const queue = [sy * cols + sx];
  seen[sy * cols + sx] = 1;
  const goal = ty * cols + tx;
  while (queue.length > 0) {
    const cur = queue.pop();
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (let d = 0; d < 4; d += 1) {
      const nx = cx + [0, 0, -1, 1][d];
      const ny = cy + [-1, 1, 0, 0][d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (seen[idx] || grid.cells[idx] === 1) continue;
      if (idx === goal) return true;
      seen[idx] = 1;
      queue.push(idx);
    }
  }
  return false;
}

/**
 * このダンジョンのこの階に置く宝箱を決める。
 * ダンジョンidと階から決めるので、同じ階へ戻ってきても場所は変わらない。
 * (走行のたびに動くと「さっき開けた宝箱」が別の場所に現れてしまう)
 */
function pickChests(dungeon, floorIndex, layout, grid, cols, rows) {
  const spots = FLOOR_CHEST_SPOTS[floorIndex % FLOOR_CHEST_SPOTS.length] || [];
  const walkable = new Set(layout.walkable_tiles.map(([x, y]) => key(x, y)));
  const usable = spots.filter(([x, y]) => walkable.has(key(x, y)) && !grid.cells[y * cols + x]);
  const order = seededShuffle(usable, hash32(`${dungeon.id}#${floorIndex}`));

  const chosen = [];
  for (let i = 0; i < order.length && chosen.length < CHESTS_PER_FLOOR; i += 1) {
    const [x, y] = order[i];
    grid.cells[y * cols + x] = 1; // 宝箱のマスは通れない = となりに立って調べる
    // ふさいだせいで階段どうしが行き来できなくなるなら、この場所はあきらめる。
    if (reachable(grid, cols, rows, layout.stairs.up, layout.stairs.down)) {
      chosen.push({ id: `${dungeon.id}:${floorIndex}:${x},${y}`, kind: 'chest', tile: [x, y] });
    } else {
      grid.cells[y * cols + x] = 0;
    }
  }
  return chosen;
}

/**
 * このフロアに落ちている どうぐ を決める。
 * 宝箱と同じで、ダンジョンidと階から決まる(同じ階へ戻っても場所は変わらない)。
 *
 * 宝箱と違って通れるマスを塞がないので、道が絶たれることは原理的に無い。
 * それでも宝箱と同じ到達性の確認はしておく。walkable_tiles に載っていても
 * 柱の裏の1マスのように「どこからも行けない床」がありえて、
 * そこに置くと永久に拾えないアイコンが1つ画面に残ってしまう。
 *
 * @param triggers 既に埋まっているマス(階段・置きもの・宝箱)。ここには置かない。
 * @param reserved 階段のマス。1階の上り階段は trigger を持たない(出口を廃止した)
 *   ので triggers だけでは弾けない。主人公の出現マスでもあるため、
 *   ここに落とすと拾えないどうぐが足元に残る。
 */
function pickFloorItems(dungeon, floorIndex, layout, grid, cols, rows, triggers, reserved) {
  const pool = floorItemPool(dungeon);
  if (pool.length === 0) return [];
  const usable = layout.walkable_tiles.filter(
    ([x, y]) => !grid.cells[y * cols + x] && !triggers[key(x, y)] && !reserved.has(key(x, y)),
  );
  const order = seededShuffle(usable, hash32(`${dungeon.id}#${floorIndex}#floorItems`));

  const chosen = [];
  for (let i = 0; i < order.length && chosen.length < FLOOR_ITEMS_PER_FLOOR; i += 1) {
    const [x, y] = order[i];
    // かたまって落ちていると「落ちている」より「置いてある」に見える。
    const tooClose = chosen.some(
      (c) => Math.abs(c.tile[0] - x) + Math.abs(c.tile[1] - y) < FLOOR_ITEM_MIN_GAP,
    );
    if (tooClose) continue;
    if (!reachable(grid, cols, rows, layout.stairs.up, [x, y])) continue;
    const itemId = pool[hash32(`${dungeon.id}#${floorIndex}#${x},${y}`) % pool.length];
    chosen.push({
      id: `${dungeon.id}:${floorIndex}:item:${x},${y}`,
      kind: 'floorItem',
      tile: [x, y],
      itemId,
      iconUrl: ITEM_BY_ID[itemId]?.icon || null,
    });
  }
  return chosen;
}

/**
 * ダンジョンの1フロア。
 * @param dungeon dungeons.json の1本 (floors / background を使う)
 * @param floorIndex 0始まり
 * @param openedChests 開けおわった宝箱のid (engine/dungeonRun.js が持つ)
 * @param pickedItems 拾いおわった床のどうぐのid (同上)
 */
export function buildDungeonFloorMap(dungeon, floorIndex, openedChests = null, pickedItems = null) {
  const layout = floorLayout(floorIndex);
  const [cols, rows] = layout.map_tiles;
  const grid = emptyGrid(cols, rows);

  // ダンジョンは「通れるマスのホワイトリスト」。載っていないマスは全部壁。
  grid.cells.fill(1);
  layout.walkable_tiles.forEach(([x, y]) => openTile(grid, x, y));
  (layout.collisions || []).forEach((c) => blockRect(grid, c.rect_tiles));

  const floors = dungeon.floors || 1;
  const isLast = floorIndex >= floors - 1;
  const triggers = {};
  const [ux, uy] = layout.stairs.up;
  const [dx, dy] = layout.stairs.down;
  openTile(grid, ux, uy);
  openTile(grid, dx, dy);
  // 1階(=入口)の上り階段は置かない。
  //
  // 「階段を上がる = ダンジョンを出る」は、入口に立つたびに
  // 「でますか？」と聞かれるだけの導線で、しかも入口は必ず通る場所なので
  // うっとうしい。引き返す手段は キメラのつばさ に一本化した
  // (歩いている途中でも使える — App.jsx の useFieldItem)。
  // 階のあいだの上り/下りはそのまま残る。
  const hasUpStairs = floorIndex > 0;
  if (hasUpStairs) triggers[key(ux, uy)] = { type: 'stairsUp' };
  triggers[key(dx, dy)] = isLast
    ? { type: 'bossGate' }
    : { type: 'stairsDown' };

  // 置きもの(柵・柱・祭壇など)を調べたときの一言。階段のマスは上書きしない。
  (layout.collisions || []).forEach((c) => {
    const text = PROP_LINES[c.name];
    if (!text) return;
    const [px, py, pw, ph] = c.rect_tiles;
    for (let yy = py; yy < py + ph; yy += 1) {
      for (let xx = px; xx < px + pw; xx += 1) {
        if (!triggers[key(xx, yy)]) triggers[key(xx, yy)] = { type: 'look', text };
      }
    }
  });

  // 宝箱。マスごと通れなくして、**四方どちらからでも**調べられるようにする
  // (正面のマスを見る tryInteract がそのまま効く)。
  const chests = pickChests(dungeon, floorIndex, layout, grid, cols, rows);
  chests.forEach((chest) => {
    chest.opened = !!(openedChests && openedChests[chest.id]);
    triggers[key(chest.tile[0], chest.tile[1])] = { type: 'chest', id: chest.id };
  });

  // 床に落ちているどうぐ。宝箱を置いたあとに置く(宝箱のマスは triggers に
  // 入っているので、そこは候補から自然に外れる)。マスは通れるままにする。
  const stairTiles = new Set([key(ux, uy), key(dx, dy)]);
  const floorItems = pickFloorItems(dungeon, floorIndex, layout, grid, cols, rows, triggers, stairTiles);
  floorItems.forEach((it) => {
    it.taken = !!(pickedItems && pickedItems[it.id]);
    triggers[key(it.tile[0], it.tile[1])] = { type: 'floorItem', id: it.id };
  });

  // 階段。マスは通れるまま(踏んで使う)。宝箱と違ってマスを塞ぐと乗れない。
  const stairs = [];
  if (hasUpStairs) {
    stairs.push({ id: `${dungeon.id}:${floorIndex}:stairsUp`, kind: 'stairs', dir: 'up', tile: [ux, uy] });
  }
  stairs.push({ id: `${dungeon.id}:${floorIndex}:stairsDown`, kind: 'stairs', dir: 'down', tile: [dx, dy] });

  const objects = [...stairs, ...chests, ...floorItems];

  return makeMap({
    id: `dungeon:${dungeon.id}:${floorIndex}`,
    label: `${dungeon.name}　地下${floorIndex + 1}階`,
    imageUrl: FLOOR_IMAGES[floorIndex % FLOOR_IMAGES.length],
    cols, rows, grid, triggers, objects,
    tint: DUNGEON_TINT[dungeon.background] || null,
    bgColor: 0x07080c,
  });
}

/** フロアに入ったときの立ち位置。descending=下りてきた / ascending=上がってきた。 */
export function dungeonFloorSpawn(floorIndex, from) {
  const layout = floorLayout(floorIndex);
  if (from === 'below') {
    const [x, y] = layout.stairs.down;
    return { x, y, facing: 'up' };
  }
  const [x, y] = layout.stairs.up;
  return { x, y, facing: 'down' };
}
