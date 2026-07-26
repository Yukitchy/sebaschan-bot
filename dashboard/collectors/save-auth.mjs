// 一度だけ実行：ブラウザを開いて Spotify / Airbnb / italki に手でログインし、
// Cookie を storageState.json に保存する。以後の scrape.mjs はこれを使って
// ダイアログ無し・無人で取得できる。
import { chromium } from 'playwright';
import readline from 'node:readline';

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

const browser = await chromium.launchPersistentContext('', { headless: false });
const page = browser.pages()[0] || await browser.newPage();

console.log('\nブラウザが開きました。次のサイトに順番にログインしてください：');
console.log('  1) https://creators.spotify.com');
console.log('  2) https://www.airbnb.com/hosting  （任意）');
console.log('  3) https://www.italki.com/teacher/wallet  （任意）');
console.log('※ 普段のChromeではなく、いま開いたこの窓でログインすること。');
await page.goto('https://creators.spotify.com');
await page.bringToFront();

// Spotifyの認証クッキーが入るまで保存しない。ここを省くと未ログインのstorageStateを
// 保存してしまい、scrape.mjs が静かに空振りする（実際に一度やらかした）。
while (true) {
  await ask('\n全部ログインし終えたら、このターミナルで Enter を押してください… ');
  const cookies = await browser.cookies();
  if (cookies.some((c) => c.name === 'sp_dc' || c.name === 'sp_key')) break;
  console.log('⚠️ Spotifyのログインが確認できません（sp_dc クッキーが無い）。この窓で creators.spotify.com にログインしてから、もう一度 Enter。');
}

await browser.storageState({ path: 'storageState.json' });
console.log('✅ storageState.json に保存しました。');
await browser.close();
process.exit(0);
