// Optimized Popup script for Reddit Comment Blocker
document.addEventListener('DOMContentLoaded', function() {
  const elements = {
    usernameInput: document.getElementById('usernameInput'),
    addBtn: document.getElementById('addBtn'),
    userList: document.getElementById('userList'),
    userCount: document.getElementById('userCount'),
    showPlaceholdersToggle: document.getElementById('showPlaceholders'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    fileInput: document.getElementById('fileInput')
  };
  
  // Helper functions
  const sendMessageSafely = (message, callback) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Chrome runtime error:', chrome.runtime.lastError.message);
          callback?.({ blockedUsers: [] });
          return;
        }
        callback?.(response);
      });
    } catch (error) {
      console.warn('Failed to send message:', error);
      callback?.({ blockedUsers: [] });
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
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
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
  
  const showMessage = (text, type = 'info') => {
    const existingMsg = document.querySelector('.temp-message');
    if (existingMsg) existingMsg.remove();
    
    const colors = {
      success: 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;',
      error: 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;',
      info: 'background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb;'
    };
    
    const msg = document.createElement('div');
    msg.className = 'temp-message';
    msg.textContent = text;
    msg.style.cssText = `
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      padding: 8px 12px; border-radius: 4px; font-size: 12px; font-weight: 500;
      z-index: 1000; ${colors[type] || colors.info}
    `;
    
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  };
  
  // Custom modal functions
  const createCustomModal = () => {
    if (document.getElementById('customModal')) return;
    
    const modalHtml = `
      <div id="customModal" class="modal-overlay" style="display: none;">
        <div class="modal-content">
          <div class="modal-header"><h3 id="modalTitle">Confirm Action</h3></div>
          <div class="modal-body"><p id="modalMessage">Are you sure?</p></div>
          <div class="modal-footer">
            <button id="modalCancel" class="modal-btn modal-btn-cancel">Cancel</button>
            <button id="modalConfirm" class="modal-btn modal-btn-confirm">Confirm</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Add modal styles
    const modalStyles = `
      .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 10000; backdrop-filter: blur(2px); }
      .modal-content { background: white; border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); min-width: 280px; max-width: 90%; transform: scale(0.9); animation: modalShow 0.2s ease forwards; }
      @keyframes modalShow { to { transform: scale(1); } }
      .modal-header { padding: 16px 20px; border-bottom: 1px solid #eee; background: #ff6e6e; color: white; border-radius: 8px 8px 0 0; }
      .modal-header h3 { margin: 0; font-size: 16px; font-weight: 500; }
      .modal-body { padding: 20px; text-align: center; }
      .modal-body p { margin: 0; font-size: 14px; color: #333; line-height: 1.4; }
      .modal-footer { padding: 12px 20px; display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #eee; background: #f9f9f9; border-radius: 0 0 8px 8px; }
      .modal-btn { padding: 8px 16px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; min-width: 70px; }
      .modal-btn-cancel { background: #6c757d; color: white; }
      .modal-btn-cancel:hover { background: #5a6268; }
      .modal-btn-confirm { background: #ff6e6e; color: white; }
      .modal-btn-confirm:hover { background: #ff5252; }
      .modal-btn:active { transform: translateY(1px); }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = modalStyles;
    document.head.appendChild(styleSheet);
  };
  
  const showConfirmDialog = (title, message) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('customModal');
      if (!modal) {
        createCustomModal();
        return showConfirmDialog(title, message);
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
      const blockedUsers = response?.blockedUsers || [];
      displayUsers(blockedUsers);
      updateCount(blockedUsers.length);
    });
  };
  
  const loadSettings = () => {
    try {
      chrome.storage.sync.get(["showPlaceholders"], (result) => {
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
      chrome.storage.sync.set({ showPlaceholders }, () => {
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
      const blockedUsers = response?.blockedUsers || [];
      
      if (blockedUsers.length === 0) {
        showMessage('No blocked users to export', 'info');
        return;
      }
      
      const exportData = {
        extension: "Reddit Comment Blocker",
        version: "1.0",
        exportDate: new Date().toISOString(),
        blockedUsers
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
      showMessage(`Exported ${blockedUsers.length} blocked users`, 'success');
    });
  };
  
  const importBlockedUsers = (file) => {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        let usersToImport = [];
        
        try {
          const importData = JSON.parse(e.target.result);
          usersToImport = importData.blockedUsers && Array.isArray(importData.blockedUsers) 
            ? importData.blockedUsers 
            : (Array.isArray(importData) ? importData : []);
        } catch {
          // Parse as plain text
          usersToImport = e.target.result.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        }
        
        usersToImport = usersToImport.filter(username => 
          typeof username === 'string' && username.trim().length > 0
        );
        
        if (usersToImport.length === 0) {
          showMessage('No valid usernames found in file', 'error');
          return;
        }
        
        sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
          const currentUsers = response?.blockedUsers || [];
          const newUsers = usersToImport.filter(username => 
            !currentUsers.includes(username.trim())
          );
          
          if (newUsers.length === 0) {
            showMessage(`All ${usersToImport.length} users were already blocked`, 'info');
            return;
          }
          
          const mergedUsers = [...currentUsers, ...newUsers];
          
          try {
            chrome.storage.sync.set({ blockedUsers: mergedUsers }, () => {
              if (chrome.runtime.lastError) {
                console.warn('Failed to save imported users:', chrome.runtime.lastError.message);
                showMessage('Failed to import users', 'error');
                return;
              }
              
              const duplicateCount = usersToImport.length - newUsers.length;
              let message = `Imported ${newUsers.length} new blocked users`;
              if (duplicateCount > 0) {
                message += ` (${duplicateCount} duplicates skipped)`;
              }
              
              showMessage(message, 'success');
              loadBlockedUsers();
              
              getCurrentTab((tab) => {
                if (isRedditPage(tab)) {
                  sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
                }
              });
            });
          } catch (error) {
            console.warn('Failed to save imported users:', error);
            showMessage('Failed to import users', 'error');
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
  const displayUsers = (users) => {
    if (users.length === 0) {
      elements.userList.innerHTML = '<div class="empty-message">No blocked users yet</div>';
      return;
    }
    
    elements.userList.innerHTML = users.map(username => `
      <div class="user-item">
        <span class="username" title="${escapeHtml(username)}">${escapeHtml(username)}</span>
        <button class="remove-btn" data-username="${escapeHtml(username)}" title="Unblock this user">×</button>
      </div>
    `).join('');
    
    elements.userList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        removeUser(this.dataset.username);
      });
    });
  };
  
  const updateCount = (count) => {
    elements.userCount.textContent = count;
  };
  
  // User management functions
  const addUser = (username) => {
    if (!username.trim()) {
      showMessage('Please enter a username', 'error');
      return;
    }
    
    sendMessageSafely({ action: "addBlockedUser", username: username.trim() }, (response) => {
      if (response?.success) {
        showMessage(`Blocked "${username}"`, 'success');
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
  
  const removeUser = async (username) => {
    const confirmed = await showConfirmDialog(
      'Unblock User',
      `Are you sure you want to unblock "${username}"? Their comments will be visible again.`
    );
    
    if (confirmed) {
      sendMessageSafely({ action: "removeBlockedUser", username }, (response) => {
        if (response?.success) {
          showMessage(`Unblocked "${username}"`, 'success');
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
  elements.addBtn.addEventListener('click', () => addUser(elements.usernameInput.value));
  elements.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUser(elements.usernameInput.value);
  });
  elements.showPlaceholdersToggle.addEventListener('change', saveSettings);
  elements.exportBtn.addEventListener('click', exportBlockedUsers);
  elements.importBtn.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importBlockedUsers(file);
      elements.fileInput.value = ''; // Clear for reuse
    }
  });
  
  // Initialize
  loadBlockedUsers();
  loadSettings();
  createCustomModal();
});