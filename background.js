// Background script for Reddit Comment Blocker
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "blockUser",
    title: "Block this user's comments",
    contexts: ["link"],
    documentUrlPatterns: ["*://*.reddit.com/*"],
    targetUrlPatterns: ["*://*.reddit.com/user/*", "*://*.reddit.com/u/*"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const match = info.linkUrl?.match(/reddit\.com\/(?:user|u)\/([^/?]+)/);
  if (match) {
    const username = match[1];
    chrome.storage.sync.get(["blockedUsers"], (result) => {
      const blockedUsers = result.blockedUsers || [];
      if (!blockedUsers.includes(username)) {
        blockedUsers.push(username);
        chrome.storage.sync.set({ blockedUsers }, () => {
          chrome.tabs.sendMessage(tab.id, { action: "userBlocked", username });
        });
      }
    });
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;
  
  if (action === "getBlockedUsers") {
    chrome.storage.sync.get(["blockedUsers"], (result) => {
      sendResponse({ blockedUsers: result.blockedUsers || [] });
    });
    return true;
  }
  
  if (action === "addBlockedUser" || action === "removeBlockedUser") {
    chrome.storage.sync.get(["blockedUsers"], (result) => {
      const blockedUsers = result.blockedUsers || [];
      const username = request.username.trim();
      const index = blockedUsers.indexOf(username);
      
      let success = false;
      let reason = "";
      
      if (action === "addBlockedUser") {
        if (index === -1) {
          blockedUsers.push(username);
          success = true;
        } else {
          reason = "User already blocked";
        }
      } else { // removeBlockedUser
        if (index > -1) {
          blockedUsers.splice(index, 1);
          success = true;
        } else {
          reason = "User not found";
        }
      }
      
      if (success) {
        chrome.storage.sync.set({ blockedUsers }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, reason });
      }
    });
    return true;
  }
  
  sendResponse({ success: false, reason: "Unknown action" });
});