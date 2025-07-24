// Content script for Reddit Comment Blocker
let blockedUsers = [];
let observer = null;
let showPlaceholders = true;

// Load data from storage
const loadData = () => new Promise(resolve => {
  chrome.runtime.sendMessage({ action: "getBlockedUsers" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      blockedUsers = [];
      resolve();
      return;
    }
    blockedUsers = response.blockedUsers || [];
    
    chrome.storage.sync.get(["showPlaceholders"], (result) => {
      showPlaceholders = result.showPlaceholders !== false;
      resolve();
    });
  });
});

// Extract username from element
const extractUsername = (element) => {
  if (!element) return null;
  
  // Try href first
  if (element.href) {
    const match = element.href.match(/reddit\.com\/(?:user|u)\/([^/?]+)/);
    if (match) return match[1];
  }
  
  // Try text content - Reddit usernames start with u/
  const text = element.textContent?.trim();
  if (text?.startsWith('u/')) {
    return text.substring(2);
  }
  
  return text;
};

// Add placeholder
const addPlaceholder = (element, text) => {
  if (!showPlaceholders || element.nextElementSibling?.classList.contains('blocked-placeholder')) return;
  
  const placeholder = document.createElement('div');
  placeholder.className = 'blocked-placeholder';
  placeholder.textContent = text;
  element.parentNode.insertBefore(placeholder, element.nextSibling);
};

// Hide comments from blocked users
const hideBlockedComments = () => {
  // New Reddit (shreddit-comment)
  const newComments = document.querySelectorAll('shreddit-comment:not(.blocked-processed)');
  newComments.forEach(comment => {
    const authorLink = comment.querySelector('a[slot="userLink"], a[href*="/user/"], a[href*="/u/"]');
    if (!authorLink) {
      comment.classList.add('blocked-processed');
      return;
    }
    
    const username = extractUsername(authorLink);
    if (!username || !blockedUsers.includes(username)) {
      comment.classList.add('blocked-processed');
      return;
    }
    
    // Hide comment
    comment.style.display = 'none';
    comment.classList.add('blocked-comment', 'blocked-processed');
    addPlaceholder(comment, `Comment from blocked user "u/${username}" hidden`);
  });
  
  // Old Reddit (.comment)
  const oldComments = document.querySelectorAll('.comment:not(.blocked-processed)');
  oldComments.forEach(comment => {
    const authorLink = comment.querySelector('.author');
    if (!authorLink) {
      comment.classList.add('blocked-processed');
      return;
    }
    
    const username = extractUsername(authorLink);
    if (!username || !blockedUsers.includes(username)) {
      comment.classList.add('blocked-processed');
      return;
    }
    
    // Hide comment
    comment.style.display = 'none';
    comment.classList.add('blocked-comment', 'blocked-processed');
    addPlaceholder(comment, `Comment from blocked user "u/${username}" hidden`);
  });
  
  // Handle nested comments that might be children of blocked comments
  const hiddenComments = document.querySelectorAll('.blocked-comment');
  hiddenComments.forEach(hiddenComment => {
    // For new Reddit
    const childComments = hiddenComment.querySelectorAll('shreddit-comment');
    childComments.forEach(child => {
      if (!child.classList.contains('blocked-comment')) {
        child.style.display = 'none';
        child.classList.add('blocked-child-comment');
      }
    });
    
    // For old Reddit
    const oldChildComments = hiddenComment.querySelectorAll('.comment');
    oldChildComments.forEach(child => {
      if (!child.classList.contains('blocked-comment')) {
        child.style.display = 'none';
        child.classList.add('blocked-child-comment');
      }
    });
  });
};

// Reset and reprocess all comments
const refreshComments = () => {
  // Reset all processed states
  document.querySelectorAll('.blocked-processed').forEach(el => el.classList.remove('blocked-processed'));
  document.querySelectorAll('.blocked-placeholder').forEach(el => el.remove());
  document.querySelectorAll('.blocked-comment').forEach(el => {
    el.style.display = '';
    el.classList.remove('blocked-comment');
  });
  document.querySelectorAll('.blocked-child-comment').forEach(el => {
    el.style.display = '';
    el.classList.remove('blocked-child-comment');
  });
  
  hideBlockedComments();
};

// Show notification
const showNotification = (message) => {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; background: #333; color: white;
    padding: 12px 20px; border-radius: 4px; z-index: 10000; font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
};

// Initialize
const init = async () => {
  if (!location.href.includes('reddit.com')) return;
  
  await loadData();
  hideBlockedComments();
  
  // Set up observer
  if (observer) observer.disconnect();
  
  observer = new MutationObserver((mutations) => {
    const hasNewComments = mutations.some(mutation => 
      Array.from(mutation.addedNodes).some(node => 
        node.nodeType === 1 && (
          node.matches?.('shreddit-comment, .comment') ||
          node.querySelector?.('shreddit-comment, .comment')
        )
      )
    );
    
    if (hasNewComments) setTimeout(hideBlockedComments, 100);
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
};

// Handle messages
chrome.runtime.onMessage.addListener((request) => {
  const { action } = request;
  
  if (action === "userBlocked") {
    loadData().then(() => {
      refreshComments();
      showNotification(`Blocked comments from "u/${request.username}"`);
    });
  }
  
  if (action === "refreshBlocking") {
    loadData().then(refreshComments);
  }
  
  if (action === "settingsChanged") {
    showPlaceholders = request.showPlaceholders;
    if (showPlaceholders) {
      refreshComments();
    } else {
      document.querySelectorAll('.blocked-placeholder').forEach(el => el.style.display = 'none');
    }
  }
});

// Initialize on load or Reddit navigation
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle Reddit's single-page app navigation
let currentUrl = location.href;
new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    setTimeout(init, 1000);
  }
}).observe(document, { subtree: true, childList: true });