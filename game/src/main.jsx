import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/**
 * ホーム画面に追加したときに、アプリとして起動できるようにする。
 * 通っていない素材まで先読みはしない（全部で126MBある）。一度見た画面が
 * 手元に残るだけなので、電波の悪いところでも二度目からは開く。
 *
 * 開発中(npm run dev)は登録しない。古い画面が居座って直したはずの
 * 表示が変わらない、という紛らわしい事故を避けるため。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        /* 登録できなくても、ふつうのサイトとして遊べる */
      })
  })
}
