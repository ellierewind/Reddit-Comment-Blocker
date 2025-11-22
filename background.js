// Enhanced Background script for Reddit Comment Blocker with pattern matching support (Local Storage)
chrome.runtime.onInstalled.addListener(() => {
  // Remove all existing context menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Create the context menu item after cleanup
    chrome.contextMenus.create({
      id: "blockUser",
      title: "Block this user's comments",
      contexts: ["link"],
      documentUrlPatterns: ["*://*.reddit.com/*"],
      targetUrlPatterns: [
        "*://*.reddit.com/user/*",
        "*://*.reddit.com/u/*"
      ]
    }, () => {
      // Check for errors in context menu creation
      if (chrome.runtime.lastError) {
        console.warn('Context menu creation error:', chrome.runtime.lastError.message);
      }
    });
  });
});

// Storage utility functions for handling blocklists with local storage
const STORAGE_KEY = 'blockedUsers';
const METADATA_KEY = 'blockedUsers_metadata';

// Pattern matching utility functions
const PatternMatcher = {
  // Convert a pattern to regex for matching
  patternToRegex(pattern) {
    // Escape special regex characters except * and ?
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')  // * matches any characters
      .replace(/\?/g, '.');  // ? matches any single character

    return new RegExp(escaped, 'i'); // Case insensitive
  },

  // Check if a username matches any of the blocked patterns
  isBlocked(username, blockedPatterns) {
    if (!username) return false;

    const lowerUsername = username.normalize('NFC').toLowerCase();

    return blockedPatterns.some(pattern => {
      const lowerPattern = pattern.normalize('NFC').toLowerCase();

      // Exact match for non-wildcard patterns
      if (!lowerPattern.includes('*') && !lowerPattern.includes('?')) {
        return lowerUsername === lowerPattern;
      }

      // Pattern matching for wildcards
      try {
        const regex = this.patternToRegex(lowerPattern);
        return regex.test(lowerUsername);
      } catch (error) {
        console.warn('Invalid pattern:', lowerPattern, error);
        // Fallback to simple substring matching for invalid patterns
        return lowerUsername.includes(lowerPattern.replace(/[*?]/g, ''));
      }
    });
  },

  // Validate a pattern before adding it
  validatePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return { valid: false, reason: 'Pattern must be a non-empty string' };
    }

    const trimmed = pattern.trim().normalize('NFC');
    if (trimmed.length === 0) {
      return { valid: false, reason: 'Pattern cannot be empty' };
    }

    // Try to create regex to validate the pattern
    try {
      this.patternToRegex(trimmed);
      return { valid: true, pattern: trimmed };
    } catch (error) {
      return { valid: false, reason: 'Invalid pattern format' };
    }
  }
};

