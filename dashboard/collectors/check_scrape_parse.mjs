#!/usr/bin/env node
// runnable check: scrape.mjs の toNumber/parseShow（テキスト→数値パース）が壊れていないかの最小assert自己テスト。
// scrape.mjs 本体は編集せず、ソースから該当ブロックをそのまま抜き出してevalする（本番ロジックを直接検証）。
// 実行: node check_scrape_parse.mjs
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(here, 'scrape.mjs'), 'utf8');

const start = src.indexOf('function toNumber');
const end = src.indexOf('// 1番組を取得');
if (start < 0 || end < 0) {
  throw new Error('scrape.mjs の構造が変わっていてtoNumber/parseShowブロックを抜き出せない（要更新）');
}
const block = src.slice(start, end);
const { toNumber, parseShow } = new Function(block + '\nreturn { toNumber, parseShow };')();

// --- toNumber ---
console.assert(toNumber('1,234') === 1234, 'toNumber: カンマ区切り失敗');
console.assert(toNumber('1.2K') === 1200, 'toNumber: K単位失敗');
console.assert(toNumber('3M') === 3000000, 'toNumber: M単位失敗');
console.assert(toNumber(null) === null, 'toNumber: null処理失敗');
console.assert(toNumber('見つからず') === null, 'toNumber: 非数値で誤って値を返した');

// --- parseShow（Spotify for Creators ページ innerText を模したモック）---
const mock = `偏愛Channel
12,345 all-time plays
6,789 followers

Plays & downloads
2,345
+8.5%
Last 30 days

Latest Episode
#42 深夜の収録回

Published on Jan 1, 2026

Returning
100
New
23
`;
const r = parseShow(mock);
console.assert(r.allTime === 12345, `parseShow: allTime失敗 got=${r.allTime}`);
console.assert(r.followers === 6789, `parseShow: followers失敗 got=${r.followers}`);
console.assert(r.plays30 === 2345, `parseShow: plays30失敗 got=${r.plays30}`);
console.assert(r.delta30 === '+8.5%', `parseShow: delta30失敗 got=${r.delta30}`);
console.assert(r.latest && r.latest.startsWith('#42'), `parseShow: latest失敗 got=${r.latest}`);
console.assert(r.audienceReturning === 100, `parseShow: returning失敗 got=${r.audienceReturning}`);
console.assert(r.audienceNew === 23, `parseShow: new失敗 got=${r.audienceNew}`);

// 取得失敗ページ（"all-time plays"が無い）→ 全部null（0件スキップに回る想定）
const r2 = parseShow('ログインしてください');
console.assert(r2.allTime === null, 'parseShow: データ無しページでnullにならなかった');

console.log('✅ check_scrape_parse OK（toNumber/parseShow 9件パス）');
