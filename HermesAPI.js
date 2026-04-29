// HermesAPI.gs - Hermes Agent から JSON API でアクセスするためのエンドポイント
// 既存の Code.js のロジック (getBudgets/saveBudgets/analyzeUtterance) を流用。

const HERMES_BUDGET_TOKEN_KEY = 'MYBUDGET_API_TOKEN';

function setupHermesApiToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(HERMES_BUDGET_TOKEN_KEY);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(HERMES_BUDGET_TOKEN_KEY, token);
  }
  console.log('=== MyBudget Hermes API Token ===');
  console.log(token);
  console.log('=================================');
  return token;
}

function regenerateHermesApiToken() {
  PropertiesService.getScriptProperties().deleteProperty(HERMES_BUDGET_TOKEN_KEY);
  return setupHermesApiToken();
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty(HERMES_BUDGET_TOKEN_KEY);
    if (!expected) return jsonResponse_({ ok: false, error: 'MYBUDGET_API_TOKEN not configured. Run setupHermesApiToken() once.' });
    if (body.token !== expected) return jsonResponse_({ ok: false, error: 'unauthorized' });

    const action = body.action;
    const params = body.params || {};
    let result;
    switch (action) {
      case 'ping':         result = { ok: true, pong: new Date().toISOString() }; break;
      case 'list':         result = handleList_(params); break;
      case 'summary':      result = handleSummary_(params); break;
      case 'add_expense':  result = handleAddItem_(params, 'expenses'); break;
      case 'add_income':   result = handleAddItem_(params, 'incomes'); break;
      case 'multi_add':    result = handleMultiAdd_(params); break;
      case 'update_item':  result = handleUpdateItem_(params); break;
      case 'delete_item':  result = handleDeleteItem_(params); break;
      case 'analyze':      result = handleAnalyze_(params); break;
      default:             result = { ok: false, error: 'unknown action: ' + String(action) };
    }
    return jsonResponse_(result);
  } catch (err) {
    console.error('doPost error:', err && err.stack);
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _readAll() {
  const raw = getBudgets();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function _writeAll(obj) { saveBudgets(JSON.stringify(obj)); }

function _ensureMonth(all, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  if (!all[month]) {
    // UI と同じ挙動: 新規月は target より前の最新月から「項目・金額」を全部複製
    const priorKeys = Object.keys(all).filter(function (k) {
      return /^\d{4}-\d{2}$/.test(k) && k < month;
    }).sort();
    if (priorKeys.length > 0) {
      const src = all[priorKeys[priorKeys.length - 1]] || {};
      all[month] = {
        expenses: (src.expenses || []).map(function (r) {
          return { id: r.id, name: r.name, amount: Number(r.amount) || 0, due: '' };
        }),
        incomes: (src.incomes || []).map(function (r) {
          return { id: r.id, name: r.name, amount: Number(r.amount) || 0, due: '' };
        })
      };
    } else {
      all[month] = { expenses: [], incomes: [] };
    }
  }
  if (!Array.isArray(all[month].expenses)) all[month].expenses = [];
  if (!Array.isArray(all[month].incomes))  all[month].incomes  = [];
  return all[month];
}

function _findByName_(rows, name) {
  const norm = function (s) { return String(s || '').trim().toLowerCase(); };
  const target = norm(name);
  for (let i = 0; i < rows.length; i++) {
    if (norm(rows[i].name) === target) return { index: i, item: rows[i] };
  }
  return null;
}

function _nextId(rows, prefix) {
  let maxN = 0;
  rows.forEach(function (r) {
    const m = /^([ei])(\d+)$/.exec(String(r.id || ''));
    if (m && m[1] === prefix) {
      const n = parseInt(m[2], 10);
      if (n > maxN) maxN = n;
    }
  });
  return prefix + (maxN + 1);
}

function _normalizeAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(v) || 0);
}

function _findItem(monthBlock, id) {
  for (let i = 0; i < monthBlock.expenses.length; i++) {
    if (monthBlock.expenses[i].id === id) return { kind: 'expenses', index: i, item: monthBlock.expenses[i] };
  }
  for (let i = 0; i < monthBlock.incomes.length; i++) {
    if (monthBlock.incomes[i].id === id) return { kind: 'incomes', index: i, item: monthBlock.incomes[i] };
  }
  return null;
}

function handleList_(params) {
  const all = _readAll();
  if (params.month) {
    if (!/^\d{4}-\d{2}$/.test(params.month)) return { ok: false, error: 'month must be YYYY-MM' };
    const block = all[params.month] || { expenses: [], incomes: [] };
    return { ok: true, month: params.month, expenses: block.expenses || [], incomes: block.incomes || [] };
  }
  return { ok: true, months: Object.keys(all).sort(), data: all };
}

