'use strict';

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.storage.sync.set({ ghCnEnabled: true });
    chrome.storage.local.set({ ghAiEnabled: false });
  } else if (details.reason === 'update') {
    console.log('[GitHub中文翻译] 插件已更新至版本 ' + chrome.runtime.getManifest().version);
  }
});

chrome.action.onClicked.addListener(function (tab) {
  if (tab.url && (tab.url.indexOf('github.com') > -1 || tab.url.indexOf('github.io') > -1)) {
    chrome.storage.sync.get(['ghCnEnabled'], function (result) {
      var newState = !result.ghCnEnabled;
      chrome.storage.sync.set({ ghCnEnabled: newState });

      var action = newState ? 'enableTranslation' : 'disableTranslation';
      chrome.tabs.sendMessage(tab.id, { action: action }, function () {
        if (chrome.runtime.lastError) {}
      });
    });
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === 'getSettings') {
    chrome.storage.sync.get(['ghCnEnabled'], function (result) {
      sendResponse({ enabled: result.ghCnEnabled !== false });
    });
    return true;
  }

  if (message.action === 'aiProxyFetch') {
    // API Key 只在 background 读取并注入，content script 不接触明文 key（安全加固）。
    // options 页测试时若自带 Authorization（页面里临时填的 key），优先用它的。
    chrome.storage.local.get(['ghAiApiKey'], function (result) {
      var headers = message.headers || {};
      if (result.ghAiApiKey && !headers.Authorization && message.addAuth !== false) {
        headers = Object.assign({}, headers, { 'Authorization': 'Bearer ' + result.ghAiApiKey });
      }

      // 加超时：API 挂起时不再无限等待，避免 sendResponse 永不返回 / SW 休眠
      var controller = new AbortController();
      var timeout = setTimeout(function () {
        controller.abort();
      }, 45000);

      fetch(message.url, {
        method: message.method || 'POST',
        headers: headers,
        body: message.body || null,
        signal: controller.signal
      })
        .then(function (response) {
          return response.text().then(function (text) {
            sendResponse({
              success: response.ok,
              status: response.status,
              body: text
            });
          });
        })
        .catch(function (error) {
          sendResponse({
            success: false,
            error: (error && error.name === 'AbortError') ? '请求超时' : (error.message || '网络错误')
          });
        })
        .finally(function () {
          clearTimeout(timeout);
        });
    });
    return true;
  }
});
