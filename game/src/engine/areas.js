// areas.js
// ダンジョン12本を「地方(エリア)」5つにまとめる。
//
// 表示のためだけの分類ではない。ダンジョン選択が一覧から地図になり、
// 「いま自分はどのあたりまで来ているか」を絵で示す単位がエリアになった。
//
// 分け方は dungeons.json の background をそのまま使う。
// 戦闘背景 = その場所の絵なので、同じ絵のダンジョンは同じ土地にある。
// 新しい欄を足して二重に持つと、片方だけ直したときに食い違う。
//
// 本数はエリアごとにバラバラ (3 / 2 / 3 / 2 / 2)。
// そろえるためにダンジョンを増やすことはしない。旅は等間隔ではない。
//
// 解放の判定も **新しい保存は一切増やさず**、これまでどおり
// clearedDungeons (mrg_slot{n}_cleared_dungeons) から導く。
//   ダンジョン … locked なら「ひとつ前を踏破していれば開く」(元のまま)
//   エリア    … そのエリアのどれか1本でも開いていれば開く
// 結果として、エリアは左から順に開いていく。

import dungeons from '../data/dungeons.json';

/**
 * エリアの見せ方。
 * icon は build_field_assets.py の build_area_icons() が
 * 戦闘背景を丸く抜いて書き出したもの。地図の丸と、実際に立つ戦場が一致する。
 */
export const AREA_META = {
  grassland: {
    name: 'みどりの草原',
    note: '町の門を出てすぐ。風とやわらかい魔物の土地。',
  },
  cave: {
    name: 'ひびきの洞窟',
    note: '草原の先、岩山に空いた横穴。灯りの届かない奥がある。',
  },
  ancient_ruins: {
    name: 'いにしえの遺跡',
    note: '誰が建てたのかも分からない石の建物。奥ほど古い。',
  },
  snow_mountain: {
    name: '常冬の雪山',
    note: '一年じゅう雪が解けない高地。寒さそのものが敵。',
  },
  lava_cavern: {
    name: '灼熱の火口',
    note: '地の底の熱だまり。立っているだけで体力がけずれる。',
  },
};

const DEFAULT_AREA = 'grassland';

const areaIdOf = (dungeon) => dungeon.background || DEFAULT_AREA;

/** 丸アイコンの置き場。DungeonSelect と build_field_assets.py の取り決め。 */
export const areaIconUrl = (areaId) => `/assets/area/${areaId}.png`;

/**
 * エリアの一覧。**dungeons.json に出てくる順** に並ぶ。
 * 手で順番を書かないので、データを差し替えれば地図もそのまま追従する。
 */
export const AREAS = (() => {
  const byId = new Map();
  dungeons.forEach((d, index) => {
    const id = areaIdOf(d);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: AREA_META[id]?.name || id,
        note: AREA_META[id]?.note || '',
        icon: areaIconUrl(id),
        dungeons: [],
      });
    }
    // index は元の並び順。解放の判定と、カードの通し番号に使う。
    byId.get(id).dungeons.push({ ...d, index });
  });
  return [...byId.values()];
})();

/** ひとつのダンジョンが開いているか。判定は以前の DungeonSelect と同じ。 */
export function isDungeonUnlocked(index, clearedDungeons) {
  const d = dungeons[index];
  if (!d) return false;
  if (!d.locked) return true;
  const prev = dungeons[index - 1];
  return prev ? clearedDungeons.includes(prev.id) : true;
}

/** エリアが開いているか。中の1本でも開いていれば、その土地には入れる。 */
export function isAreaUnlocked(area, clearedDungeons) {
  return area.dungeons.some((d) => isDungeonUnlocked(d.index, clearedDungeons));
}

/** エリアの踏破ぐあい。地図の「2/3」に出す。 */
export function areaProgress(area, clearedDungeons) {
  const cleared = area.dungeons.filter((d) => clearedDungeons.includes(d.id)).length;
  return { cleared, total: area.dungeons.length, done: cleared === area.dungeons.length };
}

/**
 * 「この1本を踏破したことで、新しく開いたエリア」を返す。無ければ null。
 *
 * 解放そのものは clearedDungeons から導けるが、**開いた瞬間** だけは
 * 状態からは分からない(次に地図を見たときには、もう開いている)。
 * 踏破した側 (App.jsx) がここで確かめて、地図へ知らせる。
 * 保存はしない。祝いは一度きりで、取っておくものではない。
 *
 * @param {string} dungeonId いま踏破したダンジョン
 * @param {string[]} clearedBefore 踏破する前の一覧
 */
export function areaOpenedBy(dungeonId, clearedBefore) {
  const before = clearedBefore || [];
  if (before.includes(dungeonId)) return null;
  const after = [...before, dungeonId];
  return (
    AREAS.find((a) => !isAreaUnlocked(a, before) && isAreaUnlocked(a, after)) || null
  );
}

export default { AREAS, AREA_META, areaIconUrl, isDungeonUnlocked, isAreaUnlocked, areaProgress, areaOpenedBy };
