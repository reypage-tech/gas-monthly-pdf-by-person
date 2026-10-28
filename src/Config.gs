/** 設定：架空の設備点検会社（現場の日報から、担当者ごとの月次PDFをまとめて作るデモ）。業種ごとの値はここだけに置く */
var APP_CONFIG = {
  tz: 'Asia/Tokyo',
  propPrefix: 'rep_',
  demoMonth: '2026-09', // 架空データの月（makeDemoMonth で作る）
  sheets: { reports: '日報', staff: '担当者', made: '作成記録', noticeLog: 'エラー通知ログ', send: '送信予定' },
  reportHeader: ['日付', '担当者', '現場', '作業内容', '状況', '備考'],
  staffHeader: ['担当者', 'フォルダID'],
  madeHeader: ['期間', '担当者', 'ファイル名', 'ファイルID', '件数', '作成日時'],
  receipt: { label: '対象' },
  statuses: ['完了', '継続', '要再訪'],
  rootFolderName: '日報PDF（架空デモ）',
  maxPerRun: 10, // 1回の実行で作る最大数。残りは次の実行で続きから
  pdf: { title: '月次 作業日報', note: '※架空の会社・人物・現場によるデモです。', fileNamePrefix: '日報', dailyLimit: 50, folderId: '' },
  // 送信は記録だけ（実際には送らない）。本番で送るときは、送信先・文面・条件を確かめてから別に作る
  send: {
    header: ['記録日時', '期間', '宛先', '件名', 'ファイル名', 'ファイルID', '状態'],
    subject: '{期間} の月次日報（PDF）',
    status: '未送信（記録のみ）'
  },
  notify: {
    logHeader: ['記録日時', '対象', '宛先', '通知文'],
    toColumn: '宛先',
    to: '管理者（架空）',
    template: ['{宛先} さん', '日報PDFの作成で止まったものがあります。', '対象：{対象}', '内容：{エラー}', 'エラー通知ログと日報シートを確認してください。']
  }
};
