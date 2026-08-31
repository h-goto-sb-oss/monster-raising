import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * public/ に置いた絵は、ソースの中では '/assets/...' と「/」始まりで書いてある。
 * これは配信先がサイトの根 (http://localhost:5173/) のときだけ正しい。
 *
 * GitHub Pages は https://h-goto-sb-oss.github.io/monster-raising/ のように
 * 一段下がった場所に置かれるので、そのままだと絵を
 * https://h-goto-sb-oss.github.io/assets/... に取りに行って全部404になる。
 * 画面はエラーにならず「絵だけ出ない」ので気づきにくい。
 *
 * そこで build のときだけ '/assets/' を base 付き
 * ('/monster-raising/assets/') に書き換える。
 * JS/JSX だけでなく CSS (townUI.css の背景) と JSON
 * (items.json の icon、monsters.json の spriteUrl) も通すので書き換え漏れが出ない。
 * base が '/' のとき (npm run dev / npm run build) は何もしないので、
 * ふだんの開発の見え方は今までどおり。
 */
function rebasePublicAssetPaths() {
  let base = '/'
  return {
    name: 'rebase-public-asset-paths',
    enforce: 'pre',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transform(code, id) {
      if (base === '/') return null
      const file = id.split('?')[0]
      // 書き換えるのは自分で書いたものだけ。ライブラリ側にたまたま
      // '/assets/' という文字列があっても触らない。
      if (file.includes('node_modules')) return null
      if (!/\.(jsx?|css|json)$/.test(file)) return null
      if (!code.includes('/assets/')) return null
      return { code: code.split('/assets/').join(`${base}assets/`), map: null }
    },
  }
}

export default defineConfig({
  plugins: [rebasePublicAssetPaths(), react()],
  build: {
    rollupOptions: {
      output: {
        // Phaser (約1.5MB) を別ファイルに切り出す。中身が変わらないかぎり
        // スマホのブラウザのキャッシュが効くので、ゲーム側だけ直したときの
        // 読み込みが軽くなる。
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          return null
        },
      },
    },
  },
})
