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
import grassland01 from '../data/maps/grassland_01.json';
import grassland02 from '../data/maps/grassland_02.json';
import grassland03 from '../data/maps/grassland_03.json';
import cave01 from '../data/maps/cave_01.json';
import cave02 from '../data/maps/cave_02.json';
import cave03 from '../data/maps/cave_03.json';
import ruins01 from '../data/maps/ruins_01.json';
import ruins02 from '../data/maps/ruins_02.json';
import ruins03 from '../data/maps/ruins_03.json';
import snow01 from '../data/maps/snow_01.json';
import snow02 from '../data/maps/snow_02.json';
import snow03 from '../data/maps/snow_03.json';
import lava01 from '../data/maps/lava_01.json';
import lava02 from '../data/maps/lava_02.json';
import lava03 from '../data/maps/lava_03.json';
import bossGrassland from '../data/maps/boss_grassland.json';
import bossCave from '../data/maps/boss_cave.json';
import bossRuins from '../data/maps/boss_ruins.json';
import bossSnow from '../data/maps/boss_snow.json';
import bossLava from '../data/maps/boss_lava.json';
import snowTownLayout from '../data/maps/snow_town.json';
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

/**
 * あとから届いた住人5人(子供3・老人2)。
 *
 * 12人ぶんとの違いは **背丈が描き分けてあること**。既存の12人は素材集の絵を
 * 1人ずつコマいっぱい(112px)へ引き伸ばして作ったので、子供(townsfolk_3)まで
 * 大人と同じ背丈になり、下の TOWN_WANDERERS で scale 0.72 をかけて
 * 縮め直していた。
 *
 * この5人は **描いた時点で背丈が違う**(実測: 子供 80px / 老人 98px /
 * 大人 112px)。build_field_assets.py は足元をコマの下辺にそろえるだけで、
 * 拡大縮小を一切しない。だから scale は 1 のままで、
 * 子供は大人の 71%(= townsfolk_3 の 0.72 とほぼ同じ)に見える。
 * ここでさらに 0.72 をかけると、大人の半分の背丈になってしまう。
 */
const RESIDENT_SHEETS = [
  'npc_child_boy', 'npc_child_girl', 'npc_child_explorer',
  'npc_elderly_man', 'npc_elderly_woman',
];
RESIDENT_SHEETS.forEach((name) => {
  CHAR_SHEETS[name] = `/assets/field/chars/${name}.png`;
});

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

/** ダンジョンに散らす置きもの12種の絵。1マス(64px)に収まるよう書き出してある。 */
export const PROP_IMAGE = (name) => `/assets/field/objects/${name}.png`;

