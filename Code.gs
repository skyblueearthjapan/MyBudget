// MyBudget — Google Apps Script web app
// 家計簿アプリ。データはユーザー単位の PropertiesService に月単位で分割保存。
// (PropertiesService の上限 9KB/値 を回避するため、月ごとに別キーで保存する)

const KEY_PREFIX = 'mybudget__';
const MAX_VALUE_BYTES = 8500; // 余裕を持って 9KB 以下

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('MyBudget — 家計簿')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getBudgets() {
  const props = PropertiesService.getUserProperties().getProperties();
  const result = {};
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(KEY_PREFIX) === 0) {
      const month = k.substring(KEY_PREFIX.length);
      try { result[month] = JSON.parse(props[k]); } catch (e) {}
    }
  });
  if (Object.keys(result).length === 0) return '';
  return JSON.stringify(result);
}

function saveBudgets(json) {
  if (typeof json !== 'string' || !json) {
    throw new Error('saveBudgets: payload must be a non-empty string');
  }
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('saveBudgets: payload must be an object');
  }
  const toSet = {};
  Object.keys(parsed).forEach(function (month) {
    const value = JSON.stringify(parsed[month]);
    if (value.length > MAX_VALUE_BYTES) {
      throw new Error('saveBudgets: month payload too large for ' + month);
    }
    toSet[KEY_PREFIX + month] = value;
  });
  const props = PropertiesService.getUserProperties();
  const existing = props.getProperties();
  Object.keys(existing).forEach(function (k) {
    if (k.indexOf(KEY_PREFIX) === 0 && !(k in toSet)) {
      props.deleteProperty(k);
    }
  });
  props.setProperties(toSet);
  return true;
}

function resetBudgets() {
  const props = PropertiesService.getUserProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(KEY_PREFIX) === 0) props.deleteProperty(k);
  });
  return true;
}

// ---- Gemini analysis ---------------------------------------------------
// 音声入力の発話を「支出/収入」「既存項目への上書き or 新規追加」「金額/支払日」に
// 分類するため Gemini API を呼ぶ。API キーは ScriptProperties に保存する。
//
// 設定方法:
//   1. GAS エディタ → プロジェクトの設定 → スクリプトプロパティ
//      キー: GEMINI_API_KEY  値: <自分の Gemini API key>
//   または
//   2. エディタで `setGeminiApiKey('your-key')` を一度実行

const GEMINI_MODEL = 'gemini-2.5-flash';

function setGeminiApiKey(key) {
  if (!key || typeof key !== 'string') throw new Error('setGeminiApiKey: key required');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return true;
}

function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

function analyzeUtterance(payload) {
  if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) {
    return { error: 'TEXT_REQUIRED' };
  }
  const apiKey = getGeminiApiKey_();
  if (!apiKey) return { error: 'API_KEY_MISSING' };

  const expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  const incomes  = Array.isArray(payload.incomes)  ? payload.incomes  : [];

  const fmtList = function (rows) {
    if (!rows.length) return '(なし)';
    return rows.map(function (r) {
      return '- ' + r.id + ': ' + r.name + ' (現在額 ¥' + (r.amount || 0) + ')';
    }).join('\n');
  };

  const prompt = [
    'あなたは家計簿アプリの音声入力を分析するアシスタントです。',
    'ユーザーの発話を JSON で構造化してください。',
    '',
    '【既存の支出項目】',
    fmtList(expenses),
    '',
    '【既存の収入項目】',
    fmtList(incomes),
    '',
    '【発話】「' + payload.text + '」',
    '',
    '【判定ルール】',
    '- kind: "expense" (支出) か "income" (収入)。「給料」「ボーナス」「収入」「報酬」「売上」など稼ぎは income、それ以外は expense。',
    '- matchedItemId: 発話の項目名が既存項目と意味的に一致すればその id (例 "e2") を返す。明確に一致するものが無ければ "" (空文字)。略称や漢字/カナの揺れは許容 (例「楽天」→「楽天カード」、「au」→「au自分銀行」)。',
    '- name: 項目名。matchedItemId がある場合はその既存項目名を再現。新規ならその語 (例「コンビニ」)。',
    '- amount: 金額 (円単位の整数)。「12000円」「1万2千円」「1.2万」は全て 12000。',
    '- due: 支払日があれば "M/D" 形式 (例 "4/10")、無ければ ""。',
    '',
    'JSON だけを返してください。'
  ].join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          kind:          { type: 'string', enum: ['expense', 'income'] },
          matchedItemId: { type: 'string' },
          name:          { type: 'string' },
          amount:        { type: 'number' },
          due:           { type: 'string' }
        },
        required: ['kind', 'matchedItemId', 'name', 'amount', 'due']
      },
      temperature: 0.1
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { error: 'FETCH_FAILED', detail: String(e).substring(0, 300) };
  }

  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) {
    return { error: 'API_ERROR', status: code, detail: text.substring(0, 400) };
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: 'OUTER_PARSE_ERROR' }; }
  const candidate = data && data.candidates && data.candidates[0];
  const partText = candidate && candidate.content && candidate.content.parts &&
                   candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!partText) return { error: 'EMPTY_RESPONSE' };
  let parsed;
  try { parsed = JSON.parse(partText); } catch (e) {
    return { error: 'JSON_PARSE_ERROR', raw: partText.substring(0, 200) };
  }
  if (parsed.kind !== 'expense' && parsed.kind !== 'income') {
    return { error: 'INVALID_KIND', raw: parsed };
  }
  return {
    kind: parsed.kind,
    matchedItemId: parsed.matchedItemId || '',
    name: parsed.name || '',
    amount: Math.round(Number(parsed.amount) || 0),
    due: parsed.due || ''
  };
}
