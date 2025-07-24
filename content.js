// content.js – instant on-page blocking
let blockedUsers = [];
let observer = null;

const loadData = () =>
  new Promise(r => {
    chrome.runtime.sendMessage({ action: 'getBlockedUsers' }, res => {
      blockedUsers = res?.blockedUsers?.map(u => u.toLowerCase()) || [];
      r();
    });
  });

const getAuthor = cmt => {
  const a = cmt.querySelector('a[href*="/user/"]');
  if (!a) return null;
  const m = a.href.match(/reddit\.com\/user\/([^/?]+)/i);
  return m ? m[1].toLowerCase() : null;
};

// delete every visual slot inside a <shreddit-comment>
const deleteComment = cmt => {
  cmt.querySelector('[slot="commentAvatar"]')?.remove();
  cmt.querySelector('[slot="commentMeta"]')?.remove();
  cmt.querySelector('[slot="comment"]')?.remove();
  cmt.querySelector('[slot="actionRow"]')?.remove();
};

// hide or un-hide comments based on current blocked list
const refreshBlocking = async () => {
  await loadData();
  document.querySelectorAll('shreddit-comment').forEach(cmt => {
    const user = getAuthor(cmt);
    const shouldHide = user && blockedUsers.includes(user);

    // restore first (in case user was un-blocked)
    [...cmt.children].forEach(slot => {
      if (slot.slot) slot.style.removeProperty('display');
    });

    if (shouldHide) {
      deleteComment(cmt);
    }
  });
};

// initial run + DOM observer
const init = async () => {
  if (!location.hostname.includes('reddit.com')) return;
  await refreshBlocking();

  if (observer) observer.disconnect();
  observer = new MutationObserver(() => setTimeout(refreshBlocking, 150));
  observer.observe(document.body, { childList: true, subtree: true });
};

// listen for messages from background/popup
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'refreshBlocking') refreshBlocking();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else init();

// handle SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 1000);
  }
}).observe(document, { childList: true, subtree: true });