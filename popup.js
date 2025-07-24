// Optimized Popup script for Reddit Comment Blocker
document.addEventListener('DOMContentLoaded', function() {
  const elements = {
    usernameInput: document.getElementById('usernameInput'),
    addUserBtn: document.getElementById('addUserBtn'), // Changed from addBtn
    blockedUsersList: document.getElementById('blockedUsersList'), // Changed from userList
    userCount: document.getElementById('userCount'), // This span is removed from HTML, but keeping for now if it's used elsewhere. Will remove if not.
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    fileInput: document.getElementById('fileInput'),
    notification: document.getElementById('notification') // Added notification element
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
  
  // Refactored showMessage to use the new notification element
  const showMessage = (message, type = 'info') => {
    const notification = elements.notification;
    notification.textContent = message;
    // Remove previous type classes and add the new one
    notification.className = `notification ${type}`; 
    notification.classList.remove('hidden'); // Ensure it's visible
    
    setTimeout(() => {
      notification.classList.add('hidden'); // Hide after 3 seconds
    }, 3000);
  };
  
  // Custom modal functions - simplified as styles are now in HTML
  const showConfirmDialog = (title, message) => {
    return new Promise((resolve) => {
      // Create modal elements if they don't exist (first run)
      let modal = document.getElementById('customModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'customModal';
        modal.className = 'confirmation-dialog'; // Use the new class
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
      modal.style.display = 'flex'; // Show the modal
      
      const confirmBtn = document.getElementById('modalConfirm');
      const cancelBtn = document.getElementById('modalCancel');
      
      setTimeout(() => confirmBtn.focus(), 100);
      
      const cleanup = () => {
        modal.style.display = 'none'; // Hide the modal
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
      // Removed updateCount as userCount span is removed from HTML
    });
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
      elements.blockedUsersList.innerHTML = '<div class="empty-state">No blocked users yet</div>';
      return;
    }
    
    elements.blockedUsersList.innerHTML = users.map(username => `
      <div class="blocked-user">
        <span class="username" title="${escapeHtml(username)}">${escapeHtml(username)}</span>
        <button class="unblock-btn" data-username="${escapeHtml(username)}" title="Unblock this user">Unblock</button>
      </div>
    `).join('');
    
    elements.blockedUsersList.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        removeUser(this.dataset.username);
      });
    });
  };
  
  // Removed updateCount function as userCount span is removed from HTML
  
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
  elements.addUserBtn.addEventListener('click', () => addUser(elements.usernameInput.value)); // Changed from addBtn
  elements.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUser(elements.usernameInput.value);
  });
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
});
