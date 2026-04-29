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