const StorageManager = {
  _maybeDecodeURIComponent(value) {
    if (typeof value !== 'string') return value;
    // Only attempt decode if it looks like a percent-encoded sequence exists
    if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
    try {
      const decoded = decodeURIComponent(value);
      // Ensure it was fully and safely encoded before decoding
      if (encodeURIComponent(decoded) === value) {
        return decoded;
      }
    } catch (e) {
      // ignore decode errors and return original
    }
    return value;
  },

  _normalizeForStorage(value) {
    if (typeof value !== 'string') return value;
    const decoded = this._maybeDecodeURIComponent(value);
    return decoded.trim().normalize('NFC');
  },

  async getAllBlockedUsers() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get([STORAGE_KEY], resolve);
      });

      const blockedUsers = result[STORAGE_KEY];

      if (!blockedUsers || !Array.isArray(blockedUsers)) {
        return [];
      }

      // Decode percent-encoded entries and normalize to NFC
      const processed = blockedUsers.map(u => this._normalizeForStorage(u));

      // If anything changed (decoded/normalized) or duplicates exist, persist the cleaned list
      const unchanged = processed.length === blockedUsers.length && processed.every((v, i) => v === blockedUsers[i]);
      if (!unchanged) {
        await this.saveAllBlockedUsers(processed);
        return processed;
      }

      return processed;
    } catch (error) {
      console.error('Error loading blocked users:', error);
      return [];
    }
  },

  async saveAllBlockedUsers(users) {
    try {
      // Normalize and decode any percent-encoded values, then de-duplicate
      const normalized = users
        .filter(u => u && typeof u === 'string' && u.trim())
        .map(u => this._normalizeForStorage(u));
      const uniqueUsers = [...new Set(normalized)];

      // Save to local storage
      await new Promise(resolve => {
        chrome.storage.local.set({
          [STORAGE_KEY]: uniqueUsers,
          [METADATA_KEY]: {
            totalUsers: uniqueUsers.length,
            lastUpdated: Date.now()
          }
        }, resolve);
      });

      return uniqueUsers;
    } catch (error) {
      console.error('Error saving blocked users:', error);
      throw error;
    }
  },

  async addUser(pattern) {
    const validation = PatternMatcher.validatePattern(pattern);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const validatedPattern = validation.pattern;
    const users = await this.getAllBlockedUsers();

    if (!users.includes(validatedPattern)) {
      users.push(validatedPattern);
      const saved = await this.saveAllBlockedUsers(users);
      return { success: true, totalUsers: saved.length, pattern: validatedPattern };
    }
    return { success: false, reason: "Pattern already exists", totalUsers: users.length };
  },

  async removeUser(pattern) {
    const users = await this.getAllBlockedUsers();
    // Normalize the incoming pattern to align with storage format
    const normalizedPattern = this._normalizeForStorage(pattern);
    const index = users.indexOf(normalizedPattern);
    if (index > -1) {
      users.splice(index, 1);
      const saved = await this.saveAllBlockedUsers(users);
      return { success: true, totalUsers: saved.length };
    }
    return { success: false, reason: "Pattern not found", totalUsers: users.length };
  }
};

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || '';
  // Match reddit user profile URLs: reddit.com/user/USERNAME or reddit.com/u/USERNAME
  const userMatch = url.match(/reddit\.com\/(?:user|u)\/([^/?]+)/i);

  if (!userMatch) return;

  let identifier = userMatch[1];

  try {
    identifier = decodeURIComponent(identifier);
  } catch (e) {
    // keep original if decoding fails
  }

  try {
    const result = await StorageManager.addUser(identifier);
    if (result.success) {
      chrome.tabs.sendMessage(tab.id, { action: "userBlocked", username: identifier });
    }
  } catch (error) {
    console.error('Error blocking user from context menu:', error);
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  if (action === "getBlockedUsers") {
    StorageManager.getAllBlockedUsers()
      .then(blockedUsers => {
        sendResponse({
          blockedUsers,
          totalUsers: blockedUsers.length
        });
      })
      .catch(error => {
        console.error('Error getting blocked users:', error);
        sendResponse({ blockedUsers: [], totalUsers: 0 });
      });
    return true;
  }

  if (action === "addBlockedUser") {
    const pattern = request.username?.trim();
    if (!pattern) {
      sendResponse({ success: false, reason: "Invalid pattern" });
      return;
    }

    StorageManager.addUser(pattern)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error adding pattern:', error);
        sendResponse({ success: false, reason: "Storage error" });
      });
    return true;
  }

  if (action === "removeBlockedUser") {
    const pattern = request.username?.trim();
    if (!pattern) {
      sendResponse({ success: false, reason: "Invalid pattern" });
      return;
    }

    StorageManager.removeUser(pattern)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error removing pattern:', error);
        sendResponse({ success: false, reason: "Storage error" });
      });
    return true;
  }

  // New action for checking if a username matches any blocked patterns
  if (action === "checkBlocked") {
    const username = request.username;
    if (!username) {
      sendResponse({ blocked: false });
      return;
    }

    StorageManager.getAllBlockedUsers()
      .then(blockedPatterns => {
        const blocked = PatternMatcher.isBlocked(username, blockedPatterns);
        sendResponse({ blocked, username });
      })
      .catch(error => {
        console.error('Error checking blocked status:', error);
        sendResponse({ blocked: false });
      });
    return true;
  }

  if (action === "importBlockedUsers") {
    const usersToImport = request.users;
    if (!Array.isArray(usersToImport)) {
      sendResponse({ success: false, reason: "Invalid data format" });
      return;
    }

    StorageManager.getAllBlockedUsers()
      .then(currentUsers => {
        // Validate and filter new patterns
        const validatedPatterns = [];
        const invalidPatterns = [];

        usersToImport.forEach(pattern => {
          if (pattern && typeof pattern === 'string' && pattern.trim()) {
            const validation = PatternMatcher.validatePattern(pattern.trim());
            if (validation.valid && !currentUsers.includes(validation.pattern)) {
              validatedPatterns.push(validation.pattern);
            } else if (!validation.valid) {
              invalidPatterns.push(pattern.trim());
            }
          }
        });

        if (validatedPatterns.length === 0) {
          const duplicateCount = usersToImport.length - invalidPatterns.length;
          sendResponse({
            success: true,
            imported: 0,
            duplicates: duplicateCount,
            invalid: invalidPatterns.length,
            totalUsers: currentUsers.length
          });
          return;
        }

        const mergedUsers = [...currentUsers, ...validatedPatterns];
        return StorageManager.saveAllBlockedUsers(mergedUsers)
          .then(() => {
            sendResponse({
              success: true,
              imported: validatedPatterns.length,
              duplicates: usersToImport.length - validatedPatterns.length - invalidPatterns.length,
              invalid: invalidPatterns.length,
              totalUsers: mergedUsers.length
            });
          });
      })
      .catch(error => {
        console.error('Error importing users:', error);
        sendResponse({ success: false, reason: "Storage error during import" });
      });
    return true;
  }

  sendResponse({ success: false, reason: "Unknown action" });
});
