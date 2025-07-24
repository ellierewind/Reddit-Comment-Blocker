// background.js – Reddit edition
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "blockUser",
    title: "Block this Reddit user’s comments",
    contexts: ["link"],
    documentUrlPatterns: ["*://*.reddit.com/*"],
    targetUrlPatterns: ["*://*.reddit.com/user/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const match = info.linkUrl?.match(/reddit\.com\/user\/([^/?]+)/i);
  if (!match) return;

  const username = match[1].toLowerCase();
  chrome.storage.sync.get(["blockedUsers"], (res) => {
    const blocked = res.blockedUsers || [];
    if (!blocked.includes(username)) {
      blocked.push(username);
      chrome.storage.sync.set({ blockedUsers: blocked }, () => {
        chrome.tabs.sendMessage(tab.id, { action: "userBlocked", username });
      });
    }
  });
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getBlockedUsers") {
    chrome.storage.sync.get(["blockedUsers"], (r) =>
      sendResponse({ blockedUsers: r.blockedUsers || [] })
    );
    return true;
  }

  if (req.action === "addBlockedUser" || req.action === "removeBlockedUser") {
    chrome.storage.sync.get(["blockedUsers"], (r) => {
      const list = r.blockedUsers || [];
      const user = req.username.toLowerCase().trim();
      const idx = list.indexOf(user);

      let ok = false, reason = "";
      if (req.action === "addBlockedUser") {
        if (idx === -1) {
          list.push(user);
          ok = true;
        } else reason = "User already blocked";
      } else {
        if (idx > -1) {
          list.splice(idx, 1);
          ok = true;
        } else reason = "User not found";
      }

      if (ok) {
        chrome.storage.sync.set({ blockedUsers: list }, () => sendResponse({ success: true }));
      } else sendResponse({ success: false, reason });
    });
    return true;
  }
});

// Broadcast “refreshBlocking” to every Reddit tab whenever the list changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.blockedUsers) {
    chrome.tabs.query({ url: '*://*.reddit.com/*' }, tabs => {
      tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: 'refreshBlocking' }));
    });
  }
});