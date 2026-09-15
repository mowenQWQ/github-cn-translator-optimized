(function () {
  'use strict';

  var PRESETS = {
    openai:    { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' },
    deepseek:  { endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
    zhipu:     { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
    moonshot:  { endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
    qwen:      { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo' },
    ollama:    { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3' }
  };

  var dictToggle = document.getElementById('dictToggle');
  var aiToggle = document.getElementById('aiToggle');
  var aiSettingsSection = document.getElementById('aiSettingsSection');
  var apiEndpoint = document.getElementById('apiEndpoint');
  var apiKey = document.getElementById('apiKey');
  var toggleKeyBtn = document.getElementById('toggleKeyBtn');
  var modelSelect = document.getElementById('modelSelect');
  var customModelField = document.getElementById('customModelField');
  var customModel = document.getElementById('customModel');
  var systemPrompt = document.getElementById('systemPrompt');
  var saveBtn = document.getElementById('saveBtn');
  var testBtn = document.getElementById('testBtn');
  var testResult = document.getElementById('testResult');
  var saveStatus = document.getElementById('saveStatus');

  function loadSettings() {
    chrome.storage.sync.get(['ghCnEnabled'], function (r) {
      dictToggle.checked = r.ghCnEnabled !== false;
    });

    chrome.storage.local.get(['ghAiEnabled', 'ghAiApiKey', 'ghAiEndpoint', 'ghAiModel', 'ghAiPrompt'], function (r) {
      aiToggle.checked = r.ghAiEnabled === true;
      apiKey.value = r.ghAiApiKey || '';
      apiEndpoint.value = r.ghAiEndpoint || PRESETS.openai.endpoint;
      systemPrompt.value = r.ghAiPrompt || '你是一名专业翻译。将以下英文翻译为简体中文，上下文为 GitHub 网站界面、文档或代码相关内容。只返回翻译后的中文文本，多项之间用 ||| 分隔。不要添加任何解释。';

      var savedModel = r.ghAiModel || PRESETS.openai.model;
      var presetModels = ['gpt-3.5-turbo','gpt-4o-mini','gpt-4o','deepseek-chat','deepseek-reasoner','glm-4-flash','moonshot-v1-8k','qwen-turbo'];
      if (presetModels.indexOf(savedModel) >= 0) {
        modelSelect.value = savedModel;
        customModelField.style.display = 'none';
      } else {
        modelSelect.value = 'custom';
        customModel.value = savedModel;
        customModelField.style.display = 'block';
      }

      updateAiVisibility();
    });
  }

  function updateAiVisibility() {
    aiSettingsSection.style.display = aiToggle.checked ? 'block' : 'none';
  }

  function getSelectedModel() {
    if (modelSelect.value === 'custom') {
      return customModel.value.trim() || 'custom-model';
    }
    return modelSelect.value;
  }

  function saveSettings() {
    chrome.storage.sync.set({ ghCnEnabled: dictToggle.checked });
    chrome.storage.local.set({
      ghAiEnabled: aiToggle.checked,
      ghAiApiKey: apiKey.value.trim(),
      ghAiEndpoint: apiEndpoint.value.trim(),
      ghAiModel: getSelectedModel(),
      ghAiPrompt: systemPrompt.value.trim()
    }, function () {
      showSaveStatus('success', '设置已保存');

      chrome.tabs.query({ url: '*://github.com/*' }, function (tabs) {
        for (var i = 0; i < tabs.length; i++) {
          chrome.tabs.sendMessage(tabs[i].id, { action: 'reloadAiConfig' }, function () {});
        }
      });
    });
  }

  function showSaveStatus(type, msg) {
    saveStatus.textContent = msg;
    saveStatus.className = 'save-status ' + type;
    setTimeout(function () {
      saveStatus.textContent = '';
      saveStatus.className = 'save-status';
    }, 2500);
  }

  function testConnection() {
    var endpoint = apiEndpoint.value.trim();
    var key = apiKey.value.trim();

    if (!key) {
      testResult.textContent = '请先填写 API Key';
      testResult.className = 'test-result error';
      return;
    }
    if (!endpoint) {
      testResult.textContent = '请填写 API 端点地址';
      testResult.className = 'test-result error';
      return;
    }

    testResult.textContent = '测试中...';
    testResult.className = 'test-result loading';
    testBtn.disabled = true;

    // 通过 background 代理发起请求，避免 options 页 CORS 限制，并统一超时处理
    chrome.runtime.sendMessage({
      action: 'aiProxyFetch',
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: getSelectedModel(),
        messages: [
          { role: 'user', content: 'Translate to Chinese: Hello' }
        ],
        max_tokens: 20
      })
    }, function (response) {
      testBtn.disabled = false;
      if (chrome.runtime.lastError || !response || !response.success) {
        testResult.textContent = '连接失败: ' + ((response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '网络错误');
        testResult.className = 'test-result error';
        return;
      }

      try {
        var data = JSON.parse(response.body);
        if (response.status >= 200 && response.status < 300 && data.choices && data.choices[0]) {
          testResult.textContent = '连接成功！模型返回: ' + (data.choices[0].message.content || '(空)');
          testResult.className = 'test-result success';
        } else {
          testResult.textContent = 'API 错误: ' + (data.error ? data.error.message : 'HTTP ' + response.status);
          testResult.className = 'test-result error';
        }
      } catch (e) {
        testResult.textContent = 'API 响应解析失败: ' + (response.body || '');
        testResult.className = 'test-result error';
      }
    });
  }

  aiToggle.addEventListener('change', updateAiVisibility);

  modelSelect.addEventListener('change', function () {
    if (modelSelect.value === 'custom') {
      customModelField.style.display = 'block';
    } else {
      customModelField.style.display = 'none';
    }
  });

  toggleKeyBtn.addEventListener('click', function () {
    if (apiKey.type === 'password') {
      apiKey.type = 'text';
      toggleKeyBtn.textContent = '🙈';
    } else {
      apiKey.type = 'password';
      toggleKeyBtn.textContent = '👁️';
    }
  });

  var presetBtns = document.querySelectorAll('.preset-btn');
  for (var i = 0; i < presetBtns.length; i++) {
    presetBtns[i].addEventListener('click', function () {
      var presetName = this.getAttribute('data-preset');
      var preset = PRESETS[presetName];
      if (!preset) return;

      apiEndpoint.value = preset.endpoint;

      var presetModels = ['gpt-3.5-turbo','gpt-4o-mini','gpt-4o','deepseek-chat','deepseek-reasoner','glm-4-flash','moonshot-v1-8k','qwen-turbo'];
      if (presetModels.indexOf(preset.model) >= 0) {
        modelSelect.value = preset.model;
        customModelField.style.display = 'none';
      } else {
        modelSelect.value = 'custom';
        customModel.value = preset.model;
        customModelField.style.display = 'block';
      }

      for (var j = 0; j < presetBtns.length; j++) {
        presetBtns[j].classList.remove('active');
      }
      this.classList.add('active');
    });
  }

  saveBtn.addEventListener('click', saveSettings);
  testBtn.addEventListener('click', testConnection);

  document.getElementById('backToPopup').addEventListener('click', function (e) {
    e.preventDefault();
    window.close();
  });

  loadSettings();
})();
