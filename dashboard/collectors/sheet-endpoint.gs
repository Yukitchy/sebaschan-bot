/**
 * 対策室KPI シートの書き込み口（Google Apps Script Web App）
 * スプレッドシート「対策室KPI｜番組データ」に紐づけて使う。
 * デプロイ：デプロイ → 新しいデプロイ → ウェブアプリ → 実行=自分 / アクセス=全員 → URLをコピー。
 * scrape.mjs の .env に SHEET_ENDPOINT=そのURL / SHEET_SECRET=下のSECRET を設定する。
 */
var SECRET = 'CHANGE_ME_共有シークレット';           // ← .env の SHEET_SECRET と同じ値に変更（公開リポなので実値はコミットしない）
var SHEET_ID = '1m-lt_n6bkNXW5gdASxJyLTSf0KeEVkq7prO_GFYQH9A';
var HEADERS = ['番組', '全期間再生', 'フォロワー', '直近30日再生', '直近30日変化', '最新回', '状態', '更新日'];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json_({ ok: false, error: 'bad secret' });
    }
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var name = body.sheet || '番組データ';
    var sh = ss.getSheetByName(name) || ss.getSheets()[0];
    // ヘッダー保証
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);

    var data = sh.getDataRange().getValues();
    var nameCol = 0; // A列＝番組名
    var updated = 0, added = 0;

    (body.rows || []).forEach(function (r) {
      var row = [
        r['番組'] || '',
        r.allTime != null ? r.allTime : '',
        r.followers != null ? r.followers : '',
        r.plays30 != null ? r.plays30 : '',
        r.delta30 || '',
        r.latest || '',
        '自動取得',
        r['更新日'] || (new Date()).toISOString().slice(0, 10)
      ];
      // 既存行を番組名で探して upsert
      var found = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][nameCol]).trim() === String(r['番組']).trim()) { found = i; break; }
      }
      if (found >= 0) {
        sh.getRange(found + 1, 1, 1, row.length).setValues([row]);
        updated++;
      } else {
        sh.appendRow(row);
        added++;
      }
    });
    return json_({ ok: true, updated: updated, added: added });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() { return json_({ ok: true, msg: '対策室KPI endpoint alive' }); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
