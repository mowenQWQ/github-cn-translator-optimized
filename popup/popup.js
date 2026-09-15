(function () {
  'use strict';

  var toggleBtn = document.getElementById('toggleBtn');
  var statusText = document.getElementById('statusText');
  var aiStatusText = document.getElementById('aiStatusText');
  var aiCard = document.getElementById('aiCard');
  var aiToggleBtn = document.getElementById('aiToggleBtn');
  var aiDetailText = document.getElementById('aiDetailText');
  var aiCacheBadge = document.getElementById('aiCacheBadge');
  var openSettingsBtn = document.getElementById('openSettingsBtn');

  function getCurrentTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs.length > 0) {
        callback(tabs[0]);
      } else {
        callback(null);
      }
    });
  }

  function updateUI(enabled) {
    toggleBtn.checked = enabled;
    if (enabled) {
      statusText.textContent = '翻译已启用 - 页面正在自动翻译中';
      statusText.className = 'status-text enabled';
    } else {
      statusText.textContent = '翻译已禁用 - 页面显示原始英文';
      statusText.className = 'status-text disabled';
    }
  }

  function updateAiUI(status) {
    if (!status) {
      aiCard.style.display = 'none';
      return;
    }

    aiCard.style.display = 'block';

    if (!status.configured) {
      aiToggleBtn.checked = false;
      aiToggleBtn.disabled = true;
      aiDetailText.textContent = '未配置 API Key - 请在设置中填写';
      aiDetailText.style.color = '#cf222e';
    } else if (status.enabled) {
      aiToggleBtn.checked = true;
      aiToggleBtn.disabled = false;
      aiDetailText.textContent = '已启用' + (status.translating ? ' - 翻译中...' : '');
      aiDetailText.style.color = '#1a7f37';
    } else {
      aiToggleBtn.checked = false;
      aiToggleBtn.disabled = false;
      aiDetailText.textContent = '已配置，但未启用';
      aiDetailText.style.color = '#656d76';
    }

    if (status.cacheSize > 0) {
      aiCacheBadge.style.display = 'inline-block';
      aiCacheBadge.textContent = '已缓存 ' + status.cacheSize + ' 条';
    } else {
      aiCacheBadge.style.display = 'none';
    }
  }

  function checkStatus() {
    getCurrentTab(function (tab) {
      if (!tab || !tab.url || (tab.url.indexOf('github.com') === -1 && tab.url.indexOf('github.io') === -1)) {
        statusText.textContent = '请在 GitHub 页面上使用此插件';
        statusText.className = 'status-text';
        toggleBtn.disabled = true;
        aiCard.style.display = 'none';
        return;
      }

      toggleBtn.disabled = false;

      chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, function (response) {
        if (chrome.runtime.lastError) {
          chrome.storage.sync.get(['ghCnEnabled'], function (result) {
            updateUI(result.ghCnEnabled !== false);
          });
          loadLocalAiStatus();
          return;
        }
        if (response) {
          updateUI(response.enabled);
        }
      });

      chrome.tabs.sendMessage(tab.id, { action: 'getAiStatus' }, function (response) {
        if (chrome.runtime.lastError || !response) {
          loadLocalAiStatus();
          return;
        }
        updateAiUI(response);
      });
    });
  }

  function loadLocalAiStatus() {
    chrome.storage.local.get(['ghAiEnabled', 'ghAiApiKey'], function (result) {
      updateAiUI({
        enabled: result.ghAiEnabled === true,
        configured: !!result.ghAiApiKey,
        cacheSize: 0,
        translating: false
      });
    });
  }

  toggleBtn.addEventListener('change', function () {
    var enabled = toggleBtn.checked;
    chrome.storage.sync.set({ ghCnEnabled: enabled });

    getCurrentTab(function (tab) {
      if (!tab) return;
      var action = enabled ? 'enableTranslation' : 'disableTranslation';
      chrome.tabs.sendMessage(tab.id, { action: action }, function () {
        updateUI(enabled);
      });
    });
  });

  aiToggleBtn.addEventListener('change', function () {
    var enabled = aiToggleBtn.checked;

    getCurrentTab(function (tab) {
      if (!tab) return;
      var action = enabled ? 'enableAiTranslation' : 'disableAiTranslation';
      chrome.tabs.sendMessage(tab.id, { action: action }, function (response) {
        if (chrome.runtime.lastError || !response) {
          chrome.storage.local.set({ ghAiEnabled: enabled });
          updateAiUI({
            enabled: enabled,
            configured: true,
            cacheSize: 0,
            translating: false
          });
          return;
        }
        updateAiUI(response);
      });
    });
  });

  openSettingsBtn.addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  document.addEventListener('DOMContentLoaded', function () {
    // 动态统计字典词条数（从加载的 locales/*.js 实时计算），不再硬编码
    var g = window.GITHUB_TRANSLATIONS || {};
    var countMap = {
      uiCount: g.ui ? Object.keys(g.ui).length : 0,
      moduleCount: g.modules ? Object.keys(g.modules).length : 0,
      docsCount: g.docs ? Object.keys(g.docs).length : 0,
      commonCount: g.common ? Object.keys(g.common).length : 0
    };
    Object.keys(countMap).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = countMap[id] ? (countMap[id] + '+') : '-';
      }
    });

    // 版本号从 manifest 读取，避免硬编码失真
    var versionEl = document.querySelector('.version');
    if (versionEl && chrome.runtime && chrome.runtime.getManifest) {
      versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    checkStatus();
  });
})();
