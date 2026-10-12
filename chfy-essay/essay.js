(function () {
  'use strict';

  var memoryStore = {};

  function getStore() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (error) {
      return null;
    }
    return null;
  }

  function getStoredItem(key) {
    var store = getStore();
    if (store) return store.getItem(key);
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
  }

  function setStoredItem(key, value) {
    var store = getStore();
    if (store) {
      store.setItem(key, value);
      return;
    }
    memoryStore[key] = value;
  }

  function removeStoredItem(key) {
    var store = getStore();
    if (store) {
      store.removeItem(key);
      return;
    }
    delete memoryStore[key];
  }

  function storageKey(type, key) {
    return 'chfy-essay:' + type + ':' + key;
  }

  function markEssayPage() {
    var essay = document.querySelector('.chfy-essay-page');
    if (!essay) return;
    document.documentElement.classList.add('chfy-essay-doc');
    document.body && document.body.classList.add('chfy-essay-body');
    var page = essay.closest('#page');
    if (page) page.classList.add('chfy-essay-paper');
  }

  function bindPreview() {
    markEssayPage();
    document.querySelectorAll('.chfy-essay-image').forEach(function (trigger) {
      var img = trigger.querySelector('img');
      trigger.classList.add('fancybox');
      trigger.setAttribute('data-fancybox', trigger.getAttribute('data-fancybox') || 'chfy-essay');
      if (img) img.removeAttribute('data-no-fancybox');
    });
  }

  function setLoadMoreText(button, visibleCount, totalCount) {
    if (!button) return;
    if (visibleCount >= totalCount) {
      button.textContent = '已加载全部（' + totalCount + '）条说说';
      button.disabled = true;
      button.classList.add('is-complete');
    } else {
      button.textContent = '加载更多说说';
      button.disabled = false;
      button.classList.remove('is-complete');
    }
  }

  function bindLoadMore() {
    var button = document.querySelector('.chfy-essay-load-more');
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-chfy-essay-card]'));
    if (!button || !cards.length) return;
    if (button.dataset.chfyEssayLoadBound === 'true') return;

    var initial = Number(button.dataset.chfyEssayInitial || 9);
    var step = Number(button.dataset.chfyEssayStep || 6);
    var total = cards.length;
    var visible = Math.min(Number.isFinite(initial) && initial > 0 ? initial : 9, total);

    function applyVisible() {
      cards.forEach(function (card, index) {
        card.classList.toggle('is-hidden', index >= visible);
      });
      setLoadMoreText(button, visible, total);
    }

    button.dataset.chfyEssayLoadBound = 'true';
    applyVisible();
    button.addEventListener('click', function () {
      visible = Math.min(visible + (Number.isFinite(step) && step > 0 ? step : 6), total);
      applyVisible();
    });
  }

  function likeApiEndpoint() {
    var page = document.querySelector('.chfy-essay-page');
    return page && page.dataset.chfyEssayLikeApi ? page.dataset.chfyEssayLikeApi.trim() : '';
  }

  function buttonBase(button) {
    var base = Number(button.dataset.chfyEssayBase || 0);
    return Number.isFinite(base) && base > 0 ? base : 0;
  }

  function likedKey(key) {
    return storageKey('liked', key);
  }

  function localLikeKey(key) {
    return storageKey('likes', key);
  }

  function readLocalLikes(key) {
    var number = Number(getStoredItem(localLikeKey(key)));
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function writeLocalLikes(key, value) {
    setStoredItem(localLikeKey(key), String(Math.max(0, Number(value || 0))));
  }

  function renderLike(button, serverCount) {
    var key = button.dataset.chfyEssayKey;
    var count = button.querySelector('.chfy-essay-like-count');
    var liked = getStoredItem(likedKey(key)) === '1';
    var total = buttonBase(button) + Math.max(0, Number(serverCount || 0));

    button.dataset.chfyEssayServerCount = String(Math.max(0, Number(serverCount || 0)));
    button.classList.toggle('is-liked', liked);
    if (count) count.textContent = String(total);
  }

  function serverCount(button) {
    var value = Number(button && button.dataset ? button.dataset.chfyEssayServerCount : 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function likeButtonsForKey(key) {
    return Array.prototype.slice.call(document.querySelectorAll('.chfy-essay-like')).filter(function (button) {
      return button.dataset.chfyEssayKey === key;
    });
  }

  function applyLikeState(key, liked, count) {
    if (liked) setStoredItem(likedKey(key), '1');
    else removeStoredItem(likedKey(key));

    likeButtonsForKey(key).forEach(function (button) {
      renderLike(button, count);
      setLikeUnavailable(button, false);
    });
  }

  function requestJson(url, options) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, options || {})).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new Error(data && data.error && data.error.message ? data.error.message : 'Like service unavailable');
        }
        return data;
      });
    });
  }

  function setLikeUnavailable(button, unavailable) {
    button.classList.toggle('is-unavailable', unavailable);
    if (unavailable) button.title = '点赞服务暂不可用';
    else button.removeAttribute('title');
  }

  function loadGlobalLikes(buttons) {
    var endpoint = likeApiEndpoint();
    if (!endpoint) {
      buttons.forEach(function (button) {
        var key = button.dataset.chfyEssayKey;
        renderLike(button, readLocalLikes(key));
        setLikeUnavailable(button, false);
      });
      return;
    }

    var keys = buttons.map(function (button) {
      return button.dataset.chfyEssayKey;
    }).filter(Boolean).filter(function (key, index, list) {
      return list.indexOf(key) === index;
    });

    if (!keys.length || typeof fetch !== 'function') {
      buttons.forEach(function (button) {
        renderLike(button, 0);
        setLikeUnavailable(button, true);
      });
      return;
    }

    var params = new URLSearchParams();
    keys.forEach(function (key) {
      params.append('keys', key);
    });

    requestJson(endpoint + '?' + params.toString(), { method: 'GET' })
      .then(function (data) {
        buttons.forEach(function (button) {
          var key = button.dataset.chfyEssayKey;
          var count = data.counts && Object.prototype.hasOwnProperty.call(data.counts, key) ? data.counts[key] : 0;
          renderLike(button, count);
          setLikeUnavailable(button, false);
        });
      })
      .catch(function () {
        buttons.forEach(function (button) {
          renderLike(button, button.dataset.chfyEssayServerCount || 0);
          setLikeUnavailable(button, true);
        });
      });
  }

  function updateLike(button) {
    var key = button && button.dataset ? button.dataset.chfyEssayKey : '';
    if (!key) return;

    var liked = getStoredItem(likedKey(key)) === '1';
    var delta = liked ? -1 : 1;
    var endpoint = likeApiEndpoint();
    var beforeLiked = liked;
    var beforeCount = serverCount(button);
    var optimisticCount = Math.max(0, beforeCount + delta);

    if (!endpoint) {
      var localCount = Math.max(0, readLocalLikes(key) + delta);
      writeLocalLikes(key, localCount);
      applyLikeState(key, delta > 0, localCount);
      return;
    }

    if (button.classList.contains('is-loading')) return;
    applyLikeState(key, delta > 0, optimisticCount);
    likeButtonsForKey(key).forEach(function (target) {
      target.classList.add('is-loading');
    });
    button.classList.add('is-loading');
    requestJson(endpoint, {
      method: 'POST',
      body: JSON.stringify({ key: key, delta: delta })
    }).then(function (data) {
      applyLikeState(key, delta > 0, data.count || 0);
    }).catch(function () {
      applyLikeState(key, beforeLiked, beforeCount);
      likeButtonsForKey(key).forEach(function (target) {
        setLikeUnavailable(target, true);
      });
    }).finally(function () {
      likeButtonsForKey(key).forEach(function (target) {
        target.classList.remove('is-loading');
      });
    });
  }

  function bindLikeDelegate() {
    if (document.documentElement.dataset.chfyEssayLikeDelegate === 'true') return;
    document.documentElement.dataset.chfyEssayLikeDelegate = 'true';
    document.addEventListener('click', function (event) {
      if (event.chfyEssayLikeHandled) return;
      var button = event.target && event.target.closest ? event.target.closest('.chfy-essay-like') : null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.chfyEssayLikeHandled = true;
      updateLike(button);
    }, false);
  }

  function bindLikes() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.chfy-essay-like'));
    if (!buttons.length) return;

    buttons.forEach(function (button) {
      var key = button.dataset.chfyEssayKey;
      if (!key) return;
      renderLike(button, button.dataset.chfyEssayServerCount || 0);
    });

    bindLikeDelegate();
    loadGlobalLikes(buttons);
  }

  function findCommentEditor() {
    return document.querySelector('#post-comment textarea')
      || document.querySelector('.tk-input textarea')
      || document.querySelector('.el-textarea__inner')
      || document.querySelector('textarea')
      || document.querySelector('#post-comment [contenteditable="true"]')
      || document.querySelector('[contenteditable="true"]');
  }

  function insertText(editor, text) {
    if (!editor) return false;
    if (editor.isContentEditable) {
      editor.focus();
      document.execCommand('insertText', false, text);
      return true;
    }

    var value = editor.value || '';
    var start = typeof editor.selectionStart === 'number' ? editor.selectionStart : value.length;
    var end = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : start;
    editor.value = value.slice(0, start) + text + value.slice(end);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.focus();
    editor.selectionStart = editor.selectionEnd = start + text.length;
    return true;
  }

  function bindComments() {
    if (document.documentElement.dataset.chfyEssayCommentDelegate === 'true') return;
    document.documentElement.dataset.chfyEssayCommentDelegate = 'true';
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('.chfy-essay-comment') : null;
      if (!link) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      var title = link.dataset.chfyEssayTitle || '这条说说';
      var target = document.querySelector('#post-comment');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      setTimeout(function () {
        var editor = findCommentEditor();
        var prefix = '> ' + title + '\n\n';
        insertText(editor, prefix);
        if (!editor && target) target.setAttribute('data-chfy-essay-reply', title);
      }, 360);
    }, true);
  }

  function bindEssayActions() {
    bindPreview();
    bindLoadMore();
    bindLikes();
    bindComments();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEssayActions);
  } else {
    bindEssayActions();
  }

  document.addEventListener('pjax:complete', bindEssayActions);
  window.chfyEssayToggleLike = function (button, event) {
    if (event) {
      if (event.chfyEssayLikeHandled) return;
      event.preventDefault();
      event.stopPropagation();
      event.chfyEssayLikeHandled = true;
    }
    updateLike(button);
  };
  window.chfyEssayBindEssayActions = bindEssayActions;
})();
