// 普段使いのChromeに入っているログインCookieを取り出して storageState.json を作る。
// save-auth.mjs の代わり（別窓で入り直さなくていい）。Cookieが切れたらまたこれを走らせる。
// 仕組み: Chromeは Cookie を AES-128-CBC で暗号化し、その鍵をキーチェーン
// "Chrome Safe Storage" に置いている。取り出して PBKDF2 で伸ばせば復号できる。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOMAINS = /spotify|airbnb|italki/i;
const CHROME_DIR = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

// --- 使用中のプロファイルを推測（Cookiesファイルが一番新しいもの）---
const candidates = fs.readdirSync(CHROME_DIR)
  .filter((d) => d === 'Default' || d.startsWith('Profile '))
  .flatMap((d) => ['Network/Cookies', 'Cookies'].map((f) => path.join(CHROME_DIR, d, f)))
  .filter((p) => fs.existsSync(p))
  .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (!candidates.length) { console.error('ChromeのCookiesファイルが見つからない:', CHROME_DIR); process.exit(1); }
const dbPath = candidates[0].p;
console.log('プロファイル:', dbPath.replace(CHROME_DIR, '…/Chrome'));

// --- 鍵をキーチェーンから（ここで許可ダイアログが出る）---
const pw = execFileSync('security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'], { encoding: 'utf8' }).trim();
const key = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
const iv = Buffer.alloc(16, ' ');

// --- Chromeが掴んだままでも読めるよう複製してから読む ---
const tmp = path.join(os.tmpdir(), `cookies-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, tmp + suffix);
}
const sql = `SELECT host_key, name, path, expires_utc, is_secure, is_httponly, samesite, hex(encrypted_value) FROM cookies;`;
const dump = execFileSync('sqlite3', ['-separator', '\t', tmp, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + suffix); } catch {} }

function decrypt(hex) {
  const buf = Buffer.from(hex, 'hex');
  if (buf.subarray(0, 3).toString() !== 'v10') return null; // v11/未暗号は対象外
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  d.setAutoPadding(false);
  let out = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
  const pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad);
  // Chrome 127以降は平文の先頭32バイトがドメインのハッシュ。印字不能なら剥がす。
  if (out.length > 32 && out.subarray(0, 32).some((b) => b < 0x20 || b > 0x7e)) out = out.subarray(32);
  return out.toString('utf8');
}

const SAMESITE = { '-1': 'None', 0: 'None', 1: 'Lax', 2: 'Strict' };
const cookies = [];
for (const line of dump.split('\n')) {
  if (!line.trim()) continue;
  const [host, name, cpath, expires, secure, httponly, samesite, hex] = line.split('\t');
  if (!DOMAINS.test(host)) continue;
  let value;
  try { value = decrypt(hex); } catch { continue; }
  if (value == null) continue;
  // Chromeの expires_utc は 1601-01-01 からのマイクロ秒。0はセッションCookie。
  const exp = Number(expires) > 0 ? Math.round(Number(expires) / 1e6 - 11644473600) : -1;
  cookies.push({
    name, value, domain: host, path: cpath,
    expires: exp, httpOnly: httponly === '1', secure: secure === '1',
    sameSite: SAMESITE[samesite] ?? 'Lax',
  });
}

fs.writeFileSync('storageState.json', JSON.stringify({ cookies, origins: [] }, null, 2));
const byHost = {};
for (const c of cookies) byHost[c.domain] = (byHost[c.domain] || 0) + 1;
console.log('取り出したCookie:', cookies.length);
console.log(Object.entries(byHost).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
const authed = cookies.some((c) => c.name === 'sp_dc' || c.name === 'sp_key');
console.log(authed ? '✅ Spotifyのログイン(sp_dc)を確認。storageState.json に保存しました。'
                   : '⚠️ sp_dc が無い。Chromeで creators.spotify.com にログインしてから再実行してください。');
process.exit(authed ? 0 : 1);