function handleSummary_(params) {
  if (!params.month) return { ok: false, error: 'month required' };
  if (!/^\d{4}-\d{2}$/.test(params.month)) return { ok: false, error: 'month must be YYYY-MM' };
  const all = _readAll();
  const block = all[params.month] || { expenses: [], incomes: [] };
  const expSum = (block.expenses || []).reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
  const incSum = (block.incomes  || []).reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
  return {
    ok: true, month: params.month,
    income_total: incSum, expense_total: expSum, balance: incSum - expSum,
    expense_count: (block.expenses || []).length, income_count: (block.incomes || []).length
  };
}

function handleAddItem_(params, kind) {
  if (!params.month || !params.name) return { ok: false, error: 'month and name required' };
  if (!/^\d{4}-\d{2}$/.test(params.month)) return { ok: false, error: 'month must be YYYY-MM' };
  const all = _readAll();
  const block = _ensureMonth(all, params.month);
  const rows = block[kind];

  // upsert: 同名項目があれば更新、なければ新規追加
  const dup = _findByName_(rows, params.name);
  if (dup) {
    if (params.amount !== undefined) dup.item.amount = _normalizeAmount(params.amount);
    if (params.due !== undefined)    dup.item.due = String(params.due || '');
    _writeAll(all);
    return { ok: true, month: params.month, kind: kind, action: 'updated', item: dup.item };
  }
  const prefix = (kind === 'expenses') ? 'e' : 'i';
  const item = {
    id: _nextId(rows, prefix),
    name: String(params.name),
    amount: _normalizeAmount(params.amount),
    due: String(params.due || '')
  };
  rows.push(item);
  _writeAll(all);
  return { ok: true, month: params.month, kind: kind, action: 'added', item: item };
}

function handleMultiAdd_(params) {
  const items = Array.isArray(params.items) ? params.items : null;
  if (!items || !items.length) return { ok: false, error: 'items array required' };
  const all = _readAll();
  const results = [];
  let okCount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.month || !it.name || (it.kind !== 'expense' && it.kind !== 'income')) {
      results.push({ index: i, ok: false, error: 'kind/month/name required' });
      continue;
    }
    if (!/^\d{4}-\d{2}$/.test(it.month)) {
      results.push({ index: i, ok: false, error: 'month must be YYYY-MM' });
      continue;
    }
    try {
      const block = _ensureMonth(all, it.month);
      const kindKey = (it.kind === 'expense') ? 'expenses' : 'incomes';
      const dup = _findByName_(block[kindKey], it.name);
      if (dup) {
        if (it.amount !== undefined) dup.item.amount = _normalizeAmount(it.amount);
        if (it.due !== undefined)    dup.item.due = String(it.due || '');
        results.push({ index: i, ok: true, month: it.month, kind: kindKey, action: 'updated', item: dup.item });
      } else {
        const prefix = (it.kind === 'expense') ? 'e' : 'i';
        const newItem = {
          id: _nextId(block[kindKey], prefix),
          name: String(it.name),
          amount: _normalizeAmount(it.amount),
          due: String(it.due || '')
        };
        block[kindKey].push(newItem);
        results.push({ index: i, ok: true, month: it.month, kind: kindKey, action: 'added', item: newItem });
      }
      okCount++;
    } catch (e) {
      results.push({ index: i, ok: false, error: String(e.message || e) });
    }
  }
  if (okCount > 0) _writeAll(all);
  return { ok: okCount === items.length, count: items.length, success: okCount, results: results };
}

function handleUpdateItem_(params) {
  if (!params.month || !params.id) return { ok: false, error: 'month and id required' };
  const all = _readAll();
  const block = all[params.month];
  if (!block) return { ok: false, error: 'month not found' };
  const found = _findItem(block, params.id);
  if (!found) return { ok: false, error: 'item not found' };
  const item = found.item;
  if (params.name !== undefined)   item.name = String(params.name);
  if (params.amount !== undefined) item.amount = _normalizeAmount(params.amount);
  if (params.due !== undefined)    item.due = String(params.due || '');
  _writeAll(all);
  return { ok: true, month: params.month, kind: found.kind, item: item };
}

function handleDeleteItem_(params) {
  if (!params.month || !params.id) return { ok: false, error: 'month and id required' };
  const all = _readAll();
  const block = all[params.month];
  if (!block) return { ok: false, error: 'month not found' };
  const found = _findItem(block, params.id);
  if (!found) return { ok: false, error: 'item not found' };
  block[found.kind].splice(found.index, 1);
  _writeAll(all);
  return { ok: true, month: params.month, deleted: found.item };
}

function handleAnalyze_(params) {
  if (!params.text) return { ok: false, error: 'text required' };
  let expenses = [], incomes = [];
  if (params.month) {
    const all = _readAll();
    const block = all[params.month];
    if (block) {
      expenses = block.expenses || [];
      incomes  = block.incomes  || [];
    }
  }
  const result = analyzeUtterance({ text: params.text, expenses: expenses, incomes: incomes });
  if (result && result.error) return { ok: false, error: result.error, detail: result };
  return { ok: true, parsed: result };
}
