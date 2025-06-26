const recordBtn = document.getElementById('record-btn');
const stepsBtn = document.getElementById('steps-btn');
const deleteBtn = document.getElementById('delete-steps-btn');

// Check if a recording is in progress (by checking for the recorder icon in the active tab)
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  const currentTab = tabs[0];
  console.log('Popup opened for tab:', currentTab.id);
  
  // Check both content script and background script states
  Promise.all([
    new Promise((resolve) => {
      chrome.tabs.sendMessage(currentTab.id, {action: 'CHECK_RECORDING'}, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError });
        } else {
          resolve({ contentRecording: response?.isRecording || false });
        }
      });
    }),
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_TAB_STATE', tabId: currentTab.id }, (state) => {
        resolve({ 
          backgroundRecording: state?.isRecording || false,
          stepsCount: state?.steps?.length || 0
        });
      });
    })
  ]).then(([contentState, backgroundState]) => {
    console.log('Popup state check:', {
      contentRecording: contentState.contentRecording,
      backgroundRecording: backgroundState.backgroundRecording,
      stepsCount: backgroundState.stepsCount,
      hasError: !!contentState.error
    });
    
    if (contentState.error) {
      // Content script not present (e.g., new tab, chrome:// page)
      recordBtn.disabled = true;
      recordBtn.title = 'This page does not support recording.';
      stepsBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
      return;
    }
    
    // Use content script state as primary, but log background state for debugging
    if (contentState.contentRecording) {
      console.log('Popup: recording is active (content script)');
      recordBtn.disabled = true;
      recordBtn.title = 'Recording...';
    } else {
      console.log('Popup: no active recording (content script)');
      recordBtn.disabled = false;
      recordBtn.title = 'Start Recording';
    }
    
    // Show steps/delete buttons if we have steps
    if (backgroundState.stepsCount > 0) {
      console.log('Popup: found', backgroundState.stepsCount, 'steps for tab', currentTab.id);
      stepsBtn.style.display = '';
      deleteBtn.style.display = '';
    } else {
      stepsBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
    }
  });
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
  console.log('Record button clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const tabId = tabs[0].id;
    function tryStartRecording(retryCount = 0) {
      chrome.tabs.sendMessage(tabId, {action: 'CHECK_RECORDING'}, (response) => {
        if (chrome.runtime.lastError) {
          console.error('CHECK_RECORDING error:', chrome.runtime.lastError);
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
          console.log('Already recording, not starting again');
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {action: 'START_RECORDING'}, (response) => {
            if (chrome.runtime.lastError) {
              console.error('START_RECORDING error:', chrome.runtime.lastError);
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
  console.log('Steps button clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: 'SHOW_EDITOR_MODAL'}, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Runtime error on SHOW_EDITOR_MODAL:', chrome.runtime.lastError);
        alert('This page does not support recording.');
        return;
      }
      window.close();
    });
  });
});

deleteBtn.addEventListener('click', () => {
  console.log('Delete button clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({ action: 'DELETE_STEPS', tabId: tabs[0].id }, () => {
      stepsBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
    });
  });
});

// Listen for CHECK_RECORDING in content script
// (Add this handler in recorder.js) 