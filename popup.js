// Enhanced Popup script for Reddit Comment Blocker with pattern matching support (Local Storage)
document.addEventListener('DOMContentLoaded', function () {
  const elements = {
    usernameInput: document.getElementById('usernameInput'),
    addUserBtn: document.getElementById('addUserBtn'),
    blockedUsersList: document.getElementById('blockedUsersList'),
    showPlaceholdersToggle: document.getElementById('showPlaceholders'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    fileInput: document.getElementById('fileInput'),
    notification: document.getElementById('notification')
  };

  let currentPatternCount = 0;

  // Pattern validation (client-side)
  const validatePattern = (pattern) => {
    if (!pattern || typeof pattern !== 'string') {
      return { valid: false, reason: 'Pattern must be a non-empty string' };
    }

    // Trim and normalize to NFC for consistent Unicode handling
    const trimmed = pattern.trim().normalize('NFC');
    if (trimmed.length === 0) {
      return { valid: false, reason: 'Pattern cannot be empty' };
    }

    return { valid: true, pattern: trimmed };
  };

  // Helper functions
  const sendMessageSafely = (message, callback) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Chrome runtime error:', chrome.runtime.lastError.message);
          callback?.({ blockedUsers: [], totalUsers: 0 });
          return;
        }
        callback?.(response);
      });
    } catch (error) {
      console.warn('Failed to send message:', error);
      callback?.({ blockedUsers: [], totalUsers: 0 });
    }
  };

  const sendMessageToContentScript = (tabId, message) => {
    if (!tabId) return;
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) {
          console.debug('Content script message failed:', chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.debug('Failed to send message to content script:', error);
    }
  };

  const getCurrentTab = (callback) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to query tabs:', chrome.runtime.lastError.message);
          callback(null);
          return;
        }
        callback(tabs[0] || null);
      });
    } catch (error) {
      console.warn('Failed to query tabs:', error);
      callback(null);
    }
  };

  const isRedditPage = (tab) => tab?.url?.includes('reddit.com');
  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const showMessage = (message, type = 'info') => {
    const notification = elements.notification;
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');

    setTimeout(() => {
      notification.classList.add('hidden');
    }, 4000); // Longer timeout for pattern messages
  };

  // Check if pattern contains wildcards
  const isWildcardPattern = (pattern) => {
    return pattern.includes('*') || pattern.includes('?');
  };

  // Custom modal functions
  const showConfirmDialog = (title, message) => {
    return new Promise((resolve) => {
      let modal = document.getElementById('customModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'customModal';
        modal.className = 'confirmation-dialog';
        modal.innerHTML = `
          <div class="confirmation-content">
            <div class="modal-header"><h3 id="modalTitle"></h3></div>
            <div class="modal-body"><p id="modalMessage"></p></div>
            <div class="confirmation-buttons">
              <button id="modalCancel" class="cancel-btn">Cancel</button>
              <button id="modalConfirm" class="confirm-btn">Confirm</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }

      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalMessage').textContent = message;
      modal.style.display = 'flex';

      const confirmBtn = document.getElementById('modalConfirm');
      const cancelBtn = document.getElementById('modalCancel');

      setTimeout(() => confirmBtn.focus(), 100);

      const cleanup = () => {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleOverlayClick);
        document.removeEventListener('keydown', handleKeydown);
      };

      const handleConfirm = () => { cleanup(); resolve(true); };
      const handleCancel = () => { cleanup(); resolve(false); };
      const handleOverlayClick = (e) => { if (e.target === modal) { cleanup(); resolve(false); } };
      const handleKeydown = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(false); }
        else if (e.key === 'Enter') { cleanup(); resolve(true); }
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleOverlayClick);
      document.addEventListener('keydown', handleKeydown);
    });
  };

  // Data management functions
  const loadBlockedUsers = () => {
    sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
      const blockedPatterns = response?.blockedUsers || [];
      currentPatternCount = response?.totalUsers || blockedPatterns.length;
      displayPatterns(blockedPatterns);
    });
  };

  const loadSettings = () => {
    try {
      chrome.storage.local.get(["showPlaceholders"], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to load settings:', chrome.runtime.lastError.message);
          elements.showPlaceholdersToggle.checked = true;
          return;
        }
        elements.showPlaceholdersToggle.checked = result.showPlaceholders !== false;
      });
    } catch (error) {
      console.warn('Failed to load settings:', error);
      elements.showPlaceholdersToggle.checked = true;
    }
  };

  const saveSettings = () => {
    const showPlaceholders = elements.showPlaceholdersToggle.checked;

    try {
      chrome.storage.local.set({ showPlaceholders }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to save settings:', chrome.runtime.lastError.message);
          return;
        }

        getCurrentTab((tab) => {
          if (isRedditPage(tab)) {
            sendMessageToContentScript(tab.id, {
              action: "settingsChanged",
              showPlaceholders: showPlaceholders
            });
          }
        });
      });
    } catch (error) {
      console.warn('Failed to save settings:', error);
    }
  };

  // Export/Import functions
  const exportBlockedUsers = () => {
    sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
      const blockedPatterns = response?.blockedUsers || [];

      if (blockedPatterns.length === 0) {
        showMessage('No blocked users to export', 'info');
        return;
      }

      const exportData = {
        extension: "Reddit Comment Blocker",
        version: "2.0",
        exportDate: new Date().toISOString(),
        totalUsers: blockedPatterns.length,
        blockedUsers: blockedPatterns
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `reddit-blocked-users-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
      showMessage(`Exported ${blockedPatterns.length} blocked users`, 'success');
    });
  };

  const importBlockedUsers = (file) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        let patternsToImport = [];

        try {
          const importData = JSON.parse(e.target.result);
          patternsToImport = importData.blockedUsers && Array.isArray(importData.blockedUsers)
            ? importData.blockedUsers
            : (Array.isArray(importData) ? importData : []);
        } catch {
          // Parse as plain text
          patternsToImport = e.target.result.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        }

        // Clean and validate patterns
        patternsToImport = patternsToImport
          .filter(pattern => typeof pattern === 'string' && pattern.trim().length > 0)
          .map(pattern => pattern.trim());

        if (patternsToImport.length === 0) {
          showMessage('No valid usernames found in file', 'error');
          return;
        }

        sendMessageSafely({ action: "importBlockedUsers", users: patternsToImport }, (response) => {
          if (response?.success) {
            const { imported, duplicates, invalid, totalUsers } = response;
            let message = `Import completed: ${imported} new users added`;
            if (duplicates > 0) {
              message += `, ${duplicates} duplicates skipped`;
            }
            if (invalid > 0) {
              message += `, ${invalid} invalid entries skipped`;
            }
            message += `. Total: ${totalUsers} blocked users.`;

            showMessage(message, 'success');
            loadBlockedUsers();

            getCurrentTab((tab) => {
              if (isRedditPage(tab)) {
                sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
              }
            });
          } else {
            showMessage(response?.reason || 'Failed to import users', 'error');
          }
        });

      } catch (error) {
        console.error('Import error:', error);
        showMessage('Failed to import file. Please check the file format.', 'error');
      }
    };

    reader.onerror = () => showMessage('Failed to read file', 'error');
    reader.readAsText(file);
  };

  // Display functions
  const displayPatterns = (patterns) => {
    if (patterns.length === 0) {
      elements.blockedUsersList.innerHTML = '<div class="empty-state">No blocked patterns yet</div>';
      return;
    }

    elements.blockedUsersList.innerHTML = patterns.map(pattern => {
      const isWildcard = isWildcardPattern(pattern);
      return `
        <div class="blocked-user">
          <div>
            <span class="username" title="${escapeHtml(pattern)}">${escapeHtml(pattern)}</span>
            ${isWildcard ? '<span class="pattern-indicator">(pattern)</span>' : ''}
          </div>
          <button class="unblock-btn" data-pattern="${escapeHtml(pattern)}" title="Remove this pattern">Remove</button>
        </div>
      `;
    }).join('');

    elements.blockedUsersList.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        removePattern(this.dataset.pattern);
      });
    });
  };

  // Pattern management functions
  const addPattern = (pattern) => {
    const validation = validatePattern(pattern);
    if (!validation.valid) {
      showMessage(validation.reason, 'error');
      return;
    }

    const validatedPattern = validation.pattern;

    sendMessageSafely({ action: "addBlockedUser", username: validatedPattern }, (response) => {
      if (response?.success) {
        showMessage(`Blocked "${validatedPattern}" (Total: ${response.totalUsers})`, 'success');
        elements.usernameInput.value = '';
        loadBlockedUsers();

        getCurrentTab((tab) => {
          if (isRedditPage(tab)) {
            sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
          }
        });
      } else {
        showMessage(response?.reason || 'Failed to block user', 'error');
      }
    });
  };

  const removePattern = async (pattern) => {
    const confirmed = await showConfirmDialog(
      'Unblock User',
      `Are you sure you want to unblock "${pattern}"? Their comments will be visible again.`
    );

    if (confirmed) {
      sendMessageSafely({ action: "removeBlockedUser", username: pattern }, (response) => {
        if (response?.success) {
          showMessage(`Unblocked "${pattern}" (Total: ${response.totalUsers})`, 'success');
          loadBlockedUsers();

          getCurrentTab((tab) => {
            if (isRedditPage(tab)) {
              sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
            }
          });
        } else {
          showMessage(response?.reason || 'Failed to unblock user', 'error');
        }
      });
    }
  };

  // Event listeners
  elements.addUserBtn.addEventListener('click', () => addPattern(elements.usernameInput.value));
  elements.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addPattern(elements.usernameInput.value);
  });
  elements.showPlaceholdersToggle.addEventListener('change', saveSettings);
  elements.exportBtn.addEventListener('click', exportBlockedUsers);
  elements.importBtn.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importBlockedUsers(file);
      elements.fileInput.value = '';
    }
  });

  // Initialize
  loadBlockedUsers();
  loadSettings();
});
