// node test/run.js : モック上で src/*.gs を動かして確かめる。実際のApps Script・ドライブでは実行していない。
var fs = require('fs'), path = require('path'), vm = require('vm');
var mock = require('./mock_apis.js');
var B = path.join(__dirname, '..', 'src');
var FILES = ['Common.gs', 'Config.gs', 'SeedData.gs', 'Notify.gs', 'Pdf.gs', 'Code.gs'];
var T0 = Date.UTC(2026, 10, 2, 0, 0, 0); // 2026-11-02 09:00 JST
var res = [];
function ok(name, cond, detail) { res.push(!!cond); console.log((cond ? '[OK] ' : '[NG] ') + name + (cond || !detail ? '' : ' - ' + detail)); }
function env(nowMs) {
  var b = mock.buildMockGlobals({ nowMs: nowMs || T0, docs: true });
  var ctx = vm.createContext(b.globals);
  FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(B, f), 'utf8'), ctx, { filename: f }); });
  ctx.resetDemo();
  return { ctx: ctx, w: b.world };
}
function rows(e, n) { var s = e.w.sheets[n]; return s ? s.__rows().slice(1).filter(function (r) { return r.length && r[0] !== ''; }) : []; }
function pdfs(e) { return Object.keys(e.w.files).map(function (k) { return e.w.files[k]; }).filter(function (f) { return f.blob && f.blob.mime === 'application/pdf'; }); }
function folders(e) { return Object.keys(e.w.files).map(function (k) { var f = e.w.files[k]; f.id = k; return f; }).filter(function (f) { return f.meta.mimeType === 'application/vnd.google-apps.folder'; }); }
function docOf(e, f) { return e.w.docs[f.blob.source]; }
function unesc(t) { return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
// 変換用 HTML の表を [[セル…]…] に戻す（1行目は見出し）
function table(e, f) { return (docOf(e, f).html.match(/<tr>.*?<\/tr>/g) || []).map(function (tr) { return (tr.match(/<t[hd]>(.*?)<\/t[hd]>/g) || []).map(function (c) { return unesc(c.replace(/<\/?t[hd]>/g, '')); }); }); }

(function () {
  var e = env();
  ok('R01 期間の指定は先月（2026-10）', e.ctx.lastMonth_() === '2026-10');
  var r = e.ctx.makeLastMonth();
  ok('R02 結果：作成3・エラー2（日報が無い大野はPDFなし）', r.ok && r.made === 3 && r.errors === 2 && r.skipped === 0, JSON.stringify(r));
  ok('R03 PDFは3つ', pdfs(e).length === 3);
  ok('R04 ファイル名は 日報_期間_担当者.pdf', pdfs(e).map(function (f) { return f.meta.name; }).sort().join() === ['日報_2026-10_川上（架空）.pdf', '日報_2026-10_林（架空）.pdf', '日報_2026-10_森（架空）.pdf'].sort().join());
  var fs_ = folders(e), root = fs_.filter(function (f) { return !f.meta.parents; });
  ok('R05 親フォルダ1つ＋担当者フォルダ3つ', root.length === 1 && fs_.length === 4 && root[0].meta.name === '日報PDF（架空デモ）');
  var byName = {}; fs_.forEach(function (f) { byName[f.meta.name] = f.id; });
  ok('R06 担当者フォルダは親フォルダの中', fs_.filter(function (f) { return f.meta.parents; }).every(function (f) { return f.meta.parents[0] === root[0].id; }));
  ok('R07 各PDFは本人のフォルダに保存', pdfs(e).every(function (f) { return !!f.meta.parents && f.meta.parents[0] === byName[f.meta.name.replace(/^日報_2026-10_|\.pdf$/g, '')]; }));
  var mori = pdfs(e).filter(function (f) { return /森/.test(f.meta.name); })[0];
  var t = table(e, mori);
  ok('R08 森の表：見出し＋10月の5件（9月分は入らない）', t.length === 6 && t.slice(1).every(function (x) { return x[0].slice(0, 7) === '2026-10' && x[1] === '森（架空）'; }), JSON.stringify(t));
  ok('R09 日付順に並ぶ', t.slice(1).map(function (x) { return x[0]; }).join() === '2026-10-01,2026-10-06,2026-10-14,2026-10-22,2026-10-30');
  ok('R10 他の人の行は入らない', pdfs(e).every(function (f) { var n = f.meta.name.replace(/^日報_2026-10_|\.pdf$/g, ''); return table(e, f).slice(1).every(function (x) { return x[1] === n; }); }));
  var d = docOf(e, mori);
  ok('R11 見出しの下に担当者・期間・件数', d.html.indexOf('<p>件数：5件</p>') > 0 && d.html.indexOf('<p>担当者：森（架空）</p>') > 0 && d.html.indexOf('<p>期間：2026-10</p>') > 0);
  ok('R12 作業用ドキュメントは削除、PDFは残る', pdfs(e).every(function (f) { return docOf(e, f).removed === true && !f.removed; }));
  var sd = rows(e, '送信予定');
  ok('R22 送信予定は3行・宛先は担当者・状態は未送信（記録のみ）', sd.length === 3 && sd.every(function (x) { return x[1] === '2026-10' && /（架空）$/.test(x[2]) && x[3] === '2026-10 の月次日報（PDF）' && x[6] === '未送信（記録のみ）'; }), JSON.stringify(sd));
  ok('R23 送信予定のファイルIDは作ったPDFと一致', sd.every(function (x) { return pdfs(e).some(function (f) { return f.meta.name === x[4] && e.w.files[x[5]] === f; }); }));
  var st = rows(e, '担当者');
  ok('R13 担当者シートにフォルダIDを記録（大野は空のまま）', st.filter(function (x) { return x[1]; }).length === 3 && st.filter(function (x) { return x[0] === '大野（架空）'; })[0][1] === '');
  ok('R14 作成記録は3行', rows(e, '作成記録').length === 3 && rows(e, '作成記録').every(function (x) { return x[0] === '2026-10'; }));
  var log = rows(e, 'エラー通知ログ');
  ok('R15 担当者一覧にいない人はエラー通知ログへ', log.some(function (x) { return /担当者一覧にいません：佐藤（架空）/.test(x[3]); }));
  ok('R16 日付が読めない行はエラー通知ログへ', log.some(function (x) { return /日付が読めません：2026-10-3x/.test(x[3]); }));
  ok('R17 通知の宛先は管理者（架空）・記録だけ', log.length === 2 && log.every(function (x) { return x[2] === '管理者（架空）'; }));

  var r2 = e.ctx.makeLastMonth();
  ok('R18 2回目は何も作らない（同じ期間・担当者は二度作らない）', r2.made === 0 && r2.skipped === 3 && pdfs(e).length === 3, JSON.stringify(r2));
  ok('R19 2回目でフォルダが増えない', folders(e).length === 4);
  ok('R24 2回目で送信予定が増えない', rows(e, '送信予定').length === 3);
  ok('R20 2回目でエラー通知が増えない', rows(e, 'エラー通知ログ').length === 2 && r2.errors === 0);
  var r3 = e.ctx.makeReports('2026-09');
  ok('R21 別の期間（9月）は森の1件だけ・同じフォルダに入る', r3.made === 1 && r3.files[0].rows === 1 && r3.files[0].folderId === byName['森（架空）'] && folders(e).length === 4, JSON.stringify(r3));
})();

(function () {
  var e = env(); e.ctx.APP_CONFIG.maxPerRun = 2;
  var r = e.ctx.makeReports('2026-10');
  ok('B01 1回の上限2：2つ作って残り1は次回', r.made === 2 && r.pending === 1, JSON.stringify(r));
  var r2 = e.ctx.makeReports('2026-10');
  ok('B02 次の実行で続きの1つだけ作る', r2.made === 1 && r2.skipped === 2 && r2.pending === 0 && pdfs(e).length === 3, JSON.stringify(r2));
})();

(function () {
  var e = env(); e.w.props[e.ctx.pdfDailyKey_()] = String(e.ctx.APP_CONFIG.pdf.dailyLimit);
  var r = e.ctx.makeReports('2026-10');
  ok('B03 1日の上限に達したら止めて記録', r.ok === false && r.code === 'ERROR' && rows(e, 'エラー通知ログ').some(function (x) { return /上限/.test(x[3]); }) && pdfs(e).length === 0);
  var threw = false; try { e.ctx.makeReports('2026/10'); } catch (err) { threw = true; }
  ok('B04 期間の形が違えば止まる', threw);
  e.w.lockBusy = true;
  ok('B05 実行中なら BUSY', e.ctx.makeReports('2026-10').code === 'BUSY');
})();

(function () {
  var e = env();
  e.w.sheets['日報'].appendRow(['2026-10-31', '林（架空）', "'=IMPORTRANGE(\"x\")", '点検', '完了', '']);
  e.ctx.makeReports('2026-10');
  var hayashi = pdfs(e).filter(function (f) { return /林/.test(f.meta.name); })[0];
  ok('B06 = で始まる値は文字のまま表へ（数式にならない）', table(e, hayashi).some(function (x) { return x[2] === '=IMPORTRANGE("x")'; }));
  ok('B07 ファイル名に使えない文字は _ に', e.ctx.safeFileName_('a/b:c') === 'a_b_c');
  e.ctx.resetDemo();
  ok('B08 resetDemo で作成記録・送信予定・ログが空に戻る（作ったPDFは消さない）', rows(e, '作成記録').length === 0 && rows(e, '送信予定').length === 0 && rows(e, 'エラー通知ログ').length === 0 && pdfs(e).length === 3);
})();

(function () {
  var e = env(); e.w.exportFail = true;
  var r = e.ctx.makeReports('2026-10');
  var docs = Object.keys(e.w.docs).map(function (k) { return e.w.docs[k]; });
  ok('B09 PDFにできないとき：止めて記録・作業用ドキュメントは削除・送信予定は入らない', r.ok === false && pdfs(e).length === 0 && docs.length === 1 && docs[0].removed === true && rows(e, '送信予定').length === 0 && rows(e, 'エラー通知ログ').some(function (x) { return /export/.test(x[3]); }), JSON.stringify(r));
  e.w.exportFail = false;
  var r2 = e.ctx.makeReports('2026-10');
  ok('B10 直った次の実行で3つ作り、送信予定も3行', r2.made === 3 && rows(e, '送信予定').length === 3, JSON.stringify(r2));
})();

(function () {
  var e = env(); e.w.exportBytes = 200;
  var r = e.ctx.makeReports('2026-10');
  var docs = Object.keys(e.w.docs).map(function (k) { return e.w.docs[k]; });
  ok('B09b 中身が無いようなごく小さいPDF：保存せず止めて記録・作業用は削除・送信予定なし', r.ok === false && pdfs(e).length === 0 && docs.length === 1 && docs[0].removed === true && rows(e, '送信予定').length === 0 && rows(e, 'エラー通知ログ').some(function (x) { return /小さすぎ/.test(x[3]); }), JSON.stringify(r));
  e.w.exportBytes = null;
  ok('B10b 直った次の実行で3つ作れる', e.ctx.makeReports('2026-10').made === 3);
})();

(function () {
  var code = FILES.map(function (f) { return fs.readFileSync(path.join(B, f), 'utf8'); }).join('\n');
  ok('X01 送信・共有の処理がない', !/\b(GmailApp|MailApp)\b|\bGmail\.|addViewer|addEditor|setSharing|permissions\.create/i.test(code));
  ok('X02 DriveApp・getAs・DocumentApp を使わない（DriveApp は drive.file だけでは動かない）', !/\bDriveApp\b|\.getAs\s*\(|\bDocumentApp\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  ok('X07 外部への通信は Pdf.gs の Drive の export 1か所だけ（宛先は www.googleapis.com）', (code.replace(/\/\*[\s\S]*?\*\//g, '').match(/\bUrlFetchApp\b/g) || []).length === 1 && (FILES.filter(function (f) { return /\.gs$/.test(f); }).map(function (f) { return fs.readFileSync(path.join(B, f), 'utf8'); }).join('\n').match(/https:\/\//g) || []).length === 1 && code.indexOf("var PDF_EXPORT_URL_ = 'https://www.googleapis.com/drive/v3/files/';") >= 0 && /UrlFetchApp\.fetch\(PDF_EXPORT_URL_ \+ tmp\.id \+ '\/export\?mimeType=application\/pdf',/.test(fs.readFileSync(path.join(B, 'Pdf.gs'), 'utf8')));
  ok('X08 Drive.Files.export を使わない（v3 では alt=media が要り失敗する）', !/Files\.export\s*\(/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  var man = JSON.parse(fs.readFileSync(path.join(B, 'appsscript.json'), 'utf8'));
  ok('X03 権限は3つだけ（このシート・自分で作ったファイル・Google の変換を呼ぶ外部接続）', man.oauthScopes.join() === ['spreadsheets.currentonly', 'drive.file', 'script.external_request'].map(function (s) { return 'https://www.googleapis.com/auth/' + s; }).join());
  ok('X06 DocumentApp を使わない（documents の権限が要らない）', !/\bDocumentApp\b/.test(code));
  ok('X04 notifySend_ を呼ばない', !/notifySend_\(/.test(fs.readFileSync(path.join(B, 'Code.gs'), 'utf8')));
  ok('X05 架空の表記：日報の担当者は全員（架空）', require('vm').runInNewContext(fs.readFileSync(path.join(B, 'SeedData.gs'), 'utf8') + ';DEMO_REPORTS.every(function(r){return /（架空）$/.test(r[1]) && /^架空/.test(r[2]);})'));
})();

(function () {
  var e = env(), H = e.ctx.APP_CONFIG.madeHeader;
  delete e.w.sheets['作成記録'];
  var sh = e.ctx.SpreadsheetApp.getActive().insertSheet('作成記録'); sh.getRange(1, 1, 1, H.length).setValues([H]);
  e.ctx.makeDemoMonth();
  var v = rows(e, '作成記録').map(function (x) { return x[5]; });
  ok('K01 書式なしで手で作ったシートでも、作成日時は0埋めの文字（yyyy-MM-dd HH:mm:ss）で入る', v.length >= 1 && v.every(function (x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x); }), JSON.stringify(v));
})();
(function () {
  var e = env(Date.UTC(2026, 11, 10, 0, 0, 0)); var r = e.ctx.makeDemoMonth();
  ok('K03 makeDemoMonth は今日の日付に関係なく 2026-10 の日報PDFを3つ作る', rows(e, '作成記録').length === 3 && rows(e, '作成記録').every(function (x) { return x[0] === '2026-10'; }), JSON.stringify(r));
})();

(function () {
  var e = env(); e.ctx.alertRecord_({});
  var v = (rows(e, 'エラー通知ログ').pop() || [])[0];
  ok('L01 エラー通知ログの時刻は日付つき（yyyy-MM-dd HH:mm:ss の文字）', typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v), String(v));
})();

(function () {
  var e = env(); e.ctx.makeDemoMonth();
  var ids = Object.keys(e.w.files).filter(function (k) { var f = e.w.files[k]; return f.blob && f.blob.mime === 'application/pdf'; });
  e.w.files.other1 = { meta: { name: 'other.pdf', mimeType: 'application/pdf' }, blob: { mime: 'application/pdf' }, trashed: false };
  var r = e.ctx.resetDemo();
  var folders = Object.keys(e.w.files).filter(function (k) { return e.w.files[k].meta.mimeType === 'application/vnd.google-apps.folder'; });
  ok('T10 resetDemo は記録にある古いPDFだけをゴミ箱へ（記録外のPDF・フォルダは残す）', ids.length > 0 && ids.every(function (k) { return e.w.files[k].trashed; }) && r.trashed === ids.length && !e.w.files.other1.trashed && folders.length > 0 && folders.every(function (k) { return !e.w.files[k].trashed; }), JSON.stringify(r));
  var e2 = env(); e2.ctx.makeDemoMonth();
  var ids2 = Object.keys(e2.w.files).filter(function (k) { var f = e2.w.files[k]; return f.blob && f.blob.mime === 'application/pdf'; });
  e2.w.files[ids2[0]].removed = true; e2.w.denyIds = ids2.length > 1 ? [ids2[1]] : [];
  var logs = [], cl = e2.ctx.console.log; e2.ctx.console.log = function (m) { logs.push(String(m)); };
  var r2, err = null; try { r2 = e2.ctx.resetDemo(); } catch (x) { err = x; }
  e2.ctx.console.log = cl;
  var expSkip = ids2.length > 1 ? 2 : 1;
  ok('T11 もう無い・権限の無いPDFは飛ばして止まらない（ログに書く）', !err && r2.skipped === expSkip && r2.trashed === ids2.length - expSkip && logs.filter(function (m) { return m.indexOf(ids2[0]) >= 0; }).length === 1 && rows(e2, e2.ctx.APP_CONFIG.sheets.send).length === 0, String(err) + JSON.stringify(r2) + logs.join('|'));
  ok('T12 Drive 全体の検索（Files.list）を使わない', !/Files\.list|DriveApp\.(search|getFiles)/.test(require('fs').readFileSync(require('path').join(B, 'Pdf.gs'), 'utf8') + require('fs').readFileSync(require('path').join(B, 'Code.gs'), 'utf8')));
})();
var n = res.filter(Boolean).length;
console.log('\n' + n + ' OK / ' + (res.length - n) + ' NG (total ' + res.length + ')');
process.exit(n === res.length ? 0 : 1);