// フロア図の実体は下の FLOOR_SETS (ダンジョンの background ごとに1組)。

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
  // ボス部屋だけが持つ。MapScene が「ここへ近づいたら戦闘」を見るのに使う。
  bossTile = null,
}) {
  return {
    id, label, imageUrl, cols, rows, grid, npcs, wanderers, objects, triggers, tint, bgColor,
    bossTile,
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

/**
 * 内装の入口。町側の扉マスと、そこから出てきたときに立つマス。
 *
 * tiles … **踏むと中に入るマス**。建物の当たり判定の内側にあるものを開けて使う。
 *   先頭が「その扉の代表のマス」で、外へ出てきたときはその1マス下に立つ
 *   (townSpawnForDoor)。
 *
 * 素材の町の絵は 64px の格子に合わせて描かれていない。建物は自由に置かれていて、
 * **扉の多くはマスの境目をまたいでいる**(実測):
 *
 *   あずけ所   扉 x5.55〜6.33 (境目 5/6 の上)   石段 x5.24〜6.44
 *   教会       扉 x15.27〜16.23 (境目 15/16)    石段 x15.11〜16.44
 *   どうぐ屋   扉 x26.63〜27.57 (境目 26/27)    足ふき x26.40〜27.36
 *   牧場       戸口 x5.18〜6.22 (境目 5/6)      ※白い扉の間の開口部
 *   配合施設   扉 x25.06〜25.95 (マス25の中)    石段 x24.4〜26.5
 *
 * レイアウトJSONの doors は1扉1マスしか持てないので、またいでいる扉では
 * 必ず半分が外れる(牧場は開口部から2マス右の柵の上に、どうぐ屋は扉の左の
 * 壁ぎわに乗っていた)。「見えている扉に立ったのに入れない」を無くすため、
 * **またいでいる扉は2マスとも入口にする**。どちらから近づいても入れる。
 *
 * 縦は5棟とも建物の当たり判定の最下段 = 扉の真下の敷居。
 * (牧場だけは前庭が柵で囲まれていて、絵の中に外から入れる隙間が無い。
 *  柵の段が外から届く唯一の敷居なので、そこを戸口の正面にそろえた)
 */
export const TOWN_DOORS = {
  home: { interior: 'home', label: 'あずけ所', tiles: [[5, 8], [6, 8]] },
  church: { interior: 'church', label: '教会', tiles: [[15, 8], [16, 8]] },
  item_shop: { interior: 'item_shop', label: 'どうぐ屋', tiles: [[27, 8], [26, 8]] },
  ranch: { interior: 'ranch', label: 'モンスター牧場', tiles: [[5, 20], [6, 20]] },
  // 配合施設の扉だけはマス25の中にきれいに収まっている。広げる必要がない。
  breeding: { interior: 'breeding', label: '配合施設', tiles: [[25, 20]] },
};

/**
 * その扉の入口マス。TOWN_DOORS に書いていなければレイアウトJSONの値を使う
 * (素材が描き直されて扉の位置が変わったときの受け皿)。
 */
function doorTiles(doorId) {
  const def = TOWN_DOORS[doorId];
  if (def && def.tiles) return def.tiles;
  const t = townLayout.doors[doorId];
  return t ? [t] : [];
}

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

  // --- あとから届いた5人 ---------------------------------------------
  // 子供は広場のまわりで走り回り、老人は道ばたでゆっくり歩く。
  // scale は付けない(素材の時点で背丈が描き分けてある。上の
  // RESIDENT_SHEETS のコメントを参照)。
  //
  // 子供は radius を広げて動きも速くした。走り回るから子供に見えるので、
  // 大人と同じ歩幅・同じ範囲だと「小さい大人」にしかならない。
  { sheet: 'npc_child_boy', tile: [13, 11], radius: 3, stepMs: 230, pauseMax: 1200 },
  { sheet: 'npc_child_girl', tile: [19, 13], radius: 3, stepMs: 230, pauseMax: 1200 },
  { sheet: 'npc_child_explorer', tile: [8, 13], radius: 3, stepMs: 230, pauseMax: 1200 },
  // 老人は主人公の半分ほどの速さで、持ち場からあまり離れない。
  { sheet: 'npc_elderly_man', tile: [24, 13], radius: 1, stepMs: 620, pauseMin: 1400, pauseMax: 3200 },
  { sheet: 'npc_elderly_woman', tile: [11, 9], radius: 1, stepMs: 620, pauseMin: 1400, pauseMax: 3200 },
];

export function buildTownMap() {
  const [cols, rows] = townLayout.map_tiles;
  const grid = emptyGrid(cols, rows);
  townLayout.collisions.forEach((c) => blockRect(grid, c.rect_tiles));

  const triggers = {};
  Object.keys(townLayout.doors).forEach((doorId) => {
    const door = TOWN_DOORS[doorId];
    if (!door) return;
    // 扉のマスは建物の当たり判定の内側にある。ここだけは踏ませて、
    // 踏んだ瞬間に内装へ切り替える。またいでいる扉は2マスとも開ける。
    doorTiles(doorId).forEach(([x, y]) => {
      openTile(grid, x, y);
      triggers[key(x, y)] = { type: 'door', interior: door.interior, label: door.label, doorId };
    });
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

/**
 * 内装から町へ出たときに立つマス = 扉の1マス下。
 * 2マスの扉では **代表のマス**(tiles の先頭 = 絵の扉の中心にいちばん近いほう)
 * の下に出す。5棟とも下の段は石畳か草地で、必ず歩ける。
 */
export function townSpawnForDoor(doorId) {
  const [d] = doorTiles(doorId);
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
    line: '「モンスターを あずかる商売を していたんだがね。牧場が 何体でも 引き受けるように なってから、すっかり ひまだよ。」',
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
    actionLabel: '買い物する',
    line: '「いらっしゃい！ 旅のどうぐなら ひととおり そろえてあるよ。いらないものは 買い取るからね。」',
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
 * ダンジョンごとの色味。**使い回しのフロア図にだけ** かける。
 * もとは洞窟のフロア図3枚を12本のダンジョンで共有していたので、戦闘背景と同じ
 * 区分で色を変えて「同じ穴を歩かされている」感じを薄めていた。
 *
 * いまは5つの biome すべてに専用の絵があるので、実際に色をかける相手は
 * 「background がこの5つのどれでもないダンジョン」だけ = 予備の受け皿
 * (下の FLOOR_SETS.fallback)。専用の絵にかけると描いてもらった色が濁る。
 */
export const DUNGEON_TINT = {
  cave: 0x9fb6d8,
  ancient_ruins: 0xc4a8e0,
  snow_mountain: 0xcfe4f5,
  lava_cavern: 0xe89a7a,
};

/**
 * 宝箱の置き場所について。
 *
 * **手書きの置き場所の表は もう持っていない。**
 *
 * かつて5つの biome は同じ 30x20 のレイアウトに絵だけを塗り替えたもので、
 * walkable_tiles も階段も1マスたがわず同じだった。だから「b1はここ、b2はここ」
 * と座標を書き並べた表を1つ持てば5地形ぶん足りた。
 *
 * 作り直しの納品で **地形ごとに迷路そのものが変わった**(通れるマス数だけ見ても
 * 溶岩b1の247から遺跡の436まで開きがある)。表はその場で嘘になり、書き直しても
 * 次にフロア図が描き直されたらまた嘘になる。座標を手で持つのをやめて、
 * レイアウトから **導き出す**ようにした(置きもの・落ちどうぐと同じ考え方)。
 *
 * 選び方は下の pickChests。行き止まり・袋小路を優先するので、
 * 「わざわざ寄り道した先に宝箱がある」という置き方は保たれる。
 *
 * 予備の洞窟3枚(fallback)だけは手で選んだ表を残してある。20x14と狭く、
 * 部屋の形もはっきりしていて、人が選んだほうが素直に良い場所になるため。
 */

/** 階段からこのマス数以内には宝箱を置かない(降りた足元に宝箱、を避ける)。 */
const CHEST_STAIRS_CLEARANCE = 3;

/** 宝箱どうしをこのマス数(マンハッタン距離)より近づけない。 */
const CHEST_MIN_GAP = 5;

/**
 * レイアウトから宝箱の置き場所の候補を作る。
 *
 * 「行き止まりほど良い」で並べる。歩ける隣マスが1つしかないマス(袋小路の
 * どんづまり)が最優先、2つ(通路の途中)がその次、3〜4(広間のまん中)は最後。
 * こうすると、宝箱は自然と部屋のすみや行き止まりに寄っていく。
 *
 * 同じ点数のマスどうしは種で混ぜる。種はダンジョンidと階なので、
 * **同じ階に戻ってくれば同じ場所**に出る(潜るたびには動かない)。
 */
function deriveChestSpots(dungeon, floorIndex, layout, grid, cols, rows) {
  const [ux, uy] = layout.stairs.up;
  const [dx, dy] = layout.stairs.down;
  const open = (x, y) => (
    x >= 0 && y >= 0 && x < cols && y < rows && !grid.cells[y * cols + x]
  );
  const nearStairs = (x, y) => (
    (Math.abs(x - ux) <= CHEST_STAIRS_CLEARANCE && Math.abs(y - uy) <= CHEST_STAIRS_CLEARANCE)
    || (Math.abs(x - dx) <= CHEST_STAIRS_CLEARANCE && Math.abs(y - dy) <= CHEST_STAIRS_CLEARANCE)
  );
  const candidates = layout.walkable_tiles.filter(
    ([x, y]) => open(x, y) && !nearStairs(x, y),
  );
  // 種で混ぜてから点数で安定ソートする。こうすると同点の中だけが混ざる。
  const shuffled = seededShuffle(candidates, hash32(`${dungeon.id}#${floorIndex}#chests`));
  const degree = ([x, y]) => (
    (open(x + 1, y) ? 1 : 0) + (open(x - 1, y) ? 1 : 0)
    + (open(x, y + 1) ? 1 : 0) + (open(x, y - 1) ? 1 : 0)
  );
  return shuffled
    .map((t) => [degree(t), t])
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t);
}

/**
 * biome ごとのフロア図一式。
 *
 * ダンジョンは12本、biome は5つ。1本あたり最大3階なので、biome ごとに
 * 3枚1組を持ち、floorIndex % 3 で選ぶ。
 *
 * 1組の中身:
 *   layouts     … 当たり判定と階段の位置 (src/data/maps/*.json)
 *   images      … 1枚絵 (public/assets/field/*.png)
 *   stairsBaked … 階段が絵に描き込まれているか
 *   tinted      … DUNGEON_TINT で色味を変えるか
 *   chestSpots  … 手で選んだ宝箱の置き場所。**省略してよい**。
 *                 省いた組はレイアウトから導き出す (deriveChestSpots)。
 *
 * **寸法は組ごとに違う**。予備の洞窟は 20x14マス、5つの biome は 30x20マス。
 * cols/rows はどこでも layout.map_tiles から読むので、大きさの決め打ちは無い
 * (カメラのクランプ・宝箱・落ちどうぐ・到達性の確認まで全部それに従う)。
 *
 * **5つの biome は迷路そのものが別々**。作り直しの納品(2回目)で地形ごとに
 * 描き起こされた。1回目は「草原のレイアウトに色を塗っただけ」で5地形とも
 * 同一だったので、宝箱の置き場所を1つの表で共有していたが、
 * いまはそれが成り立たない。だから宝箱は表を持たず導き出している。
 */
const FLOOR_SETS = {
  grassland: {
    layouts: [grassland01, grassland02, grassland03],
    images: [
      '/assets/field/grassland_01.png',
      '/assets/field/grassland_02.png',
      '/assets/field/grassland_03.png',
    ],
    // 階段は絵に描き込まれている(石枠の穴)。予備の洞窟と違って地面が草と土の
    // 境目にまたがっていて、きれいに消せる素の地面が近くに無い。
    // 消さずに残し、64pxの階段スプライトは置かない(置くと二重になる)。
    stairsBaked: true,
    tinted: false,
  },
  cave: {
    layouts: [cave01, cave02, cave03],
    images: [
      '/assets/field/cave_01.png',
      '/assets/field/cave_02.png',
      '/assets/field/cave_03.png',
    ],
    stairsBaked: true,
    tinted: false,
  },
  ancient_ruins: {
    layouts: [ruins01, ruins02, ruins03],
    images: [
      '/assets/field/ruins_01.png',
      '/assets/field/ruins_02.png',
      '/assets/field/ruins_03.png',
    ],
    stairsBaked: true,
    tinted: false,
  },
  snow_mountain: {
    layouts: [snow01, snow02, snow03],
    images: [
      '/assets/field/snow_01.png',
      '/assets/field/snow_02.png',
      '/assets/field/snow_03.png',
    ],
    stairsBaked: true,
    tinted: false,
  },
  lava_cavern: {
    layouts: [lava01, lava02, lava03],
    images: [
      '/assets/field/lava_01.png',
      '/assets/field/lava_02.png',
      '/assets/field/lava_03.png',
    ],
    stairsBaked: true,
    tinted: false,
    // 溶岩の池は通れない。レイアウトJSONの walkable_tiles から外して
    // lava_lake の当たり判定に変えてあるのは
    // monster_project/build_field_assets.py の derive_lava_blocks()。
    // 絵から導出しているので、溶岩地形が描き直されて届いても同じ処理がかかる。
  },
  // 予備。background が上のどれでもないダンジョンが来たときの受け皿。
  // 最初の洞窟のフロア図3枚(20x14マス)で、こちらは DUNGEON_TINT で色を変える。
  fallback: {
    layouts: [floor01, floor02, floor03],
    images: [
      '/assets/field/floor_01.png',
      '/assets/field/floor_02.png',
      '/assets/field/floor_03.png',
    ],
    stairsBaked: false,
    tinted: true,
    chestSpots: [
      // floor_01: 北西の部屋のすみ / 大扉を消した跡の北東の部屋 / 中央 / 南の広間の両すみ
      [[2, 2], [8, 5], [17, 2], [5, 10], [17, 10]],
      // floor_02: 西の小部屋 / 2本の柱にはさまれた奥 / 北東のすみ / 南のすみ
      [[2, 2], [5, 2], [8, 3], [17, 2], [2, 10], [13, 10]],
      // floor_03: 祭壇わきの左右 / 東西の広間のすみ / 南の小部屋
      [[7, 2], [11, 2], [2, 4], [17, 4], [7, 11], [12, 11]],
    ],
  },
};

/** そのダンジョンが使うフロア図一式。知らない biome は予備へ落ちる。 */
export function floorSetFor(dungeon) {
  return FLOOR_SETS[dungeon?.background] || FLOOR_SETS.fallback;
}

export function floorLayout(dungeon, floorIndex) {
  const set = floorSetFor(dungeon);
  return set.layouts[floorIndex % set.layouts.length];
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
  // 溶岩の池。walkable_tiles から外して当たり判定にしたマス
  // (monster_project/build_field_assets.py の derive_lava_blocks が絵から作る)。
  // ただの壁にすると調べても何も起きず、「なぜ通れないのか」が伝わらない。
  lava_lake: 'どろりと 煮えたぎる 溶岩だ。とても 渡れない。',

  // --- 散らしてある置きもの12種 --------------------------------------
  // 下の DUNGEON_PROPS が置くもの。ここに一言が無いと「調べても無反応」に
  // なるので、12種すべてに必ず1行ずつ用意してある。
  prop_tsubo: 'ひびの入った 壺だ。中には ほこりしか 入っていない。',
  prop_hone: '大きな骨が ころがっている。……何の 骨だろう。',
  prop_taru: '木の樽。中身は とっくに 干からびている。',
  prop_hako: '木箱が 積んである。釘づけで 開きそうにない。',
  prop_taimatsu: '壁の たいまつ。誰かが 火を 絶やさずに いるのだろうか。',
  prop_torokko: '古い トロッコだ。車輪が さびついて 動かない。',
  prop_tsuruhashi: '打ちすてられた つるはし。柄が 折れている。',
  prop_sekichu: 'くずれかけた 石柱。つたが 巻きついている。',
  prop_sekizou: '苔むした 石像。じっと こちらを 見ている 気がする。',
  prop_tsurara: '天井から のびた 太い つらら。近づくと 冷たい。',
  prop_yukidaruma: '雪だるまだ。……こんな ところで 誰が 作ったのだろう。',
  prop_toke_iwa: '溶けかけた 岩。まだ 赤く くすぶっていて、熱い。',
};

/**
 * 名前の頭で引く一言。草原のフロア図は同じ物が場所ちがいで何度も出てきて
 * (rock_north / rock_southeast / tree_center …)、1つずつ書くと必ず書き漏らす。
 * 「その名前を PROP_LINES に足すまで だんまり」を作らないための受け皿。
 */
const PROP_LINE_PREFIXES = [
  ['rock', '大きな岩だ。押しても びくとも しない。'],
  ['tree', '太い木が 立ちふさがっている。まわり道を しよう。'],
  ['pillar', '古い石柱。天井を ささえている。'],
  ['crystal', 'ふしぎな 光を ためた 水晶だ。'],
  // 洞窟・遺跡・雪山・溶岩の4地形は、置きものの名前が obstacle_1..4 という
  // 中身の分からない名前で届いた。4地形12枚とも絵は岩(遺跡はくずれた石づみ、
  // 雪山は雪をかぶった岩)なので、まとめて岩の一言を返す。
  ['obstacle', '大きな岩だ。押しても びくとも しない。'],
];

/** 置きものを調べたときの一言。無い名前は頭の一致で拾う。 */
function propLine(name) {
  if (!name) return null;
  if (PROP_LINES[name]) return PROP_LINES[name];
  const hit = PROP_LINE_PREFIXES.find(([prefix]) => name.startsWith(prefix));
  return hit ? hit[1] : null;
}

// ------------------------------------------------------------ 宝箱の置き場所

/**
 * 宝箱を置いてよいマスの条件は2つ:
 *   1. 通れるマス(walkable_tiles に載っている)であること。
 *      宝箱のマスは **通れなくする** ので、元から壁のマスに置くと
 *      「壁の中の宝箱」になって、どこからも開けられない。
 *   2. 部屋のすみ・行き止まりであること。
 *      通路のまん中を塞ぐと、運が悪いと先へ進めなくなる。
 *
 * 5つの biome は 1 も 2 も deriveChestSpots が満たす(歩ける隣マスの少ない
 * 行き止まりから順に並べる)。予備の洞窟3枚だけ、手で選んだ
 * FLOOR_SETS.fallback.chestSpots を使う。
 *
 * どちらの経路でも、下の pickChests が置くたびに
 *   ・階段どうしが行き来できるか
 *   ・その宝箱の となりに立てるか
 * を確かめ、どちらか欠けるなら その位置は捨てる。
 */

/**
 * 1フロアに置く宝箱の数。**フロアの広さで変える**。
 * 洞窟(20x14=280マス)で2つ。草原(30x20=600マス)で同じ2つだと、
 * 倍以上ある床を歩いても宝箱に出会わない区画ができてしまう。
 */
const CHEST_TILES_PER_CHEST = 140; // 280マス -> 2つ
const CHESTS_MIN = 2;
const CHESTS_MAX = 3;

function chestsForFloor(cols, rows) {
  const n = Math.round((cols * rows) / CHEST_TILES_PER_CHEST);
  return Math.max(CHESTS_MIN, Math.min(CHESTS_MAX, n));
}

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

/**
 * 1フロアに落ちている数。宝箱と同じく フロアの広さで変える。
 * 洞窟(280マス)で3コ、草原(600マス)で5コ。
 */
const FLOOR_ITEM_TILES_PER_ITEM = 93; // 280マス -> 3コ
const FLOOR_ITEMS_MIN = 3;
const FLOOR_ITEMS_MAX = 5;

function floorItemsForFloor(cols, rows) {
  const n = Math.round((cols * rows) / FLOOR_ITEM_TILES_PER_ITEM);
  return Math.max(FLOOR_ITEMS_MIN, Math.min(FLOOR_ITEMS_MAX, n));
}

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
 * その塞いだマスの **となりに立てる**か。
 *
 * 宝箱は自分のマスを塞ぐので、宝箱そのものへは歩いて行けない。行けなければ
 * ならないのは「四方のどこか1マス」で、そこに立って調べる。塞いだせいで
 * 四方が全部 壁や別の宝箱になっていると、永久に開けられない宝箱ができる。
 */
function adjacentReachable(grid, cols, rows, from, [tx, ty]) {
  return [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    if (grid.cells[ny * cols + nx] === 1) return false;
    return reachable(grid, cols, rows, from, [nx, ny]);
  });
}

// ------------------------------------------------------ 散らす置きもの
//
// 「調べられる飾り」。宝箱・落ちどうぐと役割をはっきり分けてある:
//
//              マスを塞ぐ   取り方              中身
//   宝箱        塞ぐ         となりで調べる       ゴールド / 上位のどうぐ
//   落ちどうぐ  塞がない     踏む                 安い消耗品
//   置きもの    **塞ぐ**     となりで調べる       何も出ない(一言だけ)
//
// **マスを塞ぐほうを選んだ。** 樽・石像・トロッコをすり抜けて歩けると、
// 当たり判定が抜けている「バグ」にしか見えない。フロア図に元から描き込まれて
// いる岩や石柱(collisions)も全部 塞ぐ側なので、絵として同じ物が
// 片方は通れて片方は通れない、という食い違いも作らずに済む。
//
// 塞ぐ以上、道を絶つ危険がある。だから宝箱とまったく同じ到達性の確認
// (reachable: 上り階段 -> 下り階段)を1つ置くごとに通し、
// 通れなくなる場所は捨てる。

/** 地形ごとの置きもの。common の4種は どこにでも出る。 */
const PROP_COMMON = ['prop_tsubo', 'prop_hone', 'prop_taru', 'prop_hako'];

const BIOME_PROPS = {
  grassland: [],
  // 坑道の道具と灯り。
  cave: ['prop_torokko', 'prop_tsuruhashi', 'prop_taimatsu'],
  // くずれた柱と石像。
  ancient_ruins: ['prop_sekichu', 'prop_sekizou', 'prop_taimatsu'],
  // つららと雪だるま。
  snow_mountain: ['prop_tsurara', 'prop_yukidaruma'],
  // 溶けかけの岩。
  lava_cavern: ['prop_toke_iwa', 'prop_taimatsu'],
};

/** そのダンジョンで出る置きもの一覧。知らない biome は共通の4種だけ。 */
function propPoolFor(dungeon) {
  return [...PROP_COMMON, ...(BIOME_PROPS[dungeon?.background] || [])];
}

/** 1フロアに置く数。宝箱・落ちどうぐと同じく フロアの広さで決める。 */
const PROP_TILES_PER_PROP = 70; // 280マス -> 4つ / 600マス -> 8つ
const PROPS_MIN = 3;
const PROPS_MAX = 8;

/** 置きもの同士をこのマス数(マンハッタン距離)より近づけない。 */
const PROP_MIN_GAP = 4;

/** 階段のまわりのこのマス数以内には置かない(入った瞬間 目の前が樽、を避ける)。 */
const PROP_STAIRS_CLEARANCE = 2;

function propsForFloor(cols, rows) {
  const n = Math.round((cols * rows) / PROP_TILES_PER_PROP);
  return Math.max(PROPS_MIN, Math.min(PROPS_MAX, n));
}

/**
 * このフロアに散らす置きものを決める。
 *
 * **ダンジョンidと階だけで決まる**(宝箱と同じ)。潜るたびに動かすと、
 * 一度通った道の景色が変わって、自分がどこにいるのか分からなくなる。
 * 落ちどうぐが毎回動いてよいのは「拾ったら消える物」だからで、
 * 飾りは地形の一部なので動かさない。
 *
 * @param triggers 既に埋まっているマス(階段・元からの置きもの・宝箱)
 * @param reserved 階段のマス
 */
function pickProps(dungeon, floorIndex, layout, grid, cols, rows, triggers, reserved, chests = []) {
  const pool = propPoolFor(dungeon);
  if (pool.length === 0) return [];

  const [ux, uy] = layout.stairs.up;
  const [dx, dy] = layout.stairs.down;
  const nearStairs = (x, y) => (
    (Math.abs(x - ux) <= PROP_STAIRS_CLEARANCE && Math.abs(y - uy) <= PROP_STAIRS_CLEARANCE)
    || (Math.abs(x - dx) <= PROP_STAIRS_CLEARANCE && Math.abs(y - dy) <= PROP_STAIRS_CLEARANCE)
  );

  const usable = layout.walkable_tiles.filter(
    ([x, y]) => !grid.cells[y * cols + x]
      && !triggers[key(x, y)]
      && !reserved.has(key(x, y))
      && !nearStairs(x, y),
  );
  const order = seededShuffle(usable, hash32(`${dungeon.id}#${floorIndex}#props`));
  const want = propsForFloor(cols, rows);

  const chosen = [];
  for (let i = 0; i < order.length && chosen.length < want; i += 1) {
    const [x, y] = order[i];
    const tooClose = chosen.some(
      (p) => Math.abs(p.tile[0] - x) + Math.abs(p.tile[1] - y) < PROP_MIN_GAP,
    );
    if (tooClose) continue;

    // 塞いでみて、階段どうしが行き来できなくなるならやめる。
    // 宝箱とまったく同じ確認。ここを省くと、通路のまん中に樽が湧いて
    // 下り階段へ行けないフロアが生まれる。
    grid.cells[y * cols + x] = 1;
    if (!reachable(grid, cols, rows, layout.stairs.up, layout.stairs.down)) {
      grid.cells[y * cols + x] = 0;
      continue;
    }
    // 置きものが宝箱の**前**に立ってしまうと、開けられない宝箱ができる。
    // 宝箱は自分のマスを塞いでいるので、四方のうち立てるマスが1つでも
    // 残っていなければならない。袋小路の宝箱ほどこれが効く
    // (入口が1マスしかないので、そこに樽が湧くと詰む)。
    if (!chests.every((c) => adjacentReachable(grid, cols, rows, layout.stairs.up, c.tile))) {
      grid.cells[y * cols + x] = 0;
      continue;
    }
    const name = pool[hash32(`${dungeon.id}#${floorIndex}#prop#${x},${y}`) % pool.length];
    chosen.push({
      id: `${dungeon.id}:${floorIndex}:prop:${x},${y}`,
      kind: 'prop',
      name,
      tile: [x, y],
      imageUrl: PROP_IMAGE(name),
    });
  }
  return chosen;
}

/**
 * このダンジョンのこの階に置く宝箱を決める。
 * ダンジョンidと階から決めるので、同じ階へ戻ってきても場所は変わらない。
 * (走行のたびに動くと「さっき開けた宝箱」が別の場所に現れてしまう)
 */
function pickChests(dungeon, floorIndex, layout, grid, cols, rows) {
  // 手で選んだ表があればそれを使う(予備の洞窟3枚だけ)。
  // 無ければレイアウトから導き出す。上の deriveChestSpots を参照。
  const chestSpots = floorSetFor(dungeon).chestSpots;
  let order;
  if (chestSpots) {
    const spots = chestSpots[floorIndex % chestSpots.length] || [];
    const walkable = new Set(layout.walkable_tiles.map(([x, y]) => key(x, y)));
    const usable = spots.filter(([x, y]) => walkable.has(key(x, y)) && !grid.cells[y * cols + x]);
    order = seededShuffle(usable, hash32(`${dungeon.id}#${floorIndex}`));
  } else {
    order = deriveChestSpots(dungeon, floorIndex, layout, grid, cols, rows);
  }
  const want = chestsForFloor(cols, rows);

  const chosen = [];
  for (let i = 0; i < order.length && chosen.length < want; i += 1) {
    const [x, y] = order[i];
    // 宝箱どうしが固まらないように。導き出した候補は行き止まりから順に
    // 並んでいるので、この間隔を見ないと隣り合った袋小路に2つ並んでしまう。
    const tooClose = chosen.some(
      (c) => Math.abs(c.tile[0] - x) + Math.abs(c.tile[1] - y) < CHEST_MIN_GAP,
    );
    if (tooClose) continue;
    grid.cells[y * cols + x] = 1; // 宝箱のマスは通れない = となりに立って調べる
    // ふさいだせいで階段どうしが行き来できなくなるなら、この場所はあきらめる。
    // 宝箱そのものへも歩いて行けないと、開けられない宝箱になる。
    if (reachable(grid, cols, rows, layout.stairs.up, layout.stairs.down)
      && adjacentReachable(grid, cols, rows, layout.stairs.up, [x, y])) {
      chosen.push({ id: `${dungeon.id}:${floorIndex}:${x},${y}`, kind: 'chest', tile: [x, y] });
    } else {
      grid.cells[y * cols + x] = 0;
    }
  }
  return chosen;
}

/**
 * このフロアに落ちている どうぐ を決める。
 *
 * **場所も中身も 潜るたびに変わる**(「落ちてる道具は毎回ランダムがいいですね」)。
 * 種は その潜りの run.seed。宝箱とわざと扱いを分けてある:
 *
 *            置き場所                中身
 *   宝箱     毎回おなじ(目印)         run.seed で毎回ちがう
 *   落ちどうぐ run.seed で毎回ちがう   run.seed で毎回ちがう
 *
 * 宝箱の置き場所を動かさないのは「開けずに素通りした宝箱」が別の場所へ
 * 移ってしまうから。落ちどうぐは目印ではなく ただの落ちもの なので、動いてよい。
 *
 * 潜っているあいだは動かない。種は run が持っていて、階を行き来しても
 * 戦闘から戻っても同じ値だから、組み直しても同じ配置が出る
 * (拾ったかどうかは run.pickedItems が別に覚えている)。
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
 * @param seed その潜りの種 (engine/dungeonRun.js の run.seed)
 */
function pickFloorItems(dungeon, floorIndex, layout, grid, cols, rows, triggers, reserved, seed) {
  const pool = floorItemPool(dungeon);
  if (pool.length === 0) return [];
  const usable = layout.walkable_tiles.filter(
    ([x, y]) => !grid.cells[y * cols + x] && !triggers[key(x, y)] && !reserved.has(key(x, y)),
  );
  const order = seededShuffle(usable, hash32(`${dungeon.id}#${floorIndex}#${seed}#floorItems`));
  const want = floorItemsForFloor(cols, rows);

  const chosen = [];
  for (let i = 0; i < order.length && chosen.length < want; i += 1) {
    const [x, y] = order[i];
    // かたまって落ちていると「落ちている」より「置いてある」に見える。
    const tooClose = chosen.some(
      (c) => Math.abs(c.tile[0] - x) + Math.abs(c.tile[1] - y) < FLOOR_ITEM_MIN_GAP,
    );
    if (tooClose) continue;
    if (!reachable(grid, cols, rows, layout.stairs.up, [x, y])) continue;
    const itemId = pool[hash32(`${dungeon.id}#${floorIndex}#${seed}#${x},${y}`) % pool.length];
    chosen.push({
      // idにも種を混ぜる。混ぜないと「前の潜りで同じマスから拾った」記録が
      // 残っている場合に、新しい潜りで置いた品が最初から消えて見える
      // (run.pickedItems は潜るたびに空になるので今は起きないが、
      //  持ち越すようにした瞬間に効いてくる)。
      id: `${dungeon.id}:${floorIndex}:${seed}:item:${x},${y}`,
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
 * @param run 走行状態 (engine/dungeonRun.js)。seed / openedChests / pickedItems を読む。
 *   走行の外から呼ぶとき(デバッグ・見た目の確認)は省略してよい。
 */
export function buildDungeonFloorMap(dungeon, floorIndex, run = null) {
  const openedChests = run?.openedChests || null;
  const pickedItems = run?.pickedItems || null;
  const seed = run?.seed ?? 0;
  const floorSet = floorSetFor(dungeon);
  const layout = floorLayout(dungeon, floorIndex);
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

  // 置きもの(柵・柱・祭壇・岩・木など)を調べたときの一言。階段のマスは上書きしない。
  (layout.collisions || []).forEach((c) => {
    const text = propLine(c.name);
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

  const stairTiles = new Set([key(ux, uy), key(dx, dy)]);

  // 散らす置きもの(樽・石像・トロッコなど)。宝箱の**あと**に置く。
  // 先に置くと、手で選んだ宝箱の置き場所を飾りが埋めてしまうことがある
  // (宝箱は「部屋のすみ・行き止まり」に限って選んであるので替えがきかない)。
  const props = pickProps(
    dungeon, floorIndex, layout, grid, cols, rows, triggers, stairTiles, chests,
  );
  props.forEach((p) => {
    triggers[key(p.tile[0], p.tile[1])] = { type: 'look', text: propLine(p.name) };
  });

  // 床に落ちているどうぐ。宝箱・置きものを置いたあとに置く(どちらのマスも
  // triggers に入っているので、そこは候補から自然に外れる)。
  // マスは通れるままにする。
  const floorItems = pickFloorItems(
    dungeon, floorIndex, layout, grid, cols, rows, triggers, stairTiles, seed,
  );
  floorItems.forEach((it) => {
    it.taken = !!(pickedItems && pickedItems[it.id]);
    triggers[key(it.tile[0], it.tile[1])] = { type: 'floorItem', id: it.id };
  });

  // 階段。マスは通れるまま(踏んで使う)。宝箱と違ってマスを塞ぐと乗れない。
  //
  // 絵に階段が描き込まれている biome (草原) では スプライトを置かない。
  // 置くと同じ階段が2つ重なる。踏んだときの動き(triggers)は同じなので、
  // 見た目が絵か置きものかの違いしかない。
  const stairs = [];
  if (!floorSet.stairsBaked) {
    if (hasUpStairs) {
      stairs.push({ id: `${dungeon.id}:${floorIndex}:stairsUp`, kind: 'stairs', dir: 'up', tile: [ux, uy] });
    }
    stairs.push({ id: `${dungeon.id}:${floorIndex}:stairsDown`, kind: 'stairs', dir: 'down', tile: [dx, dy] });
  }

  const objects = [...stairs, ...props, ...chests, ...floorItems];

  return makeMap({
    id: `dungeon:${dungeon.id}:${floorIndex}`,
    label: `${dungeon.name}　地下${floorIndex + 1}階`,
    imageUrl: floorSet.images[floorIndex % floorSet.images.length],
    cols, rows, grid, triggers, objects,
    tint: floorSet.tinted ? (DUNGEON_TINT[dungeon.background] || null) : null,
    bgColor: 0x07080c,
  });
}

// -------------------------------------------------------------- ボス部屋
//
// ボス戦を「最下層の下り階段の先」ではなく、**地形ごとの専用の広間**で行う。
//
// 納品のJSONは stairs が空で、代わりに entrance を1マス持っている。
// つまり作りとしては「入ったら出口が無い部屋」で、それをそのまま使う:
//
//   最下層の下り階段(bossGate) ──> ボス部屋の入口に立つ
//     └─ 上り階段も下り階段も無い。引き返す道は無い。
//        奥のボスに近づくと戦闘。勝てば踏破 -> 司祭 -> 町。
//        負けても 司祭 -> 町。キメラのつばさ だけは今までどおり効く
//        (歩いている途中で使える唯一の帰り道を、ここだけ塞ぐ理由がない)。
//
// 5部屋とも 30x20マスで、入口は南のまん中([14,19])から北へのびる通路。
// 広間はどれも y=4〜5 あたりから上が全面歩けるので、ボスは北のまん中に置く。

const BOSS_ROOMS = {
  grassland: { layout: bossGrassland, image: '/assets/field/boss_grassland.png', bgColor: 0x1d3a1a },
  cave: { layout: bossCave, image: '/assets/field/boss_cave.png', bgColor: 0x0b0906 },
  ancient_ruins: { layout: bossRuins, image: '/assets/field/boss_ruins.png', bgColor: 0x14161c },
  snow_mountain: { layout: bossSnow, image: '/assets/field/boss_snow.png', bgColor: 0x2a4f70 },
  lava_cavern: { layout: bossLava, image: '/assets/field/boss_lava.png', bgColor: 0x2a0a05 },
};

/** ボスを立たせたい位置(北のまん中)。歩けなければ真下へ探しに行く。 */
const BOSS_PREFERRED_TILE = [14, 5];

/** ボスからこのマス数(チェビシェフ距離)まで近づくと戦闘が始まる。 */
export const BOSS_TRIGGER_RANGE = 2;

/** そのダンジョンのボス部屋。専用の部屋が無い biome は null(= 今までどおり階段の先で戦う)。 */
export function bossRoomFor(dungeon) {
  return BOSS_ROOMS[dungeon?.background] || null;
}

/** ボスの立ち位置。歩けるマスの中から、決め打ちの位置にいちばん近いものを選ぶ。 */
function bossTile(layout) {
  const walkable = new Set(layout.walkable_tiles.map(([x, y]) => key(x, y)));
  const [px, py] = BOSS_PREFERRED_TILE;
  if (walkable.has(key(px, py))) return [px, py];
  // 決め打ちが壁だった場合の受け皿。部屋が描き直されても止まらないように。
  let best = null;
  layout.walkable_tiles.forEach(([x, y]) => {
    const d = Math.abs(x - px) + Math.abs(y - py);
    if (!best || d < best[0]) best = [d, [x, y]];
  });
  return best ? best[1] : layout.entrance;
}

/**
 * ボス部屋のマップ。
 * @param dungeon dungeons.json の1本
 * @param bossSpriteUrl ボス(先頭の敵)の絵。無ければ影だけ置く。
 */
export function buildBossRoomMap(dungeon, bossSpriteUrl = null) {
  const room = bossRoomFor(dungeon);
  if (!room) return null;
  const layout = room.layout;
  const [cols, rows] = layout.map_tiles;
  const grid = emptyGrid(cols, rows);

  // フロアと同じ「通れるマスのホワイトリスト」方式。
  grid.cells.fill(1);
  layout.walkable_tiles.forEach(([x, y]) => openTile(grid, x, y));
  (layout.collisions || []).forEach((c) => blockRect(grid, c.rect_tiles));
  const [ex, ey] = layout.entrance;
  openTile(grid, ex, ey);

  const triggers = {};
  (layout.collisions || []).forEach((c) => {
    const text = propLine(c.name);
    if (!text) return;
    const [px, py, pw, ph] = c.rect_tiles;
    for (let yy = py; yy < py + ph; yy += 1) {
      for (let xx = px; xx < px + pw; xx += 1) triggers[key(xx, yy)] = { type: 'look', text };
    }
  });

  // ボス。マスは塞ぐ(すり抜けられると「立ちふさがっている」に見えない)。
  // 近づくと戦闘が始まるので、実際にぶつかることはまず無い。
  const [bx, by] = bossTile(layout);
  grid.cells[by * cols + bx] = 1;
  const boss = {
    id: `${dungeon.id}:boss`,
    kind: 'boss',
    tile: [bx, by],
    imageUrl: bossSpriteUrl || null,
  };
  // 近づいたら戦闘。踏むマスすべてに置くのではなく、MapScene が
  // 毎歩 bossRange で見る(下の bossApproach)。調べても始まる。
  triggers[key(bx, by)] = { type: 'bossFight' };

  return makeMap({
    id: `boss:${dungeon.id}`,
    label: `${dungeon.name}　ボスの間`,
    imageUrl: room.image,
    cols, rows, grid, triggers,
    objects: [boss],
    bossTile: [bx, by],
    bgColor: room.bgColor,
  });
}

/** ボス部屋に入ったときの立ち位置(入口)。 */
export function bossRoomSpawn(dungeon) {
  const room = bossRoomFor(dungeon);
  if (!room) return TOWN_SPAWN;
  const [x, y] = room.layout.entrance;
  return { x, y, facing: 'up' };
}

// ------------------------------------------------------------ 雪の町 (準備中)
//
// **まだ どこからも行けない。** 素材と当たり判定だけ先に入れてある。
// 開通させるのに足りていないもの:
//   1. 5棟の内装(家2・店・宿・ギルド)。JSONの doors は target を持っているが、
//      その行き先の部屋そのものが無い。
//   2. 町から町への移動手段(乗りもの / ワールドマップ / 船着き場のいずれか)。
//      いまの導線は「町の南の門 -> ダンジョン選択」しか無い。
//   3. 2つめの町にしかできないこと(でないと、ただの遠い同じ町になる)。
//
// 下の SNOW_TOWN_DOORS は **いま直しておく価値がある** ので先に入れてある。
// 納品JSONの doors が5つとも **1マス上にずれている**(扉の絵ではなく、その上の
// 石壁の段を指している)。最初の町とまったく同じずれ方で、同じ直し方をした:
//   ・実際に扉が描いてある段(納品の y + 1)へ下げる
//   ・扉の絵は5つとも幅72px = 1.12マスで **マスの境目をまたいでいる** ので、
//     2マスとも入口にする(どちらから近づいても入れる)
// 代表のマス(先頭)は、扉の絵が多くかかっているほう。
//
// 実測(monster_project/incoming/future_assets/snow_town/snow_town.png):
//   house_west  扉 x6.20〜7.34 y7  (マス6に80% / マス7に34%)  納品は [6,6]
//   shop_north  扉 x15.31〜16.47 y7 (マス15に69% / マス16に47%) 納品は [16,6]
//   house_east  扉 x24.17〜25.30 y7 (マス24に83% / マス25に30%) 納品は [25,6]
//   inn_west    扉 x6.72〜7.84 y20  (マス7に84% / マス6に28%)   納品は [7,19]
//   guild_east  扉 x23.80〜24.91 y20 (マス24に91% / マス23に20%) 納品は [24,19]
// 5マスとも walkable_tiles に載っていて、当たり判定にも掛かっていない。
export const SNOW_TOWN_DOORS = {
  house_west: { label: '西の家', tiles: [[6, 7], [7, 7]] },
  shop_north: { label: '北の店', tiles: [[15, 7], [16, 7]] },
  house_east: { label: '東の家', tiles: [[24, 7], [25, 7]] },
  inn_west: { label: '宿屋', tiles: [[7, 20], [6, 20]] },
  guild_east: { label: 'ギルド', tiles: [[24, 20], [23, 20]] },
};

/**
 * 雪の町のマップ。**まだ誰も呼んでいない**(行き先として繋いでいないため)。
 * 内装ができたら TOWN_DOORS と同じ形で triggers を張れば そのまま動く。
 */
export function buildSnowTownMap() {
  const [cols, rows] = snowTownLayout.map_tiles;
  const grid = emptyGrid(cols, rows);
  (snowTownLayout.collisions || []).forEach((c) => blockRect(grid, c.rect_tiles));

  const triggers = {};
  Object.entries(SNOW_TOWN_DOORS).forEach(([doorId, door]) => {
    door.tiles.forEach(([x, y]) => {
      openTile(grid, x, y);
      // 行き先の内装がまだ無いので、いまは「入れない」一言だけを返す。
      // だんまりにすると壊れて見える。
      triggers[key(x, y)] = {
        type: 'look',
        text: `${door.label}の 扉だ。かたく 閉ざされている。`,
        doorId,
      };
    });
  });

  return makeMap({
    id: 'snow_town',
    label: '雪の町',
    imageUrl: '/assets/field/snow_town.png',
    cols, rows, grid, triggers,
    bgColor: 0x3a5f80,
  });
}

/** フロアに入ったときの立ち位置。descending=下りてきた / ascending=上がってきた。 */
export function dungeonFloorSpawn(dungeon, floorIndex, from) {
  const layout = floorLayout(dungeon, floorIndex);
  if (from === 'below') {
    const [x, y] = layout.stairs.down;
    return { x, y, facing: 'up' };
  }
  const [x, y] = layout.stairs.up;
  return { x, y, facing: 'down' };
}
