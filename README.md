# eng-sentence(英文学習)

TOEIC 対策の、**英文を勉強する**アプリ。英文を、表のように選んで学びます。単語を学ぶアプリは、別に作ります(元になったのは [eng-study](https://github.com/minnanosaiban/eng-study))。

試作: [英文構造アナライザー](https://github.com/minnanosaiban/eng-analyzer)

## できること

- 登録: サンプル英文 90 文(API 不要)/ 貼り付け / .csv・.txt・.json(バックアップ)。AI での解析は、Gemini API か、コピペモード(無料)
- 学習対象選択: 表で、チェック・ランダム・グループ・状態・難易度・間違いで絞り込む
- 英文の画面: 全文の和訳、[/] で意味の区切り( / )に切り替え、区切りごとの訳・発音記号、品詞の色付け・文構造(S V O C M)・文法区切り・文法の解説・TOEIC の観点、単語・熟語の表、4択問題、間違いの記録
- 音声: ▶ で全文または区切りを順に聞く。「間」を入れるとシャドーイング。区切りをクリックして、その区切りだけを繰り返し聞く。語をなぞって選ぶと、その部分だけ聞ける。音のつながり(ゆっくり → ふつうの速さ)
- 記録と復習: 日ごとの復習の数、弱点(間違えた分類)、復習を始める
- 同期(暗号化したクラウド同期)と受信箱(Claude Code などから英文を預ける)

試すには、`public/` を、静的サーバーで開きます(例: `python -m http.server -d public`)。

## フォルダ

```
docs/         設計メモ
public/       アプリ本体(index.html、style.css、js/、vendor/、samples/)
public/dict/     発音辞書(cmudict-ipa.txt。tools/build-pron.mjs で作る)
src/          同期 API・受信箱(Cloudflare Worker。暗号文の保存・取得だけ)
migrations/   D1 のテーブル定義(0001 同期、0002 受信箱)
tools/        inbox-send.mjs(受信箱へ預ける)、build-pron.mjs(発音辞書を作る)
```

## 同期のローカル実行

```bash
npx wrangler d1 migrations apply eng-sentence-db --local
```

```bash
npx wrangler dev --var SETUP_CODE:localtest
```

## 公開(Cloudflare)

1. `npx wrangler d1 create eng-sentence-db` で D1 を作り、表示された `database_id` を `wrangler.jsonc` に書く
2. `npx wrangler d1 migrations apply eng-sentence-db --remote`
3. `npx wrangler secret put SETUP_CODE`(保管庫を作るときのセットアップコード)
4. `npx wrangler deploy`

## ライセンス

[MIT License](LICENSE)

## 外部素材

- 発音辞書: [CMU Pronouncing Dictionary](http://www.speech.cs.cmu.edu/cgi-bin/cmudict)(Carnegie Mellon University)。npm の cmu-pronouncing-dictionary(ISC)から取り出して、IPA に変換したものを `public/dict/` に同梱(`public/dict/NOTICE.txt` 参照)
- QR コード: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)(MIT、Kazuhiko Arase。`public/vendor/qrcode.js` に同梱)

