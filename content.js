// Reddit Comment Blocker
let blockedPatterns = [];
let observer = null;
let showPlaceholders = true;

// Pattern matching utility
const PatternMatcher = {
  patternToRegex(pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(escaped, 'i');
  },

  isBlocked(username, patterns) {
    if (!username || !patterns.length) return false;
    const lowerUsername = username.normalize('NFC').toLowerCase();
    return patterns.some(pattern => {
      const lowerPattern = pattern.normalize('NFC').toLowerCase();
      if (!lowerPattern.includes('*') && !lowerPattern.includes('?')) {
        return lowerUsername === lowerPattern;
      }
      try {
        const regex = this.patternToRegex(lowerPattern);
        return regex.test(lowerUsername);
      } catch (error) {
        return lowerUsername.includes(lowerPattern.replace(/[*?]/g, ''));
      }
    });
  }
};

const loadData = () => new Promise(resolve => {
  chrome.runtime.sendMessage({ action: "getBlockedUsers" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      blockedPatterns = [];
      resolve();
      return;
    }
    blockedPatterns = response.blockedUsers || [];
    chrome.storage.local.get(["showPlaceholders"], (result) => {
      showPlaceholders = result.showPlaceholders !== false;
      resolve();
    });
  });
});

const getAuthor = (commentElement) => {
  // Try to find author in the comment's specific slots or attributes
  // Strategy 1: Look for author link inside the comment
  const authorLink = commentElement.querySelector('a[href*="/user/"]');
  if (authorLink) {
    const match = authorLink.href.match(/reddit\.com\/user\/([^/?]+)/i);
    if (match) return match[1];
  }

  // Strategy 2: Check 'author' attribute on shreddit-comment (if available)
  if (commentElement.hasAttribute('author')) {
    return commentElement.getAttribute('author');
  }

  return null;
};

const findMatchingPattern = (username, patterns) => {
  if (!username || !patterns.length) return null;
  const lowerUsername = username.normalize('NFC').toLowerCase();
  for (const pattern of patterns) {
    const lowerPattern = pattern.normalize('NFC').toLowerCase();
    if (!lowerPattern.includes('*') && !lowerPattern.includes('?')) {
      if (lowerUsername === lowerPattern) return pattern;
      continue;
    }
    try {
      const regex = PatternMatcher.patternToRegex(lowerPattern);
      if (regex.test(lowerUsername)) return pattern;
    } catch (error) {
      if (lowerUsername.includes(lowerPattern.replace(/[*?]/g, ''))) return pattern;
    }
  }
  return null;
};

const hideBlockedComment = (commentElement, username, matchedPattern) => {
  if (commentElement.classList.contains('blocked-processed')) return;

  // Mark as processed
  commentElement.classList.add('blocked-processed');
  commentElement.dataset.blockedUser = username;

  // Elements to hide (slots that contain the comment content/metadata)
  // We do NOT hide the commentElement itself, because it contains nested replies.
  const slotsToHide = [
    'commentAvatar',
    'commentMeta',
    'comment',
    'actionRow'
  ];

  slotsToHide.forEach(slotName => {
    const slotEl = commentElement.querySelector(`[slot="${slotName}"]`);
    if (slotEl) {
      slotEl.style.display = 'none';
      slotEl.classList.add('blocked-content-hidden');
    }
  });

  // Add placeholder if enabled
  if (showPlaceholders) {
    const placeholder = document.createElement('div');
    placeholder.className = 'blocked-placeholder';
    let text = `Comment from blocked user "${username}" hidden`;
    if (matchedPattern && matchedPattern !== username) {
      text += ` (matched pattern: ${matchedPattern})`;
    }
    placeholder.textContent = text;

    // Insert placeholder at the top of the comment element
    commentElement.insertBefore(placeholder, commentElement.firstChild);
  }
};

const unhideComment = (commentElement) => {
  commentElement.classList.remove('blocked-processed');
  delete commentElement.dataset.blockedUser;

  // Remove placeholder
  const placeholder = commentElement.querySelector('.blocked-placeholder');
  if (placeholder) placeholder.remove();

  // Show hidden slots
  commentElement.querySelectorAll('.blocked-content-hidden').forEach(el => {
    el.style.display = '';
    el.classList.remove('blocked-content-hidden');
  });
};

const processComments = () => {
  const comments = document.querySelectorAll('shreddit-comment');
  comments.forEach(comment => {
    // If already processed and blocked, check if it should still be blocked
    if (comment.classList.contains('blocked-processed')) {
      const blockedUser = comment.dataset.blockedUser;
      // If user is no longer blocked, unhide
      if (!PatternMatcher.isBlocked(blockedUser, blockedPatterns)) {
        unhideComment(comment);
      }
      return;
    }

    const author = getAuthor(comment);
    if (!author) return;

    const matchedPattern = findMatchingPattern(author, blockedPatterns);
    if (matchedPattern) {
      hideBlockedComment(comment, author, matchedPattern);
    }
  });
};

const init = async () => {
  if (!location.hostname.includes('reddit.com')) return;

  await loadData();
  processComments();

  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    if (shouldProcess) {
      // Debounce slightly
      setTimeout(processComments, 100);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
};

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "userBlocked" || request.action === "refreshBlocking") {
    loadData().then(processComments);
  }
  if (request.action === "settingsChanged") {
    showPlaceholders = request.showPlaceholders;
    // Re-run to update placeholders
    document.querySelectorAll('.blocked-processed').forEach(unhideComment);
    processComments();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 1000);
  }
}).observe(document, { childList: true, subtree: true });
