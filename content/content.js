(function () {
  'use strict';

  if (!window.GITHUB_TRANSLATIONS) {
    return;
  }

  function init() {
    var translator = GITHUB_TRANSLATIONS.translator;
    var observer = GITHUB_TRANSLATIONS.observer;
    var aiTranslator = GITHUB_TRANSLATIONS.aiTranslator;

    if (!translator) {
      return;
    }

    if (aiTranslator) {
      aiTranslator.reloadConfig(function () {
        startTranslation();
      });
    } else {
      startTranslation();
    }

    function startTranslation() {
      chrome.storage.sync.get(['ghCnEnabled'], function (result) {
        if (result.ghCnEnabled !== false) {
          translator.setEnabled(true);
          observer.launchBurst();
        }

        observer.initTurboListener();
        observer.start();
      });
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    var translator = GITHUB_TRANSLATIONS.translator;
    var observer = GITHUB_TRANSLATIONS.observer;
    var aiTranslator = GITHUB_TRANSLATIONS.aiTranslator;

    switch (message.action) {
      case 'toggleTranslation':
        if (!translator) return;
        var enabled = translator.toggleEnabled();
        if (enabled) observer.launchBurst();
        sendResponse({ enabled: enabled });
        break;

      case 'enableTranslation':
        if (!translator) return;
        translator.setEnabled(true);
        observer.launchBurst();
        sendResponse({ enabled: true });
        break;

      case 'disableTranslation':
        if (!translator) return;
        translator.setEnabled(false);
        sendResponse({ enabled: false });
        break;

      case 'getStatus':
        if (!translator) return;
        sendResponse({ enabled: translator.isEnabled() });
        break;

      case 'getAiStatus':
        if (!aiTranslator) {
          sendResponse({ enabled: false, configured: false, cacheSize: 0, translating: false });
        } else {
          sendResponse(aiTranslator.getStatus());
        }
        break;

      case 'enableAiTranslation':
        if (!aiTranslator) return;
        aiTranslator.setAiEnabled(true);
        observer.launchBurst();
        sendResponse(aiTranslator.getStatus());
        break;

      case 'disableAiTranslation':
        if (!aiTranslator) return;
        aiTranslator.setAiEnabled(false);
        sendResponse(aiTranslator.getStatus());
        break;

      case 'reloadAiConfig':
        if (!aiTranslator) return;
        aiTranslator.reloadConfig(function () {
          if (aiTranslator.isAiEnabled()) {
            observer.launchBurst();
          }
        });
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
