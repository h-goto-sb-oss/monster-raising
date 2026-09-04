/**
 * ホーム画面に追加したときの中身（サービスワーカー）。
 *
 * 素材が全部で126MBあるので「先に全部落として完全オフライン」は現実的でない。
 * 代わりに、一度でも通った画面ぶんだけ手元に残す作りにしてある。
 * 一度遊んだところは電波が悪くてもすぐ開くし、二度目からの起動が速い。
 *
 * 置き場所は2つに分けてある。
 *   SHELL  … index.html。配信のたびに作り直す。
 *   ASSETS … JS/CSS/絵。消さずに貯める。JS/CSSはファイル名に中身のハッシュが
 *            入っていて、変われば別名になるので古いものが悪さをしない。
 *            絵は名前が変わらないので stale-while-revalidate
 *            （まず手元のものを出し、裏で新しいものを取り直す）にしてある。
 *            差し替えた絵は次の起動から反映される。
 */
const SHELL = 'mrg-shell-v1'
const ASSETS = 'mrg-assets-v1'

// このファイル自身の場所がそのまま配信の根になる。
// ローカルは「/」、GitHub Pages は「/monster-raising/」。
const ROOT = new URL('./', self.location).pathname

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add(ROOT)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// 容量が一杯のときの put() は例外を投げる。ここで落とすと配信そのものが
// 失敗して真っ白になるので、保存に失敗しても黙って先へ進める。
async function keep(cacheName, request, response) {
  // opaque は Google Fonts のように no-cors で取ったもの。status が 0 なので
  // ok は false だが、そのまま保存して出し直せる。
  if (!response || (!response.ok && response.type !== 'opaque')) return
  try {
    const c = await caches.open(cacheName)
    await c.put(request, response)
  } catch {
    /* 容量オーバー。表示には影響しない */
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // 画面そのもの（index.html）。新しい配信をすぐ拾いたいので通信を先に試し、
  // 圏外のときだけ手元のものを出す。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          keep(SHELL, ROOT, res.clone())
          return res
        })
        .catch(() => caches.match(ROOT).then((hit) => hit || Response.error())),
    )
    return
  }

  // 書体は Google のサーバーにある。これも手元に残しておかないと、
  // 圏外のときだけ字体が変わってしまう（ドット絵の見出しが普通のゴシックになる）。
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            keep(ASSETS, request, res.clone())
            return res
          }),
      ),
    )
    return
  }

  if (url.origin !== self.location.origin) return // それ以外のよそのサーバーは触らない
  if (url.pathname === `${ROOT}sw.js`) return // 自分自身は素通し（更新の確認を邪魔しない）

  // JS/CSS はファイル名にハッシュが入っているので、あれば手元のものでよい。
  if (/\.(js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            keep(ASSETS, request, res.clone())
            return res
          }),
      ),
    )
    return
  }

  // 絵・音。まず手元のものを返して待たせない。裏で取り直して次回に備える。
  if (/\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav|json)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const net = fetch(request)
          .then((res) => {
            keep(ASSETS, request, res.clone())
            return res
          })
          .catch(() => hit || Response.error())
        return hit || net
      }),
    )
  }
})
