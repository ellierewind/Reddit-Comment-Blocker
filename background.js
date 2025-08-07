// background.js – Reddit edition with chunked storage
class StorageManager {
  static CHUNK_SIZE = 100; // Users per chunk
  static METADATA_KEY = 'blockedUsers_meta';
  static CHUNK_PREFIX = 'blockedUsers_chunk_';

  static async getAllBlockedUsers() {
    try {
      // First try to get metadata
      const result = await chrome.storage.sync.get([this.METADATA_KEY]);
      const metadata = result[this.METADATA_KEY];

      if (!metadata) {
        // Check for legacy single-item storage
        const legacyResult = await chrome.storage.sync.get(['blockedUsers']);
        if (legacyResult.blockedUsers && Array.isArray(legacyResult.blockedUsers)) {
          // Migrate legacy storage
          await this.setAllBlockedUsers(legacyResult.blockedUsers);
          // Remove legacy storage
          await chrome.storage.sync.remove(['blockedUsers']);
          return legacyResult.blockedUsers;
        }
        return [];
      }

      // Get all chunks
      const chunkKeys = [];
      for (let i = 0; i < metadata.totalChunks; i++) {
        chunkKeys.push(`${this.CHUNK_PREFIX}${i}`);
      }

      const chunkResults = await chrome.storage.sync.get(chunkKeys);
      const allUsers = [];

      for (let i = 0; i < metadata.totalChunks; i++) {
        const chunkKey = `${this.CHUNK_PREFIX}${i}`;
        const chunk = chunkResults[chunkKey];
        if (chunk && Array.isArray(chunk)) {
          allUsers.push(...chunk);
        }
      }

      return allUsers;
    } catch (error) {
      console.error('Error getting blocked users:', error);
      return [];
    }
  }

  static async setAllBlockedUsers(users) {
    try {
      // Clear existing chunks first
      await this.clearAllChunks();

      if (!Array.isArray(users) || users.length === 0) {
        await chrome.storage.sync.set({
          [this.METADATA_KEY]: { totalUsers: 0, totalChunks: 0 }
        });
        return true;
      }

      // Split users into chunks
      const chunks = [];
      for (let i = 0; i < users.length; i += this.CHUNK_SIZE) {
        chunks.push(users.slice(i, i + this.CHUNK_SIZE));
      }

      // Save chunks
      const savePromises = chunks.map((chunk, index) => 
        chrome.storage.sync.set({
          [`${this.CHUNK_PREFIX}${index}`]: chunk
        })
      );

      // Save metadata
      savePromises.push(
        chrome.storage.sync.set({
          [this.METADATA_KEY]: {
            totalUsers: users.length,
            totalChunks: chunks.length,
            lastUpdated: Date.now()
          }
        })
      );

      await Promise.all(savePromises);
      return true;
    } catch (error) {
      console.error('Error saving blocked users:', error);
      return false;
    }
  }

  static async addBlockedUser(username) {
    try {
      const users = await this.getAllBlockedUsers();
      const cleanUsername = username.toLowerCase().trim();
      
      if (users.includes(cleanUsername)) {
        return { success: false, reason: 'User already blocked' };
      }

      users.push(cleanUsername);
      const success = await this.setAllBlockedUsers(users);
      
      return success 
        ? { success: true } 
        : { success: false, reason: 'Storage error' };
    } catch (error) {
      console.error('Error adding blocked user:', error);
      return { success: false, reason: 'Storage error' };
    }
  }

  static async removeBlockedUser(username) {
    try {
      const users = await this.getAllBlockedUsers();
      const cleanUsername = username.toLowerCase().trim();
      const index = users.indexOf(cleanUsername);
      
      if (index === -1) {
        return { success: false, reason: 'User not found' };
      }

      users.splice(index, 1);
      const success = await this.setAllBlockedUsers(users);
      
      return success 
        ? { success: true } 
        : { success: false, reason: 'Storage error' };
    } catch (error) {
      console.error('Error removing blocked user:', error);
      return { success: false, reason: 'Storage error' };
    }
  }

  static async clearAllChunks() {
    try {
      const result = await chrome.storage.sync.get([this.METADATA_KEY]);
      const metadata = result[this.METADATA_KEY];
      
      if (metadata && metadata.totalChunks) {
        const keysToRemove = [];
        for (let i = 0; i < metadata.totalChunks; i++) {
          keysToRemove.push(`${this.CHUNK_PREFIX}${i}`);
        }
        if (keysToRemove.length > 0) {
          await chrome.storage.sync.remove(keysToRemove);
        }
      }
    } catch (error) {
      console.error('Error clearing chunks:', error);
    }
  }

  static async importBlockedUsers(newUsers) {
    try {
      const currentUsers = await this.getAllBlockedUsers();
      const cleanNewUsers = newUsers
        .map(u => u.toLowerCase().trim())
        .filter(u => u.length > 0);
      
      const uniqueNewUsers = cleanNewUsers.filter(u => !currentUsers.includes(u));
      
      if (uniqueNewUsers.length === 0) {
        return {
          success: true,
          imported: 0,
          duplicates: cleanNewUsers.length,
          total: currentUsers.length
        };
      }

      const mergedUsers = [...currentUsers, ...uniqueNewUsers];
      const success = await this.setAllBlockedUsers(mergedUsers);
      
      return success ? {
        success: true,
        imported: uniqueNewUsers.length,
        duplicates: cleanNewUsers.length - uniqueNewUsers.length,
        total: mergedUsers.length
      } : {
        success: false,
        reason: 'Storage error'
      };
    } catch (error) {
      console.error('Error importing blocked users:', error);
      return { success: false, reason: 'Import error' };
    }
  }
}

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "blockUser",
    title: "Block this Reddit user's comments",
    contexts: ["link"],
    documentUrlPatterns: ["*://*.reddit.com/*"],
    targetUrlPatterns: ["*://*.reddit.com/user/*"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const match = info.linkUrl?.match(/reddit\.com\/user\/([^/?]+)/i);
  if (!match) return;

  const username = match[1].toLowerCase();
  const result = await StorageManager.addBlockedUser(username);
  
  if (result.success) {
    chrome.tabs.sendMessage(tab.id, { action: "userBlocked", username });
  }
});

// Message handling
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const handleAsync = async () => {
    try {
      switch (req.action) {
        case "getBlockedUsers":
          const users = await StorageManager.getAllBlockedUsers();
          return { blockedUsers: users };

        case "addBlockedUser":
          return await StorageManager.addBlockedUser(req.username);

        case "removeBlockedUser":
          return await StorageManager.removeBlockedUser(req.username);

        case "importBlockedUsers":
          return await StorageManager.importBlockedUsers(req.users);

        default:
          return { success: false, reason: "Unknown action" };
      }
    } catch (error) {
      console.error("Message handler error:", error);
      return { success: false, reason: "Internal error" };
    }
  };

  handleAsync().then(sendResponse);
  return true; // Indicates we will respond asynchronously
});

// Broadcast storage changes to all Reddit tabs
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes[StorageManager.METADATA_KEY] || 
      Object.keys(changes).some(key => key.startsWith(StorageManager.CHUNK_PREFIX)))) {
    chrome.tabs.query({ url: '*://*.reddit.com/*' }, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'refreshBlocking' })
          .catch(() => {}); // Ignore errors for inactive tabs
      });
    });
  }
});