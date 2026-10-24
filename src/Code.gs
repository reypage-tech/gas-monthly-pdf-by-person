/**
 * 日報シートから、担当者ごとの月次PDFをまとめて作り、担当者ごとのフォルダに保存する。
 * PDFを作ったら、担当者あての送信予定を「送信予定」シートに記録する（記録だけ。実際には送らない・共有しない）。同じ期間・担当者のPDFは二度作らない（作成記録で確認）。
 * 使う部品：Common（共通）・Pdf（PDF作成）・Notify（エラーは通知文を記録するだけ）
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('日報PDF').addItem('先月分を作る（送信は記録だけ）', 'makeLastMonth').addItem('デモの月（2026-10）を作る', 'makeDemoMonth').addItem('デモを最初に戻す', 'resetDemo').addToUi();
}

function makeLastMonth() { return makeReports(lastMonth_()); }

/** デモの月（架空データの 2026-10）を作る。今日の日付に関係なく試せる */
function makeDemoMonth() { return makeReports(APP_CONFIG.demoMonth); }

function lastMonth_() {
  var ym = todayStr_().slice(0, 7).split('-').map(Number);
  var y = ym[1] === 1 ? ym[0] - 1 : ym[0], m = ym[1] === 1 ? 12 : ym[1] - 1;
  return y + '-' + ('0' + m).slice(-2);
}

/** ym：'2026-10' の形。戻り値 { ok, made, skipped, pending, errors, files:[...] } */
function makeReports(ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym))) throw new Error('期間は yyyy-MM で指定してください: ' + ym);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'BUSY' };
  try {
    return makeReportsLocked_(ym);
  } catch (err) {
    alertRecord_({ 対象: ym, エラー: String(err && err.message || err).slice(0, 200) });
    return { ok: false, code: 'ERROR' };
  } finally {
    lock.releaseLock();
  }
}

function makeReportsLocked_(ym) {
  var c = APP_CONFIG, H = c.reportHeader;
  var res = { ok: true, made: 0, skipped: 0, pending: 0, errors: 0, files: [] };
  var staff = readStaff_();
  var rep = getOrCreateSheet_(c.sheets.reports, H);
  var byPerson = {};
  readRows_(rep, H.length).forEach(function (r, i) {
    var o = {}; H.forEach(function (h, j) { o[h] = r[j]; });
    if (String(o['日付']) === '' && String(o['担当者']) === '') return;
    var ymd = cellYmd_(o['日付']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) { res.errors += alertOnce_(ym + ' ' + (i + 2) + '行目', '日付が読めません：' + String(o['日付']).slice(0, 20)); return; }
    if (ymd.slice(0, 7) !== ym) return;
    var p = String(o['担当者']);
    if (!staff[p]) { res.errors += alertOnce_(ym + ' ' + (i + 2) + '行目', '担当者一覧にいません：' + p.slice(0, 20)); return; }
    o['日付'] = ymd;
    (byPerson[p] = byPerson[p] || []).push(o);
  });

  var made = madeKeys_();
  Object.keys(staff).forEach(function (p) {
    var list = byPerson[p];
    if (!list) return; // その月の日報が無い人はPDFを作らない
    if (made[ym + '|' + p]) { res.skipped++; return; }
    if (res.made >= c.maxPerRun) { res.pending++; return; }
    list.sort(function (a, b) { return a['日付'] < b['日付'] ? -1 : a['日付'] > b['日付'] ? 1 : 0; });
    var values = [H].concat(list.map(function (o) { return H.map(function (h) { return String(o[h]); }); }));
    var folderId = ensureFolder_(p, staff);
    var r = pdfFromRange_({ values: values, label: ym + '_' + safeFileName_(p), folderId: folderId,
      lines: ['担当者：' + p, '期間：' + ym, '件数：' + list.length + '件'] });
    appendTextRow_(getOrCreateSheet_(c.sheets.made, c.madeHeader), [ym, p, r.fileName, r.fileId, list.length, dateTimeStr_(now_())].map(safeCell_));
    sendRecord_(ym, p, r);
    made[ym + '|' + p] = true;
    res.made++; res.files.push({ person: p, fileName: r.fileName, folderId: folderId, rows: list.length });
  });
  return res;
}

/** 送信の代わりに、送る予定の内容を記録するだけ（メールの仕組みは使わない） */
function sendRecord_(ym, person, r) {
  var c = APP_CONFIG, S = c.send;
  appendTextRow_(getOrCreateSheet_(c.sheets.send, S.header), [dateTimeStr_(now_()), ym, person,
    S.subject.replace('{期間}', ym), r.fileName, r.fileId, S.status].map(safeCell_));
}

