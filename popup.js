const recordBtn = document.getElementById('record-btn');
const stepsBtn = document.getElementById('steps-btn');
const deleteBtn = document.getElementById('delete-steps-btn');
const statusChip = document.getElementById('status-chip');
const statusText = document.getElementById('status-text');
const stepsBadge = document.getElementById('steps-count-badge');

// Check if a recording is in progress (by checking for the recorder icon in the active tab)
function updatePopupState(tabId) {
  Promise.all([
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, {action: 'CHECK_RECORDING'}, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError });
        } else {
          resolve({ contentRecording: response?.isRecording || false });
        }
      });
    }),
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_TAB_STATE', tabId }, (state) => {
        resolve({ 
          backgroundRecording: state?.isRecording || false,
          stepsCount: state?.steps?.length || 0,
          editorOpen: state?.editorOpen || false
        });
      });
    })
  ]).then(([contentState, backgroundState]) => {
    if (contentState.error) {
      recordBtn.disabled = true;
      recordBtn.title = 'This page does not support recording.';
      stepsBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
      statusChip.className = 'status status-ready';
      statusText.textContent = 'Unavailable';
      return;
    }
    if (contentState.contentRecording) {
      recordBtn.disabled = true;
      recordBtn.title = 'Recording...';
      statusChip.className = 'status status-recording';
      statusText.textContent = 'Recording';
    } else {
      recordBtn.disabled = false;
      recordBtn.title = 'Start Recording';
      statusChip.className = 'status status-ready';
      statusText.textContent = 'Ready';
    }
    if (backgroundState.stepsCount > 0) {
      // If editor is currently open, hide steps button (or disable)
      if (backgroundState.editorOpen) {
        stepsBtn.style.display = 'none';
      } else {
        stepsBtn.style.display = '';
      }
      deleteBtn.style.display = '';
      stepsBadge.hidden = false;
      stepsBadge.textContent = String(backgroundState.stepsCount);
      if (!contentState.contentRecording) {
        statusChip.className = 'status status-has-steps';
        statusText.textContent = 'Steps ready';
      }
    } else {
      stepsBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
      stepsBadge.hidden = true;
    }
  });
}

chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  const currentTab = tabs[0];
  updatePopupState(currentTab.id);
  // Re-check shortly after open in case SET_TAB_STATE just landed
  setTimeout(() => updatePopupState(currentTab.id), 150);
});

function waitForContentScript(tabId, maxRetries = 10, delay = 100) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function ping() {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ready) {
          if (++attempts < maxRetries) {
            setTimeout(ping, delay);
          } else {
            reject(new Error('Content script not ready'));
          }
        } else {
          resolve();
        }
      });
    }
    ping();
  });
}

recordBtn.addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const tabId = tabs[0].id;
    function tryStartRecording(retryCount = 0) {
      chrome.tabs.sendMessage(tabId, {action: 'CHECK_RECORDING'}, (response) => {
        if (chrome.runtime.lastError) {
          if (retryCount < 1) {
            // Try reloading the tab and retrying once
            chrome.tabs.reload(tabId, {}, () => {
              setTimeout(() => tryStartRecording(retryCount + 1), 700);
            });
          } else {
            alert('This page does not support recording.');
          }
          return;
        }
        if (response && response.isRecording) {
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {action: 'START_RECORDING'}, (response) => {
            if (chrome.runtime.lastError) {
              alert('This page does not support recording.');
              return;
            }
            window.close();
          });
        }, 100);
      });
    }
    tryStartRecording();
  });
});

stepsBtn.addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: 'SHOW_EDITOR_MODAL'}, (response) => {
      if (chrome.runtime.lastError) {
        alert('This page does not support recording.');
        return;
      }
      window.close();
    });
  });
});

deleteBtn.addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const tabId = tabs[0].id;
    // Ask content script to close the editor if open
    chrome.tabs.sendMessage(tabId, { action: 'CLOSE_EDITOR_MODAL' }, () => {
      // Regardless of error, clear steps in background
      chrome.runtime.sendMessage({ action: 'DELETE_STEPS', tabId }, () => {
        stepsBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
        if (stepsBadge) stepsBadge.hidden = true;
        if (statusChip && statusText) { statusChip.className = 'status status-ready'; statusText.textContent = 'Ready'; }
      });
    });
  });
});

// Listen for CHECK_RECORDING in content script
// (Add this handler in recorder.js) 