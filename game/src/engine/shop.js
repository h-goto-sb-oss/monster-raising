// shop.js
// どうぐ屋の品ぞろえと売値。
//
// ゴールドは宝箱からしか出ない (engine/dungeonRun.js)。
// これまで使い道が無かったので、稼いでも「数字が増えるだけ」だった。
// ここが最初の使い道になる。
//
// 何を置くかの方針:
//   - 消耗品だけを置く。回復・状態異常なおし・餌・戦闘用の攻撃どうぐ・移動どうぐ。
//   - **たね と きのみ (恒久強化) は置かない**。能力が永久に上がるどうぐは
//     宝箱で見つけたときの手ごたえが売りなので、金で無限に買えるとそれが消える。
//   - 高いものは踏破が進むまで並ばない。最初の町で せかいじゅのしずく が
//     買えてしまうと、序盤のダンジョンで引き返す判断が要らなくなる。
//
// 売値は買値の半分。ここを買値と同じにすると、
// 「買って売る」を繰り返すだけで持ちものを自由に入れ替えられてしまい、
// ふくろ20スロットという制限が意味を失う。

/**
 * 品ぞろえ。unlock は「この数だけダンジョンを踏破すると並ぶ」。
 * 0 は最初から。並び順がそのまま店頭の並び順になる。
 */
export const SHOP_STOCK = [
  { itemId: 'item_yakusou', unlock: 0 },
  { itemId: 'item_mahounomizu', unlock: 0 },
  { itemId: 'item_dokukeshisou', unlock: 0 },
  { itemId: 'item_mezamenosuzu', unlock: 0 },
  { itemId: 'item_mahinaoshinotsuyu', unlock: 0 },
  { itemId: 'item_seinarumizu', unlock: 0 },
  { itemId: 'item_seisui', unlock: 0 },
  { itemId: 'item_kimeranotsubasa', unlock: 0 },
  { itemId: 'item_hoshiniku', unlock: 0 },

  { itemId: 'item_jouyakusou', unlock: 2 },
  { itemId: 'item_bakudanishi', unlock: 2 },
  { itemId: 'item_kiyomenofuda', unlock: 2 },
  { itemId: 'item_bannouyaku', unlock: 3 },
  { itemId: 'item_koukyuuniku', unlock: 3 },

  { itemId: 'item_tokujouyakusou', unlock: 5 },
  { itemId: 'item_maryokunoshizuku', unlock: 5 },
  { itemId: 'item_ikazuchinotsue', unlock: 6 },
  { itemId: 'item_saikoukyuuniku', unlock: 7 },
  { itemId: 'item_sekaijunoha', unlock: 8 },
  { itemId: 'item_sekaijunoshizuku', unlock: 10 },
];

/** 売値。買値の半分(最低1G)。 */
export function sellPrice(item) {
  return Math.max(1, Math.floor((item?.price ?? 0) / 2));
}

/**
 * いま店頭に並ぶどうぐのid。
 * @param {number} clearedCount 踏破したダンジョンの数
 */
export function stockedItemIds(clearedCount = 0) {
  return SHOP_STOCK.filter((s) => clearedCount >= s.unlock).map((s) => s.itemId);
}

/**
 * まだ並んでいないもののうち、いちばん早く並ぶものの必要踏破数。
 * 「あと1つ踏破すれば品ぞろえが増える」と言えるようにするため。
 * 全部並んでいたら null。
 */
export function nextUnlockAt(clearedCount = 0) {
  const rest = SHOP_STOCK.filter((s) => clearedCount < s.unlock).map((s) => s.unlock);
  return rest.length > 0 ? Math.min(...rest) : null;
}

export default { SHOP_STOCK, sellPrice, stockedItemIds, nextUnlockAt };