/** 担当者シート：{ 名前: { row, folderId } } */
function readStaff_() {
  var c = APP_CONFIG, sh = getOrCreateSheet_(c.sheets.staff, c.staffHeader), out = {};
  readRows_(sh, 2).forEach(function (r, i) { var n = String(r[0]).trim(); if (n) out[n] = { row: i + 2, folderId: String(r[1] || '') }; });
  return out;
}

/** 担当者ごとのフォルダ。無ければこのスクリプトで作る（drive.file の権限で扱えるのは自分で作ったものだけ） */
function ensureFolder_(p, staff) {
  var c = APP_CONFIG, s = staff[p];
  if (s.folderId) return s.folderId;
  var props = PropertiesService.getScriptProperties(), key = c.propPrefix + 'rootFolder';
  var root = props.getProperty(key);
  if (!root) { root = Drive.Files.create({ name: c.rootFolderName, mimeType: 'application/vnd.google-apps.folder' }).id; props.setProperty(key, root); }
  var id = Drive.Files.create({ name: p, mimeType: 'application/vnd.google-apps.folder', parents: [root] }).id;
  SpreadsheetApp.getActive().getSheetByName(c.sheets.staff).getRange(s.row, 2, 1, 1).setValues([[id]]);
  s.folderId = id;
  return id;
}

function madeKeys_() {
  var c = APP_CONFIG, out = {};
  readRows_(getOrCreateSheet_(c.sheets.made, c.madeHeader), 2).forEach(function (r) { out[String(r[0]) + '|' + String(r[1])] = true; });
  return out;
}

function safeFileName_(s) { return String(s).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 40); }

/** 同じ内容の通知は二度記録しない。記録したら 1、済みなら 0 */
function alertOnce_(target, msg) {
  var c = APP_CONFIG;
  var log = readRows_(getOrCreateSheet_(c.sheets.noticeLog, c.notify.logHeader), 4);
  if (log.some(function (r) { return String(r[1]) === target && String(r[3]).indexOf(msg) !== -1; })) return 0;
  alertRecord_({ 対象: target, エラー: msg });
  return 1;
}

function alertRecord_(info) {
  var o = { 宛先: APP_CONFIG.notify.to };
  Object.keys(info).forEach(function (k) { o[k] = info[k]; });
  return notifyRecord_(o);
}

/** デモを最初に戻す：架空の日報と担当者を入れ直し、作成記録・送信予定・ログを空にする（作ったPDFは消さない） */
function resetDemo() {
  var c = APP_CONFIG;
  // 記録にある古いPDFだけをゴミ箱へ（表を消す前に読む）
  var trash = pdfTrashRecorded_([{ sheet: c.sheets.made, header: c.madeHeader, col: 'ファイルID' }, { sheet: c.sheets.send, header: c.send.header, col: 'ファイルID' }]);
  var rep = getOrCreateSheet_(c.sheets.reports, c.reportHeader);
  rep.clearContents(); setTextFormat_(rep, c.reportHeader.length);
  rep.getRange(1, 1, 1 + DEMO_REPORTS.length, c.reportHeader.length).setValues([c.reportHeader].concat(DEMO_REPORTS));
  var st = getOrCreateSheet_(c.sheets.staff, c.staffHeader);
  st.clearContents(); setTextFormat_(st, 2);
  st.getRange(1, 1, 1 + DEMO_STAFF.length, 2).setValues([c.staffHeader].concat(DEMO_STAFF.map(function (n) { return [n, '']; })));
  var md = getOrCreateSheet_(c.sheets.made, c.madeHeader);
  md.clearContents(); setTextFormat_(md, c.madeHeader.length);
  md.getRange(1, 1, 1, c.madeHeader.length).setValues([c.madeHeader]);
  var sd = getOrCreateSheet_(c.sheets.send, c.send.header);
  sd.clearContents(); setTextFormat_(sd, c.send.header.length);
  sd.getRange(1, 1, 1, c.send.header.length).setValues([c.send.header]);
  notifyResetLog_();
  PropertiesService.getScriptProperties().deleteProperty(c.propPrefix + 'rootFolder');
  return { trashed: trash.trashed, skipped: trash.skipped.length };
}

/** 1行を書式なしテキストにしてから書く（実際のシートで日時や数字が日付型・時刻型に変わり、「9:11:06」のような表示や読み違いにならないように） */
function appendTextRow_(sh, row) {
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return r;
}
