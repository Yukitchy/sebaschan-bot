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
console.log('  1) https://open.spotify.com      （★必須：ここに sp_dc クッキーが入る）');
console.log('  2) https://www.airbnb.com/hosting  （任意）');
console.log('  3) https://www.italki.com/teacher/wallet  （任意）');
console.log('※ 普段のChromeではなく、いま開いたこの窓でログインすること。');
// sp_dc は creators.spotify.com ではなく open.spotify.com（Webプレイヤー）にログイン
// したときに .spotify.com ドメインへ入る。creators だけ開くと sp_dc が入らず、
// 下の検知ループを永久に抜けられない（実際にハマった）。最初から open を開く。
await page.goto('https://open.spotify.com');
await page.bringToFront();

// Spotifyの認証クッキーが入るまで保存しない。ここを省くと未ログインのstorageStateを
// 保存してしまい、scrape.mjs が静かに空振りする（実際に一度やらかした）。
while (true) {
  await ask('\n全部ログインし終えたら、このターミナルで Enter を押してください… ');
  const cookies = await browser.cookies();
  if (cookies.some((c) => c.name === 'sp_dc' || c.name === 'sp_key')) break;

  // どのSpotify系クッキーが来ているか見せて、原因を切り分けやすくする。
  const spNames = cookies
    .filter((c) => /spotify/.test(c.domain) || c.name.startsWith('sp_'))
    .map((c) => c.name);
  console.log('⚠️ Spotifyのログインが確認できません（sp_dc / sp_key クッキーが無い）。');
  console.log(`   いま見えているSpotify系クッキー: ${spNames.length ? spNames.join(', ') : '（なし）'}`);
  console.log('   → creators ではなく open.spotify.com にログインが必要です。いまこの窓で開き直します…');
  try {
    await page.goto('https://open.spotify.com');
    await page.bringToFront();
  } catch {
    // ページを閉じられていても落とさない。ユーザーが手で開けばOK。
  }
  console.log('   右上に自分のアイコンが出て「ログイン済み」を確認したら、もう一度 Enter。');
}

await browser.storageState({ path: 'storageState.json' });
console.log('✅ storageState.json に保存しました。');
await browser.close();
process.exit(0);
