// content.js – Reddit edition
let blockedUsers = [];
let observer = null;
let showPlaceholders = true;

const loadData = () =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getBlockedUsers" }, (res) => {
      blockedUsers = res?.blockedUsers || [];
      chrome.storage.sync.get(["showPlaceholders"], (r) => {
        showPlaceholders = r.showPlaceholders !== false;
        resolve();
      });
    });
  });

const extractUsername = (el) => {
  const authorEl = el.querySelector('a[href*="/user/"]');
  if (!authorEl) return null;
  const m = authorEl.href.match(/reddit\.com\/user\/([^/?]+)/i);
  return m ? m[1].toLowerCase() : null;
};

const addPlaceholder = (el, text) => {
  if (!showPlaceholders || el.nextElementSibling?.classList.contains('blocked-placeholder')) return;
  const p = document.createElement('div');
  p.className = 'blocked-placeholder';
  p.textContent = text;
  el.parentNode.insertBefore(p, el.nextSibling);
};

const hideBlocked = () => {
  document.querySelectorAll('shreddit-comment:not(.blocked-processed)').forEach(cmt => {
    cmt.classList.add('blocked-processed');
    const user = extractUsername(cmt);
    if (!user || !blockedUsers.includes(user)) return;

    cmt.classList.add('blocked-comment');
    cmt.style.display = 'none';
    addPlaceholder(cmt, `Comment from blocked user “${user}” hidden`);
  });
};

const refresh = () => {
  document.querySelectorAll('.blocked-processed').forEach(el => el.classList.remove('blocked-processed'));
  document.querySelectorAll('.blocked-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.blocked-comment').forEach(el => (el.style.display = ''));
  hideBlocked();
};

const init = async () => {
  if (!location.hostname.includes('reddit.com')) return;
  await loadData();
  hideBlocked();

  if (observer) observer.disconnect();
  observer = new MutationObserver(() => setTimeout(hideBlocked, 100));
  observer.observe(document.body, { childList: true, subtree: true });
};

chrome.runtime.onMessage.addListener((req) => {
  if (req.action === "userBlocked" || req.action === "refreshBlocking") {
    loadData().then(refresh);
  }
  if (req.action === "settingsChanged") {
    showPlaceholders = req.showPlaceholders;
    showPlaceholders ? refresh() : document.querySelectorAll('.blocked-placeholder').forEach(el => (el.style.display = 'none'));
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else init();

let url = location.href;
new MutationObserver(() => {
  if (location.href !== url) {
    url = location.href;
    setTimeout(init, 1000);
  }
}).observe(document, { childList: true, subtree: true });