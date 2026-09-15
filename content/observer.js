var GITHUB_TRANSLATIONS = window.GITHUB_TRANSLATIONS || {};

(function () {
  'use strict';

  var observer = null;
  var burstTimers = [];
  var cooldownTimer = null;
  var translating = false;

  // MutationObserver 增量处理：把 DOM 变化产生的节点聚合后一次性翻译，避免全树反复扫描
  var pendingRoots = [];
  var pendingTimer = null;

  function queueRoot(el) {
    if (!el || !el.nodeType) return;
    if (pendingRoots.indexOf(el) !== -1) return;
    pendingRoots.push(el);
    scheduleIncrementalFlush();
  }

  function scheduleIncrementalFlush() {
    if (pendingTimer) return;
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      var roots = pendingRoots;
      pendingRoots = [];
      if (roots.length === 0) return;
      if (!GITHUB_TRANSLATIONS.translator || !GITHUB_TRANSLATIONS.translator.isEnabled()) return;
      GITHUB_TRANSLATIONS.translator.translateRoots(roots);
    }, 80);
  }

  function clearBurst() {
    burstTimers.forEach(function (timer) {
      clearTimeout(timer);
    });
    burstTimers = [];
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }

  function doTranslate() {
    if (translating) return;
    translating = true;
    try {
      if (GITHUB_TRANSLATIONS.translator && GITHUB_TRANSLATIONS.translator.isEnabled()) {
        GITHUB_TRANSLATIONS.translator.translatePage(document.body);
      }
    } finally {
      setTimeout(function () {
        translating = false;
      }, 50);
    }
  }

  function launchBurst() {
    clearBurst();
    // 增量 MutationObserver 已覆盖懒加载内容，burst 只做初始页面/导航的兜底重扫
    var delays = [0, 300, 1500];
    delays.forEach(function (delay) {
      var timer = setTimeout(function () {
        doTranslate();
        burstTimers = burstTimers.filter(function (t) { return t !== timer; });
      }, delay);
      burstTimers.push(timer);
    });

    cooldownTimer = setTimeout(function () {
      burstTimers = [];
      cooldownTimer = null;
    }, 2000);
  }

  function isCodeContext(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE' ||
        tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'NOSCRIPT') {
      return true;
    }
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      return true;
    }
    if (el.closest) {
      return !!(
        el.closest('pre') || el.closest('code') || el.closest('[contenteditable="true"]') ||
        el.closest('.blob-code-inner') || el.closest('.blob-code')
      );
    }
    return false;
  }

  function startObserving() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(function (mutations) {
      var hasNew = false;

      mutations.forEach(function (mutation) {
        switch (mutation.type) {
          case 'childList':
            var added = mutation.addedNodes;
            for (var i = 0; i < added.length; i++) {
              var node = added[i];
              if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                queueRoot(node);
                hasNew = true;
              }
            }
            break;

          case 'characterData':
            var t = mutation.target;
            if (!t || !t.parentElement) return;
            if (isCodeContext(t.parentElement)) return;
            // 文本内容变化（如 React 动态更新）
            queueRoot(t);
            hasNew = true;
            break;

          case 'attributes':
            var attrEl = mutation.target;
            if (!attrEl || !attrEl.nodeType) return;
            queueRoot(attrEl);
            hasNew = true;
            break;
        }
      });

      // 增量队列已接管新内容，不再触发全树 burst 重扫。
      // 未翻译完的节点由 translator.translateRoots 里的元素级 data-gh-cn 标记去重。
    });

    var root = document.documentElement || document.body;

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // 相比原版去掉了 hidden/open：GitHub 折叠面板、下拉菜单高频切换这两个属性，
      // 容易触发无意义的全树扫描。懒加载内容由 childList 变更兜住。
      attributeFilter: [
        'placeholder',
        'aria-label',
        'title',
        'data-tooltip',
        'data-content',
        'aria-description'
      ]
    });
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearBurst();
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingRoots = [];
  }

  function initTurboListener() {
    function onNav() {
      launchBurst();
    }

    document.addEventListener('turbo:load', onNav);
    document.addEventListener('turbo:frame-load', onNav);
    document.addEventListener('turbo:render', onNav);
    document.addEventListener('soft-nav:end', onNav);
    window.addEventListener('popstate', onNav);
  }

  GITHUB_TRANSLATIONS.observer = {
    start: startObserving,
    stop: stopObserving,
    initTurboListener: initTurboListener,
    launchBurst: launchBurst
  };
})();