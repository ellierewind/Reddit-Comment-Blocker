// Popup script for Reddit Comment Blocker
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
  
  const cleanUsername = (username) => {
    // Remove u/ prefix if present
    return username.replace(/^u\//, '').trim();
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
      .modal-header { padding: 16px 20px; border-bottom: 1px solid #eee; background: #ff4500; color: white; border-radius: 8px 8px 0 0; }
      .modal-header h3 { margin: 0; font-size: 16px; font-weight: 500; }
      .modal-body { padding: 20px; text-align: center; }
      .modal-body p { margin: 0; font-size: 14px; color: #333; line-height: 1.4; }
      .modal-footer { padding: 12px 20px; display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #eee; background: #fafafa; border-radius: 0 0 8px 8px; }
      .modal-btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s ease; }
      .modal-btn-cancel { background: #6c757d; color: white; }
      .modal-btn-cancel:hover { background: #545b62; }
      .modal-btn-confirm { background: #dc3545; color: white; }
      .modal-btn-confirm:hover { background: #c82333; }
    `;
    
    if (!document.getElementById('modalStyles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'modalStyles';
      styleEl.textContent = modalStyles;
      document.head.appendChild(styleEl);
    }
  };
  
  const showModal = (title, message) => {
    return new Promise((resolve) => {
      createCustomModal();
      const modal = document.getElementById('customModal');
      const modalTitle = document.getElementById('modalTitle');
      const modalMessage = document.getElementById('modalMessage');
      const modalCancel = document.getElementById('modalCancel');
      const modalConfirm = document.getElementById('modalConfirm');
      
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      modal.style.display = 'flex';
      
      const cleanup = () => {
        modal.style.display = 'none';
        modalCancel.removeEventListener('click', cancelHandler);
        modalConfirm.removeEventListener('click', confirmHandler);
        modal.removeEventListener('click', overlayHandler);
      };
      
      const cancelHandler = () => {
        cleanup();
        resolve(false);
      };
      
      const confirmHandler = () => {
        cleanup();
        resolve(true);
      };
      
      const overlayHandler = (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(false);
        }
      };
      
      modalCancel.addEventListener('click', cancelHandler);
      modalConfirm.addEventListener('click', confirmHandler);
      modal.addEventListener('click', overlayHandler);
    });
  };
  
  // Load and display blocked users
  const loadBlockedUsers = () => {
    sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
      const blockedUsers = response?.blockedUsers || [];
      displayBlockedUsers(blockedUsers);
    });
  };
  
  const displayBlockedUsers = (blockedUsers) => {
    elements.userCount.textContent = blockedUsers.length;
    
    if (blockedUsers.length === 0) {
      elements.userList.innerHTML = '<div class="empty-message">No blocked users yet</div>';
      return;
    }
    
    elements.userList.innerHTML = blockedUsers
      .sort()
      .map(username => `
        <div class="user-item">
          <span class="username" title="u/${escapeHtml(username)}">u/${escapeHtml(username)}</span>
          <button class="remove-btn" data-username="${escapeHtml(username)}" title="Remove user">×</button>
        </div>
      `).join('');
    
    // Add remove button event listeners
    elements.userList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = btn.dataset.username;
        
        const confirmed = await showModal(
          'Remove Blocked User',
          `Are you sure you want to unblock "u/${username}"?`
        );
        
        if (!confirmed) return;
        
        sendMessageSafely({ action: "removeBlockedUser", username }, (response) => {
          if (response?.success) {
            showMessage(`Unblocked "u/${username}"`, 'success');
            loadBlockedUsers();
            
            getCurrentTab((tab) => {
              if (isRedditPage(tab)) {
                sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
              }
            });
          } else {
            showMessage(`Failed to unblock user: ${response?.reason || 'Unknown error'}`, 'error');
          }
        });
      });
    });
  };
  
  // Add user functionality
  const addUser = () => {
    const username = cleanUsername(elements.usernameInput.value);
    
    if (!username) {
      showMessage('Please enter a username', 'error');
      elements.usernameInput.focus();
      return;
    }
    
    if (!/^[A-Za-z0-9_-]+$/.test(username)) {
      showMessage('Invalid username format', 'error');
      elements.usernameInput.focus();
      return;
    }
    
    sendMessageSafely({ action: "addBlockedUser", username }, (response) => {
      if (response?.success) {
        showMessage(`Blocked "u/${username}"`, 'success');
        elements.usernameInput.value = '';
        loadBlockedUsers();
        
        getCurrentTab((tab) => {
          if (isRedditPage(tab)) {
            sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
          }
        });
      } else {
        const reason = response?.reason || 'Unknown error';
        showMessage(reason === 'User already blocked' ? `"u/${username}" is already blocked` : `Failed to block user: ${reason}`, 'error');
      }
    });
  };
  
  // Settings functionality
  const loadSettings = () => {
    chrome.storage.sync.get(["showPlaceholders"], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to load settings:', chrome.runtime.lastError.message);
        return;
      }
      elements.showPlaceholdersToggle.checked = result.showPlaceholders !== false;
    });
  };
  
  const saveSettings = () => {
    const showPlaceholders = elements.showPlaceholdersToggle.checked;
    chrome.storage.sync.set({ showPlaceholders }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to save settings:', chrome.runtime.lastError.message);
        return;
      }
      
      getCurrentTab((tab) => {
        if (isRedditPage(tab)) {
          sendMessageToContentScript(tab.id, { action: "settingsChanged", showPlaceholders });
        }
      });
    });
  };
  
  // Import/Export functionality
  const exportBlockedUsers = () => {
    sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
      const blockedUsers = response?.blockedUsers || [];
      
      if (blockedUsers.length === 0) {
        showMessage('No blocked users to export', 'info');
        return;
      }
      
      const data = {
        extension: 'Reddit Comment Blocker',
        version: '1.0',
        exportDate: new Date().toISOString(),
        blockedUsers: blockedUsers
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
    reader.onload = (e) => {
      try {
        let importData;
        const content = e.target.result;
        
        if (file.name.endsWith('.json')) {
          importData = JSON.parse(content);
          if (!Array.isArray(importData.blockedUsers)) {
            throw new Error('Invalid JSON format');
          }
        } else {
          // Assume plain text, one username per line
          importData = {
            blockedUsers: content.split('\n')
              .map(line => cleanUsername(line.trim()))
              .filter(username => username && /^[A-Za-z0-9_-]+$/.test(username))
          };
        }
        
        if (importData.blockedUsers.length === 0) {
          showMessage('No valid usernames found in file', 'error');
          return;
        }
        
        sendMessageSafely({ action: "getBlockedUsers" }, (response) => {
          const currentUsers = response?.blockedUsers || [];
          const newUsers = importData.blockedUsers.filter(user => !currentUsers.includes(user));
          
          if (newUsers.length === 0) {
            showMessage('All users in the file are already blocked', 'info');
            return;
          }
          
          const mergedUsers = [...currentUsers, ...newUsers];
          chrome.storage.sync.set({ blockedUsers: mergedUsers }, () => {
            if (chrome.runtime.lastError) {
              showMessage('Failed to import users', 'error');
              return;
            }
            
            showMessage(`Imported ${newUsers.length} new blocked users`, 'success');
            loadBlockedUsers();
            
            getCurrentTab((tab) => {
              if (isRedditPage(tab)) {
                sendMessageToContentScript(tab.id, { action: "refreshBlocking" });
              }
            });
          });
        });
        
      } catch (error) {
        console.error('Import error:', error);
        showMessage('Failed to parse file. Please check the format.', 'error');
      }
    };
    
    reader.readAsText(file);
  };
  
  // Event listeners
  elements.addBtn.addEventListener('click', addUser);
  
  elements.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUser();
    }
  });
  
  elements.showPlaceholdersToggle.addEventListener('change', saveSettings);
  elements.exportBtn.addEventListener('click', exportBlockedUsers);
  
  elements.importBtn.addEventListener('click', () => {
    elements.fileInput.click();
  });
  
  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importBlockedUsers(file);
    }
    e.target.value = '';
  });
  
  // Initialize
  loadBlockedUsers();
  loadSettings();
});