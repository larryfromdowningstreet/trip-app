# 旅伴行程

多人一起規劃旅程的 App，**完全不連網**。旅伴之間用 QR Code 面對面交換行程，出國沒有網路也能用。

- iPhone：用 Safari 打開網址，「分享 → 加入主畫面」，之後從主畫面圖示打開即可離線使用。
- 網站只在發布新版本時需要上網；App 本身禁止任何連線（CSP `connect-src 'none'`）。

## 怎麼運作

- **身分**：第一次使用設定暱稱和 4 位數 PIN 碼，手機自己產生簽章與加密金鑰，私鑰無法匯出。
- **白名單**：大家輪流舉手機，互掃身分 QR Code，比對白名單碼。只有親手掃過的人才會進白名單。
- **邀請**：主揪顯示邀請 QR Code，旅程鑰匙分別加密給每位新成員，並設定角色（主揪可修改、成員只能看）。
- **同步**：一人當收集者，依序掃大家，再換大家掃他，最後比對同步碼。只傳上次同步後的新變更。
- **衝突**：兩人改了同一處時，先顯示較晚的版本並標示「待確認」，由主揪決定；刪除和修改同時發生時先保留。
- **封鎖**：手機遺失時封鎖該成員，封鎖前的變更保留，之後的一律不採用。
- **鎖定**：離開 App 2 分鐘後上鎖；PIN 連續錯 10 次清除本機資料（行程可再和旅伴互掃取回）。

## 開發

```sh
npm install
npm run dev        # 開發伺服器；瀏覽器主控台可用 await dev.seed() 建立範例旅程
npm test           # 單元測試
npx tsc -p .       # 型別檢查
npm run build      # 產生 dist/（含 CSP 與離線用 service worker）
```

## 程式結構

```
src/core/      純邏輯，不碰畫面：金鑰、變更紀錄與合併、同步封包、邀請、PIN 與加密儲存、日出日落
src/platform/  手機能力：IndexedDB、相機掃描、QR 繪製、螢幕常亮
src/app/       App 狀態與動作（store）、行程計算、外觀主題
src/ui/        共用元件、圖示、QR 顯示與掃描、日落轉場
src/screens/   各個畫面
```

新增畫面：在 `src/app/store.ts` 的 `Route` 加一行，在 `src/main.tsx` 的 `Screen` 加一行。
新增行程欄位：`src/core/model.ts` 的 `ITEM_FIELDS`、`src/app/trip.ts` 的 `FIELD_NAMES`、編輯畫面各一行。

字型：森林綠配色使用 Noto Serif TC（SIL Open Font License，見 `public/font-license.txt`）。
