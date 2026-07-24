// 対策室 収集ロボ本体。storageState.json（保存済みログイン）で Spotify for Creators を開き、
// 各番組のKPIを取得して GAS Web App 経由でスプレッドシートへ upsert する。
// computer-use 不使用＝許可ダイアログ無しで無人実行できる。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// ---- .env 読み込み（依存を増やさない簡易パーサ）----
const env = {};
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SHEET_ENDPOINT = env.SHEET_ENDPOINT || process.env.SHEET_ENDPOINT || '';
const SHEET_SECRET = env.SHEET_SECRET || process.env.SHEET_SECRET || '';

const today = new Date().toISOString().slice(0, 10);
const { shows } = JSON.parse(fs.readFileSync('shows.json', 'utf8'));
fs.mkdirSync('debug', { recursive: true });
fs.mkdirSync('out', { recursive: true });

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json が無い。先に `node save-auth.mjs` でログインを保存してください。');
  process.exit(1);
}

// ---- テキストから数値を拾うヘルパー（DOM変更に強い text ベース）----
const clean = (s) => (s || '').replace(/[,\s]/g, '');
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
  const audNew = pick(/\bNew\b[\s\S]{0,24}?([\d,]+)/i);
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

const rows = [];
// launchPersistentContext は storageState を受け付けない（無視されて未ログインになる）。
// 通常の launch + newContext で保存済みCookieを読ませる。
const browserApp = await chromium.launch({ headless: true });
const browser = await browserApp.newContext({ storageState: 'storageState.json' });
const page = await browser.newPage();

for (const s of shows.filter((x) => x.showId)) {
  try {
    // networkidle はSpotifyのSPA（常時ポーリング）で永久に発火せずタイムアウトするため domcontentloaded + 固定待ちに。
    await page.goto(`https://creators.spotify.com/home/show/${s.showId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join('debug', `${s.name}.txt`), text);
    const d = parseShow(text);
    rows.push({ 番組: s.name, ...d, 更新日: today });
    console.log(`✓ ${s.name}: allTime=${d.allTime} followers=${d.followers} 30d=${d.plays30}(${d.delta30})`);
  } catch (e) {
    console.error(`✗ ${s.name}: ${e.message}`);
  }
}

// ---- Airbnb / italki の雛形（要ログイン後にselector調整）----
// async function collectAirbnb(page) { /* TODO: hosting → insights の売上/予約を取得 */ }
// async function collectItalki(page) { /* TODO: teacher wallet の入金/単価を取得 */ }

await browser.close();

// ---- 出力：GASへPOST（無ければCSVフォールバック）----
fs.writeFileSync('out/podcasts.json', JSON.stringify(rows, null, 2));
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
  fs.writeFileSync('out/podcasts.csv', csv);
  console.log('SHEET_ENDPOINT未設定。out/podcasts.csv に保存しました。');
}
console.log('done.');
process.exit(0);
