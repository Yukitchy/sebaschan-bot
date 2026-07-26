# 対策室 収集ロボ（Mac・ローカル常駐）

**目的**: ログイン/画面操作が要るデータ（Spotify for Creators・Airbnb・italki）を、ユウキのMac上で毎朝自動取得し、共有スプレッドシートへ書き込む。これで**スマホ/webなどどのセッションからでも数字が読める**ようになり、「クラウドセッションはログインできない」問題が起きなくなる。

```
[Mac 毎朝6:30] scrape.mjs (認証済みPlaywright)
      │  → Spotify/Airbnb/italki を静かに取得（computer-use不使用＝許可ダイアログ無し）
      ▼
[GAS Web App]  sheet-endpoint.gs（doPostで受けてシートにupsert）
      ▼
[共有スプレッドシート]  対策室KPI｜番組データ
      id: 1m-lt_n6bkNXW5gdASxJyLTSf0KeEVkq7prO_GFYQH9A
      https://docs.google.com/spreadsheets/d/1m-lt_n6bkNXW5gdASxJyLTSf0KeEVkq7prO_GFYQH9A/edit
      ▼
[スマホ/web/朝イチルーチン]  Drive経由で読み、ダッシュボードへ反映
```

なぜcomputer-useでなくPlaywright+保存済みログインか: computer-useは実行毎に許可ダイアログが要り無人運用で止まる（既知の教訓）。一度ログインを`storageState.json`に保存すれば、以後はダイアログ無しで安定取得できる。

---

## 一度だけのセットアップ（Macで）

1. **依存インストール**
   ```bash
   cd dashboard/collectors
   npm install
   npx playwright install chromium
   ```

2. **ログインを保存**（ブラウザが開くので Spotify/Airbnb/italki に手でログイン→Enter）
   ```bash
   node save-auth.mjs
   ```
   → `storageState.json` が作られる（Cookie。**gitに載せない**＝.gitignore済み）。

3. **書き込み先GASを用意**
   - シート「対策室KPI｜番組データ」を開く → 拡張機能 → Apps Script
   - `sheet-endpoint.gs` の中身を貼る。`SECRET` を好きな文字列に変更。
   - デプロイ → 新しいデプロイ → 種類「ウェブアプリ」→ 実行ユーザー=自分 / アクセス=全員 → デプロイ。**URLをコピー**。

4. **`.env` を作成**（**gitに載せない**）
   ```bash
   cp .env.example .env
   # SHEET_ENDPOINT=<コピーしたGAS URL>
   # SHEET_SECRET=<sheet-endpoint.gs と同じ SECRET>
   ```

5. **対象番組を登録**: `shows.json` に番組名とshowId（creators.spotify.com/home/show/**ここ**）を追記。アニつま・My ADDress Life は登録済み。

6. **動作確認**
   ```bash
   node scrape.mjs            # 取得してシートに反映。debug/ に生テキストが残る
   ```
   selectorがズレて数字が取れない場合は `debug/<番組>.txt`（ページの生テキスト）を見て `scrape.mjs` の正規表現を微調整する。

7. **毎朝自動化（launchd）**
   ```bash
   cp com.yuki.taisaku-collector.plist ~/Library/LaunchAgents/
   # plist内の <収集ロボの絶対パス> を実際のパスに置換してから
   launchctl load ~/Library/LaunchAgents/com.yuki.taisaku-collector.plist
   ```
   → 毎朝6:30に取得。ログは `collector.log`。

## メンテ注意
- SpotifyのDOM変更で取得が崩れることがある → `debug/` を見て正規表現を直す。
- Cookieが切れたら `node save-auth.mjs` で入れ直し。
- Airbnb/italki は `scrape.mjs` 内で雛形を用意（要ログイン後のselector調整）。まずSpotifyが安定してから広げる。
