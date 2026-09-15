var GITHUB_TRANSLATIONS = window.GITHUB_TRANSLATIONS || {};

(function () {
  'use strict';

  // 用 Object.create(null) 防原型链污染（toString/constructor/__proto__）
  var aiCache = Object.create(null);
  var aiCacheOrder = [];
  var shortQueue = [];
  var longQueue = [];
  var flushTimer = null;
  var translating = false;
  var aiEnabled = false;
  var SHORT_BATCH_SIZE = 20;
  var FLUSH_INTERVAL = 800;
  var MAX_RETRIES = 2;
  var MAX_QUEUE = 300; // 上限防止超大页面塞爆队列
  var CACHE_LIMIT = 2000; // 内存缓存上限
  var cacheSaveTimer = null;

  var config = {
    apiKey: '',
    apiEndpoint: '',
    model: '',
    systemPrompt: '',
    longPrompt: ''
  };

  function loadConfig(callback) {
    chrome.storage.local.get(['ghAiApiKey', 'ghAiEndpoint', 'ghAiModel', 'ghAiPrompt', 'ghAiEnabled'], function (result) {
      // 不把明文 key 留在 content script，仅记录配置是否就绪（安全加固）
      config.apiKey = result.ghAiApiKey ? 'configured' : '';
      config.apiEndpoint = result.ghAiEndpoint || 'https://api.openai.com/v1/chat/completions';
      config.model = result.ghAiModel || 'gpt-3.5-turbo';
      config.systemPrompt = result.ghAiPrompt || 'You are a professional translator. Translate the following English text into Simplified Chinese. The context is GitHub website UI, documentation, or code-related content. Only return the translated text, separated by "|||". Do not add any explanation.';
      config.longPrompt = '你是一名专业的技术翻译。请将以下英文段落翻译为简体中文。上下文为 GitHub 网站的技术文档、README、Issue 描述或评论内容。请保留原有格式（换行、列表标记等），只翻译文本内容，不要翻译代码块。只返回翻译后的中文文本，不要添加任何解释。';
      aiEnabled = result.ghAiEnabled === true;
      if (callback) callback();
    });
  }

  function saveAiEnabled() {
    chrome.storage.local.set({ ghAiEnabled: aiEnabled });
  }

  function loadCache() {
    chrome.storage.local.get(['ghAiCache'], function (result) {
      if (result.ghAiCache && typeof result.ghAiCache === 'object') {
        var saved = result.ghAiCache;
        var keys = [];
        for (var k in saved) {
          if (Object.prototype.hasOwnProperty.call(saved, k)) {
            keys.push(k);
          }
        }
        // 保持插入顺序（V8 会按插入顺序枚举，足够近似）
        for (var i = 0; i < keys.length && aiCacheOrder.length < CACHE_LIMIT; i++) {
          var k = keys[i];
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          aiCache[k] = saved[k];
          aiCacheOrder.push(k);
        }
      }
    });
  }

  function scheduleCacheSave() {
    if (cacheSaveTimer) return;
    cacheSaveTimer = setTimeout(function () {
      cacheSaveTimer = null;
      saveCache();
    }, 2000);
  }

  function saveCache() {
    var toSave = Object.create(null);
    var count = 0;
    for (var i = 0; i < aiCacheOrder.length && count < CACHE_LIMIT; i++) {
      var k = aiCacheOrder[i];
      var v = aiCache[k];
      if (v && typeof v === 'string' && v.length > 0) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        toSave[k] = v;
        count++;
      }
    }
    chrome.storage.local.set({ ghAiCache: toSave }, function () {});
  }

  function cacheGet(key) {
    if (Object.prototype.hasOwnProperty.call(aiCache, key)) return aiCache[key];
    return undefined;
  }

  function cacheSet(key, val) {
    if (!Object.prototype.hasOwnProperty.call(aiCache, key)) {
      aiCacheOrder.push(key);
    }
    aiCache[key] = val;
    while (aiCacheOrder.length > CACHE_LIMIT) {
      var old = aiCacheOrder.shift();
      delete aiCache[old];
    }
    scheduleCacheSave();
  }

  function getTranslationKey(text) {
    return text.trim();
  }

  function queueShortTranslations(texts, textElements) {
    if (!aiEnabled || !config.apiKey) return;
    queueItems(texts, textElements, 'short');
  }

  function queueLongTranslations(texts, textElements) {
    if (!aiEnabled || !config.apiKey) return;
    queueItems(texts, textElements, 'long');
  }

  function queueItems(texts, textElements, type) {
    var targetQueue = type === 'short' ? shortQueue : longQueue;
    var maxLen = type === 'short' ? 300 : 5000;

    for (var i = 0; i < texts.length; i++) {
      var text = texts[i];
      var key = getTranslationKey(text);
      if (!key || key.length < 3 || key.length > maxLen) continue;
      // 分隔协议 ||| 出现时跳过，避免 AI 批量返回拆分错位
      if (key.indexOf('|||') >= 0) continue;
      // 原型键防护
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (cacheGet(key) !== undefined) continue;

      var isPending = false;
      for (var p = 0; p < targetQueue.length; p++) {
        if (targetQueue[p].key === key) { isPending = true; break; }
      }
      if (isPending) continue;

      // 队列上限防护
      if (targetQueue.length >= MAX_QUEUE) {
        // 已满，不再追加
        break;
      }

      targetQueue.push({
        key: key,
        text: text,
        element: textElements ? textElements[i] : null
      });
    }

    scheduleFlush();
  }

  function scheduleFlush() {
    var totalPending = shortQueue.length + longQueue.length;
    if (totalPending === 0) return;

    if (shortQueue.length >= SHORT_BATCH_SIZE || longQueue.length > 0) {
      flushNow();
      return;
    }

    if (flushTimer) return;

    flushTimer = setTimeout(function () {
      flushTimer = null;
      flushNow();
    }, FLUSH_INTERVAL);
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (translating) return;

    if (longQueue.length > 0) {
      var longItem = longQueue.shift();
      translateLong(longItem, 0);
      return;
    }

    if (shortQueue.length === 0) return;

    var batch = shortQueue.splice(0, SHORT_BATCH_SIZE);

    if (batch.length === 0) return;

    translating = true;
    sendShortBatch(batch, 0);
  }

  function translateLong(item, retryCount) {
    translating = true;

    var body = {
      model: config.model,
      messages: [
        { role: 'system', content: config.longPrompt },
        { role: 'user', content: item.text }
      ],
      temperature: 0.2,
      max_tokens: Math.min(4096, Math.max(512, Math.ceil(item.text.length * 2)))
    };

    var headers = {
      'Content-Type': 'application/json'
      // Authorization 由 background 注入，减少 content script 暴露面
    };

    chrome.runtime.sendMessage({
      action: 'aiProxyFetch',
      url: config.apiEndpoint,
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, function (response) {
      if (chrome.runtime.lastError || !response || !response.success) {
        handleLongError(item, retryCount);
        return;
      }

      try {
        var data = JSON.parse(response.body);
        if (data.error) {
          handleLongError(item, retryCount);
          return;
        }

        var content = '';
        if (data.choices && data.choices[0] && data.choices[0].message) {
          content = data.choices[0].message.content;
        }

        if (!content || content === item.text) {
          cacheSet(item.key, null);
        } else {
          cacheSet(item.key, content.trim());
        }

        applyTranslationToElement(item);
        finishBatch();
      } catch (e) {
        handleLongError(item, retryCount);
      }
    });
  }

  function handleLongError(item, retryCount) {
    if (retryCount < MAX_RETRIES) {
      setTimeout(function () {
        translateLong(item, retryCount + 1);
      }, (retryCount + 1) * 2000);
    } else {
      cacheSet(item.key, null);
      finishBatch();
    }
  }

  function sendShortBatch(batch, retryCount) {
    var texts = [];
    for (var i = 0; i < batch.length; i++) {
      texts.push(batch[i].text);
    }

    var sourceTexts = texts.join('|||');

    var body = {
      model: config.model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: sourceTexts }
      ],
      temperature: 0.1,
      max_tokens: 3000
    };

    var headers = {
      'Content-Type': 'application/json'
    };

    chrome.runtime.sendMessage({
      action: 'aiProxyFetch',
      url: config.apiEndpoint,
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, function (response) {
      if (chrome.runtime.lastError || !response || !response.success) {
        handleShortBatchError(batch, retryCount);
        return;
      }

      try {
        var data = JSON.parse(response.body);
        if (data.error) {
          handleShortBatchError(batch, retryCount);
          return;
        }

        var content = '';
        if (data.choices && data.choices[0] && data.choices[0].message) {
          content = data.choices[0].message.content;
        } else if (data.response) {
          content = data.response;
        }

        if (!content) {
          handleShortBatchError(batch, retryCount);
          return;
        }

        var translations = content.split('|||');

        for (var j = 0; j < batch.length; j++) {
          var item = batch[j];
          var translation = (translations[j] || '').trim();

          if (!translation || translation === item.text) {
            cacheSet(item.key, null);
          } else {
            cacheSet(item.key, translation);
          }

          applyTranslationToElement(item);
        }

        finishBatch();
      } catch (e) {
        handleShortBatchError(batch, retryCount);
      }
    });
  }

  function handleShortBatchError(batch, retryCount) {
    if (retryCount < MAX_RETRIES) {
      setTimeout(function () {
        sendShortBatch(batch, retryCount + 1);
      }, (retryCount + 1) * 1500);
    } else {
      for (var i = 0; i < batch.length; i++) {
        cacheSet(batch[i].key, null);
      }
      finishBatch();
    }
  }

  function applyTranslationToElement(item) {
    var cached = cacheGet(item.key);
    if (!cached || !item.element) return;

    try {
      var el = item.element;
      // 支持 TEXT_NODE 直接替换
      if (el.nodeType === Node.TEXT_NODE) {
        if (el.textContent.trim() === item.text.trim()) {
          el.textContent = cached;
          if (el.parentElement) {
            el.parentElement.setAttribute('data-gh-cn', '1');
          }
        }
        return;
      }
      // 元素节点：只在内容完全匹配时替换，避免覆盖用户后续编辑
      if (el.tagName) {
        var children = el.childNodes;
        var hasOnlyText = true;
        for (var i = 0; i < children.length; i++) {
          if (children[i].nodeType !== Node.TEXT_NODE) {
            hasOnlyText = false;
            break;
          }
        }
        if (hasOnlyText && el.textContent.trim() === item.text.trim()) {
          el.textContent = cached;
          el.setAttribute('data-gh-cn', '1');
        }
      }
    } catch (e) {}
  }

  function finishBatch() {
    translating = false;

    if (longQueue.length > 0 || shortQueue.length > 0) {
      setTimeout(function () {
        flushNow();
      }, 100);
    }
  }

  function getCachedTranslation(text) {
    if (!aiEnabled || !config.apiKey) return null;
    var key = getTranslationKey(text);
    var cached = cacheGet(key);
    if (cached) return cached;
    return null;
  }

  function isAiEnabled() {
    return aiEnabled && !!config.apiKey;
  }

  function setAiEnabled(value) {
    aiEnabled = value;
    saveAiEnabled();
  }

  function toggleAiEnabled() {
    aiEnabled = !aiEnabled;
    saveAiEnabled();
    return aiEnabled;
  }

  function getStatus() {
    var cacheCount = 0;
    for (var k in aiCache) {
      if (Object.prototype.hasOwnProperty.call(aiCache, k) && aiCache[k]) {
        cacheCount++;
      }
    }
    return {
      enabled: aiEnabled,
      configured: !!config.apiKey,
      queueSize: shortQueue.length + longQueue.length,
      cacheSize: cacheCount,
      translating: translating
    };
  }

  function reloadConfig(callback) {
    loadConfig(function () {
      // 配置变更后重新加载缓存（缓存键不变，旧缓存仍可用）
      if (callback) callback();
    });
  }

  loadConfig();
  loadCache();

  GITHUB_TRANSLATIONS.aiTranslator = {
    queueShortTranslations: queueShortTranslations,
    queueLongTranslations: queueLongTranslations,
    getCachedTranslation: getCachedTranslation,
    isAiEnabled: isAiEnabled,
    setAiEnabled: setAiEnabled,
    toggleAiEnabled: toggleAiEnabled,
    getStatus: getStatus,
    reloadConfig: reloadConfig
  };
})();