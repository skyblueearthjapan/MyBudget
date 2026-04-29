# MyBudget — 家計簿アプリ

スマホ向けに最適化された月別家計簿アプリ。Google Apps Script (GAS) Web App として動作。

## 機能

- 月別タブで家計簿の切り替え（4月から開始、ボタンで月追加）
- タップでその場でインライン編集（項目名・金額・支払日）
- 「家計簿」/「分析」の 2 画面切り替え
- 分析画面: 収支推移グラフ、月別比較、貯蓄率、前月比、支出 TOP5
- 音声入力で項目追加（Web Speech API、未対応端末はサンプル入力デモ）
- 自動保存（GAS の `PropertiesService` にユーザー単位で保存。ローカルストレージにもフォールバック）

## ファイル構成

```
appsscript.json     GAS マニフェスト
Code.gs             サーバ側エントリ (doGet + 永続化 API)
index.html          メイン HTML (テンプレート)
styles.html         CSS
data.html           初期データ + 共通ヘルパ + ストレージブリッジ
voice.html          音声入力モーダル
budget.html         家計簿一覧画面
analytics.html      分析画面
app.html            ルート React コンポーネント (App)
preview.html        ローカル動作確認用 (GAS には不要)
```

## デプロイ手順

### A. clasp を使う場合（推奨）

```sh
npm i -g @google/clasp
clasp login
clasp push --force
clasp deploy --description "v1"
```

`.clasp.json` に script ID は設定済み。

### B. GAS エディタに手で貼り付ける場合

1. <https://script.google.com/u/0/home/projects/1l3ozLQltRg7pCWtGPXHr2CjvWJV7qqq80D_SOlZBNXEgFwbGYjULBOaP/edit> を開く
2. 既存ファイルを削除し、上記の各ファイルを同名で作成（HTML はファイル → 新規 → HTML）
3. 各ファイルの内容をコピー＆ペースト
4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」→ 「自分」「自分のみ」→ デプロイ
5. 発行された URL をスマホのホーム画面に追加

## ローカル動作確認

```sh
python -m http.server 8000
# ブラウザで http://localhost:8000/preview.html を開く
```

ローカルでは `google.script.run` が無いので `localStorage` にフォールバック保存される。

## カスタマイズ

`app.html` 上部の以下を編集すると見た目が変わる:

```js
const ACCENT = '#c8941d';   // アクセントカラー
const SHOW_DUE_DATE = true; // 支払日を表示
const COMPACT = false;      // コンパクト表示
```

## Gemini API キーの設定（音声入力 AI 解析）

音声入力は Gemini で「支出/収入の判定」「既存項目との一致判定」「金額/支払日の抽出」を行います。
キー未設定の場合はローカル正規表現にフォールバックします。

設定方法:

1. <https://aistudio.google.com/apikey> で API キーを取得
2. GAS エディタを開く → 左の「⚙ プロジェクトの設定」
3. 「スクリプト プロパティ」セクションで **キー: `GEMINI_API_KEY`** / **値: 自分のキー** を追加して保存

または、エディタ上で `setGeminiApiKey('your-key-here')` 関数を一度だけ実行しても OK。

モデルは `gemini-2.5-flash` 固定（`Code.gs` の `GEMINI_MODEL` で変更可）。

## データ永続化について

GAS の `PropertiesService` (UserProperties) を使用。月単位で別キーに保存しているので
1 つの値が 9KB 上限を超えにくい設計。全データは 500KB まで保存可能。

データ削除は画面下部の「サンプルデータに戻す」ボタンから。
