// 対策室 収集ロボ本体。storageState.json（保存済みログイン）で Spotify for Creators を開き、
// 各番組のKPIを取得して GAS Web App 経由でスプレッドシートへ upsert する。
// computer-use 不使用＝許可ダイアログ無しで無人実行できる。
//
// 堅牢化(2026-07)：
//  - 取得失敗した番組は「送らない」＝シートの既存の良い値を空欄で上書きしない。
//  - 一時的な読み込み失敗は最大2回リトライ。
//  - ログイン切れ（未ログイン画面）を検知し、良いデータを消さないよう送信中止＋再認証を促す。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// 実行場所（cwd）に依存せず、このスクリプトのあるフォルダ基準でファイルを読み書きする。
// これを省くと、リポジトリのルート等から手で実行したとき shows.json / storageState.json を
// 見失って落ちる（実際にハマった）。run.sh は元々ここへ cd してから呼ぶので無影響。
const here = import.meta.dirname;
const at = (...p) => path.join(here, ...p);

// ---- .env 読み込み（依存を増やさない簡易パーサ）----
const env = {};
if (fs.existsSync(at('.env'))) {
  for (const line of fs.readFileSync(at('.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SHEET_ENDPOINT = env.SHEET_ENDPOINT || process.env.SHEET_ENDPOINT || '';
const SHEET_SECRET = env.SHEET_SECRET || process.env.SHEET_SECRET || '';

const today = new Date().toISOString().slice(0, 10);
const { shows } = JSON.parse(fs.readFileSync(at('shows.json'), 'utf8'));
fs.mkdirSync(at('debug'), { recursive: true });
fs.mkdirSync(at('out'), { recursive: true });

if (!fs.existsSync(at('storageState.json'))) {
  console.error('storageState.json が無い。先に `node save-auth.mjs` でログインを保存してください。');
  process.exit(1);
}

// ---- テキストから数値を拾うヘルパー（DOM変更に強い text ベース）----
function toNumber(str) {
  if (str == null) return null;
  const m = String(str).replace(/,/g, '').match(/([\d.]+)\s*([KMkm]?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'K') n *= 1e3; else if (u === 'M') n *= 1e6;
  return Math.round(n);
}
function parseShow(text) {
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const allTime = pick(/([\d.,]+\s*[KM]?)\s*all-time plays/i);
  const followers = pick(/([\d.,]+\s*[KM]?)\s*followers/i);
  // 「Plays & downloads … <数値> <±%> … Last 30 days」の並びから拾う
  const l30block = text.match(/\nPlays\s*&\s*downloads\s*\n([\s\S]{0,60}?)Last 30 days/i);
  let plays30 = null, delta30 = null;
  if (l30block) {
    plays30 = (l30block[1].match(/([\d.,]+\s*[KM]?)/) || [])[1] || null;
    const dm = l30block[1].match(/([+\-−–])\s*([\d.]+)\s*%/);
    delta30 = dm ? (dm[1] === '+' ? '+' : '-') + dm[2] + '%' : null;
  }
  const latest = pick(/Latest Episode[\s\S]{0,60}?(#\d+[^\n]{0,60})/i);
  const published = pick(/Published on ([^\n]+)/i);
  const returning = pick(/Returning[\s\S]{0,24}?([\d,]+)/i);
  const audNew = pick(/Returning[\s\S]{0,80}?\bNew\b[\s\S]{0,24}?([\d,]+)/i);
  return {
    allTime: toNumber(allTime),
    followers: toNumber(followers),
    plays30: toNumber(plays30),
    delta30: delta30 ? delta30.replace('–', '-') : null,
    latest: latest ? latest.replace(/\s+/g, ' ').trim() : null,
    published,
    audienceReturning: toNumber(returning),
    audienceNew: toNumber(audNew),
  };
}

// 1番組を取得。成功={d,text}／ログイン切れ={loginWall:true}／失敗={failed:true}
async function fetchShow(page, s) {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // networkidle はSpotifyのSPA（常時ポーリング）で永久に発火せずタイムアウトするため domcontentloaded + 固定待ちに。
      await page.goto(`https://creators.spotify.com/home/show/${s.showId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // 「all-time plays」が描画されるまで待つ（SPAの遅延対策）。出なければそのまま進む。
      await page.waitForFunction(() => /all-time plays/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText);
      const hasData = /all-time plays/i.test(text);
      const loginWall = !hasData && /log in to spotify|ログイン|continue with/i.test(text);
      if (loginWall) return { loginWall: true };
      const d = parseShow(text);
      if (d.allTime != null) return { d, text };
      lastErr = 'all-time plays 見つからず';
    } catch (e) {
      lastErr = e.message;
    }
    await page.waitForTimeout(1500); // リトライ前に小休止
  }
  return { failed: true, err: lastErr };
}

const rows = [];
let ok = 0, skipped = 0, authFail = 0;
// launchPersistentContext は storageState を受け付けない（無視されて未ログインになる）。
// 通常の launch + newContext で保存済みCookieを読ませる。
const browserApp = await chromium.launch({ headless: true });
const browser = await browserApp.newContext({ storageState: at('storageState.json') });
const page = await browser.newPage();

for (const s of shows.filter((x) => x.showId)) {
  const res = await fetchShow(page, s);
  if (res.loginWall) {
    authFail++;
    console.error(`✗ ${s.name}: 未ログイン（ログイン切れ）`);
    continue;
  }
  if (res.failed || !res.d) {
    skipped++;
    console.error(`✗ ${s.name}: 取得失敗のためスキップ（既存値を保持）: ${res.err || ''}`);
    continue;
  }
  fs.writeFileSync(at('debug', `${s.name}.txt`), res.text);
  rows.push({ 番組: s.name, ...res.d, 更新日: today });
  ok++;
  console.log(`✓ ${s.name}: allTime=${res.d.allTime} followers=${res.d.followers} 30d=${res.d.plays30}(${res.d.delta30})`);
}

await browser.close();
console.log(`--- 取得 ${ok}件 / スキップ ${skipped}件 / 未ログイン ${authFail}件 ---`);

// ---- 出力：GASへPOST（無ければCSVフォールバック）。取得0件なら送らない＝上書き事故を防ぐ ----
fs.writeFileSync(at('out', 'podcasts.json'), JSON.stringify(rows, null, 2));
if (rows.length === 0) {
  if (authFail > 0) {
    console.error('⚠️ 全番組が未ログイン。Cookieが切れています。`node save-auth.mjs`（または import-chrome-cookies.mjs）でログインを入れ直してください。今回はシートを更新しません。');
  } else {
    console.error('取得0件のため送信しません（シート据え置き）。');
  }
  process.exit(2);
}
if (SHEET_ENDPOINT) {
  try {
    const res = await fetch(SHEET_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SHEET_SECRET, sheet: '番組データ', rows }),
    });
    console.log('Sheet POST:', res.status, await res.text());
  } catch (e) {
    console.error('Sheet POST失敗（CSVに保存済み）:', e.message);
  }
} else {
  const header = '番組,全期間再生,フォロワー,直近30日再生,直近30日変化,最新回,状態,更新日';
  const csv = [header, ...rows.map((r) =>
    [r.番組, r.allTime ?? '', r.followers ?? '', r.plays30 ?? '', r.delta30 ?? '', r.latest ?? '', '自動取得', r.更新日].join(',')
  )].join('\n');
  fs.writeFileSync(at('out', 'podcasts.csv'), csv);
  console.log('SHEET_ENDPOINT未設定。out/podcasts.csv に保存しました。');
}
console.log('done.');
process.exit(0);
