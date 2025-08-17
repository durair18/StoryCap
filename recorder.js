// Get current tab ID for debugging (will be set when messages are received)
let currentTabId = null;

// State variables
let isRecording = false;
let steps = [];
let recorderIcon = null;
let inputDebounceTimer = null;
let lastInputTarget = null;
let latestScreenshot = null;
let screenshotTimer = null;
let clickListenerAttached = false;
let justCleanedUp = false; // Flag to prevent immediate restart
let recordingStoppedAt = 0; // Timestamp when recording was last stopped
let isPageRestored = false; // Flag to detect bfcache restoration
let isContentScriptReady = false; // Flag to indicate content script is ready

// Detect if page is being restored from bfcache (browser back/forward navigation only)
// This does NOT affect application navigation (SPA routing) which should retain recording state
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    isPageRestored = true;
    isContentScriptReady = false; // Reset ready state
    // Don't restore recording state if page was restored from browser cache
    isRecording = false;
    steps = [];
    hideRecorderIcon();
    if (clickListenerAttached) {
      document.removeEventListener('click', handleClick, true);
      clickListenerAttached = false;
    }
    stopScreenshotLoop();
    
    // Set ready state after a short delay to allow message listeners to be established
    setTimeout(() => {
      isContentScriptReady = true;
    }, 200);
  } else {
    // If it's a normal navigation or reload, reset the flag
    isPageRestored = false;
    // Normal page load, set ready state immediately
    isContentScriptReady = true;
  }
});

// Get initial state from background script
chrome.runtime.sendMessage({ action: 'GET_TAB_STATE' }, (state) => {
  // If page was restored from bfcache (browser back/forward), don't restore recording state
  // Application navigation (SPA routing) will still restore state as expected
  if (isPageRestored) {
    isRecording = false;
    steps = [];
    hideRecorderIcon();
    if (clickListenerAttached) {
      document.removeEventListener('click', handleClick, true);
      clickListenerAttached = false;
    }
    stopScreenshotLoop();
    return;
  }
  
  // Check if we should restore recording state
  // Only restore if we have a valid state and it's actually recording
  if (state && state.isRecording && state.steps && state.steps.length > 0) {
    isRecording = true;
    steps = state.steps || [];
    showRecorderIcon();
    if (!clickListenerAttached) {
      document.addEventListener('click', handleClick, true);
      clickListenerAttached = true;
    }
    startScreenshotLoop();
  } else {
    // Ensure we're in a clean state
    isRecording = false;
    steps = [];
    hideRecorderIcon();
    if (clickListenerAttached) {
      document.removeEventListener('click', handleClick, true);
      clickListenerAttached = false;
    }
    stopScreenshotLoop();
    
    // Set flag to prevent immediate restart
    justCleanedUp = true;
    setTimeout(() => {
      justCleanedUp = false;
    }, 2000); // Prevent restart for 2 seconds
    
    // Also update the background state to ensure consistency
    if (state && state.isRecording) {
      chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: false, steps: [] });
    }
  }
});

// Listen for navigation events from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Extract tab ID from sender
  if (sender.tab) {
    currentTabId = sender.tab.id;
  }
  
  // If content script isn't ready yet, handle messages appropriately
  if (!isContentScriptReady) {
    if (msg.action === 'CHECK_RECORDING') {
      try {
        sendResponse({ isRecording: false });
      } catch (error) {
        console.error('Error sending CHECK_RECORDING response:', error);
      }
      return true;
    }
    
    if (msg.action === 'START_RECORDING') {
      setTimeout(() => {
        // Re-process the message
        chrome.runtime.onMessage._listeners.forEach(listener => {
          if (listener.toString().includes('START_RECORDING')) {
            listener(msg, sender, sendResponse);
          }
        });
      }, 300); // Wait a bit longer than the ready delay
      return true;
    }
    
    // For other messages, return appropriate responses
    if (msg.action === 'SHOW_EDITOR_MODAL') {
      sendResponse([]);
      return true;
    }
    
    return false;
  }
  
  if (msg.action === 'START_RECORDING') {
    if (isRecording) {
      return true;
    }
    
    // Check if we just cleaned up and should prevent restart
    if (justCleanedUp) {
      return true;
    }
    
    // Check if we have any existing steps that might indicate a previous recording
    if (steps && steps.length > 0) {
      steps = [];
    }
    startRecording();
    try {
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error sending START_RECORDING response:', error);
    }
    return true;
  }
  if (msg.action === 'CHECK_RECORDING') {
    try {
      sendResponse({ isRecording });
    } catch (error) {
      console.error('Error sending CHECK_RECORDING response:', error);
    }
    return true;
  }
  if (msg.action === 'SHOW_EDITOR_MODAL') {
    chrome.runtime.sendMessage({ action: 'GET_STEPS' }, (steps) => {
      injectEditorModal(steps || []);
      if (sendResponse) {
        sendResponse();
      }
    });
    return true; // Keep message channel open for async response
  }
  if (msg.action === 'PAGE_NAVIGATED') {
    if (isRecording) {
      captureNavigationEvent(msg.url);
    }
  }
});

function startScreenshotLoop() {
  if (screenshotTimer) return;
  screenshotTimer = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'CAPTURE_SCREENSHOT' }, (dataUrl) => {
      latestScreenshot = dataUrl;
    });
  }, 550); // 500ms interval to stay within Chrome quota
}

function stopScreenshotLoop() {
  if (screenshotTimer) {
    clearInterval(screenshotTimer);
    screenshotTimer = null;
  }
  latestScreenshot = null;
}

window.addEventListener('pagehide', () => {
  stopScreenshotLoop();
});

// Handle page visibility changes (tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page is hidden, stop screenshot loop to save resources
    stopScreenshotLoop();
  } else {
    // Page is visible again
    if (isRecording) {
      // Restart screenshot loop if we're recording
      startScreenshotLoop();
    } else {
      // Ensure we're in a clean state when not recording
      hideRecorderIcon();
      if (clickListenerAttached) {
        document.removeEventListener('click', handleClick, true);
        clickListenerAttached = false;
      }
      stopScreenshotLoop();
    }
  }
});

function startRecording() {
  if (isRecording) return;
  showCaptureStartedMessage();
  setTimeout(() => {
    isRecording = true;
    steps = [];
    showRecorderIcon();
    if (!clickListenerAttached) {
      document.addEventListener('click', handleClick, true);
      clickListenerAttached = true;
    }
    startScreenshotLoop();
    chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: true, steps: [] });
  }, 1600); // Wait for the fade-out duration
}

function stopRecording() {
  isRecording = false;
  recordingStoppedAt = Date.now(); // Set timestamp when recording was stopped
  hideRecorderIcon();
  if (clickListenerAttached) {
    document.removeEventListener('click', handleClick, true);
    clickListenerAttached = false;
  }
  // Immediately clear background state to prevent restoration on navigation
  chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: false, steps: [] });
  stopScreenshotLoop();
  injectEditorModal(steps);
}

function cleanupRecordingState() {
  isRecording = false;
  recordingStoppedAt = Date.now(); // Set timestamp when recording was stopped
  steps = []; // Clear the local steps array
  hideRecorderIcon();
  if (clickListenerAttached) {
    document.removeEventListener('click', handleClick, true);
    clickListenerAttached = false;
  }
  stopScreenshotLoop();
  // Clear any input event listeners
  if (lastInputTarget) {
    lastInputTarget.removeEventListener('input', debouncedInputHandler);
    lastInputTarget.removeEventListener('blur', inputBlurHandler);
    lastInputTarget = null;
  }
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = null;
  }
  // Also clear background state
  chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: false, steps: [] });
}

function cleanupModalState() {
  isRecording = false;
  recordingStoppedAt = Date.now(); // Set timestamp when recording was stopped
  hideRecorderIcon();
  if (clickListenerAttached) {
    document.removeEventListener('click', handleClick, true);
    clickListenerAttached = false;
  }
  stopScreenshotLoop();
  // Clear any input event listeners
  if (lastInputTarget) {
    lastInputTarget.removeEventListener('input', debouncedInputHandler);
    lastInputTarget.removeEventListener('blur', inputBlurHandler);
    lastInputTarget = null;
  }
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = null;
  }
  // Note: Don't clear background state here - let the modal close handler do it with steps
}

function showRecorderIcon() {
  if (recorderIcon || !isRecording) {
    return;
  }
  recorderIcon = document.createElement('button');
  recorderIcon.className = 'recorder-icon';
  recorderIcon.style.position = 'fixed';
  recorderIcon.style.top = '200px';
  recorderIcon.style.left = '10px';
  recorderIcon.style.zIndex = '999999';
  recorderIcon.style.display = 'flex';
  recorderIcon.style.alignItems = 'center';
  recorderIcon.style.justifyContent = 'center';
  recorderIcon.style.width = '30px';
  recorderIcon.style.height = '30px';
  recorderIcon.style.cursor = 'pointer';
  recorderIcon.innerHTML = '<span class="blinking-dot"></span>';
  recorderIcon.title = 'Stop Recording';
  recorderIcon.onclick = stopRecording;
  document.body.appendChild(recorderIcon);
}

function hideRecorderIcon() {
  if (recorderIcon) {
    recorderIcon.remove();
    recorderIcon = null;
  }
}

function showCaptureStartedMessage() {
  const msg = document.createElement('div');
  msg.textContent = 'Capturing started';
  msg.style.position = 'fixed';
  msg.style.top = '50%';
  msg.style.left = '50%';
  msg.style.transform = 'translate(-50%, -50%)';
  msg.style.background = 'rgba(30,30,30,0.95)';
  msg.style.color = '#fff';
  msg.style.fontSize = '2rem';
  msg.style.padding = '24px 48px';
  msg.style.borderRadius = '16px';
  msg.style.zIndex = '1000000';
  msg.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
  msg.style.opacity = '1';
  msg.style.transition = 'opacity 0.7s, transform 0.7s';
  document.body.appendChild(msg);
  setTimeout(() => {
    msg.style.opacity = '0';
    msg.style.transform = 'translate(-50%, calc(-50% - 40px))';
  }, 900);
  setTimeout(() => {
    msg.remove();
  }, 1600);
}

async function handleClick(e) {
  if (!isRecording) return;
  if (recorderIcon && recorderIcon.contains(e.target)) return;
  let el = e.target;
  // Walk up to the closest LI or a parent with a meaningful class/role
  while (el && el !== document.body && el.tagName !== 'LI') {
    el = el.parentElement;
  }
  // If we found a LI, use it; otherwise, use the original target
  if (!el || el === document.body) el = e.target;
  captureEvent(el);
}

function debouncedInputHandler(e) {
  // No screenshot capture here; only track value if needed
  // (You can remove this function entirely if not needed)
}

function inputBlurHandler(e) {
  captureEvent(e.target, true); // Only capture on blur
}

function drawArrow(ctx, fromX, fromY, toX, toY, color = '#006400') {
  const headlen = 22; // length of head in pixels
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Arrowhead as a filled triangle (no extra lines)
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headlen * Math.cos(angle - Math.PI / 7),
    toY - headlen * Math.sin(angle - Math.PI / 7)
  );
  ctx.lineTo(
    toX - headlen * Math.cos(angle + Math.PI / 7),
    toY - headlen * Math.sin(angle + Math.PI / 7)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

async function captureEvent(el, isInput = false) {
  const rect = el.getBoundingClientRect();
  const description = isInput
    ? `Entered text in ${getInputDescription(el)}: "${el.value}"`
    : getDescription(el);
  const highlightCoords = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
  if (!latestScreenshot) {
    // fallback: request a screenshot if none is available
    chrome.runtime.sendMessage({
      action: 'CAPTURE_SCREENSHOT',
      description: description,
      highlight: highlightCoords
    }, async (screenshotUrl) => {
      if (screenshotUrl) {
        const img = new window.Image();
        img.src = screenshotUrl;
        img.onload = function() {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const scaleX = img.width / window.innerWidth;
          const scaleY = img.height / window.innerHeight;
          ctx.lineWidth = 8;
          ctx.strokeStyle = '#ff0000';
          ctx.beginPath();
          ctx.rect(
            highlightCoords.left * scaleX,
            highlightCoords.top * scaleY,
            highlightCoords.width * scaleX,
            highlightCoords.height * scaleY
          );
          ctx.stroke();
          // Draw straight arrow from below/left of highlight to top left corner of highlight
          const toX = highlightCoords.left * scaleX;
          const toY = (highlightCoords.top + highlightCoords.height) * scaleY;
          const fromX = toX - 80;
          const fromY = toY + 120;
          drawArrow(ctx, fromX, fromY, toX, toY, '#006400');
          const highlightedScreenshot = canvas.toDataURL('image/png');
          steps.push({
            description,
            screenshot: highlightedScreenshot,
            highlight: highlightCoords
          });
          chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: true, steps });
        };
      }
    });
    return;
  }
  // Use the latest screenshot
  const img = new window.Image();
  img.src = latestScreenshot;
  img.onload = function() {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const scaleX = img.width / window.innerWidth;
    const scaleY = img.height / window.innerHeight;
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ff0000';
    ctx.beginPath();
    ctx.rect(
      highlightCoords.left * scaleX,
      highlightCoords.top * scaleY,
      highlightCoords.width * scaleX,
      highlightCoords.height * scaleY
    );
    ctx.stroke();
    // Draw straight arrow from below/left of highlight to top left corner of highlight
    const toX = highlightCoords.left * scaleX;
    const toY = (highlightCoords.top + highlightCoords.height) * scaleY;
    const fromX = toX - 80;
    const fromY = toY + 120;
    drawArrow(ctx, fromX, fromY, toX, toY, '#006400');
    const highlightedScreenshot = canvas.toDataURL('image/png');
    steps.push({
      description,
      screenshot: highlightedScreenshot,
      highlight: highlightCoords
    });
    chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: true, steps });
  };
}

function getDescription(el) {
  // Try to get a meaningful label
  let label = '';
  if (el.getAttribute('aria-label')) {
    label = el.getAttribute('aria-label');
  } else if (el.labels && el.labels.length > 0) {
    label = Array.from(el.labels).map(l => l.innerText.trim()).join(', ');
  } else if (el.getAttribute('placeholder')) {
    label = el.getAttribute('placeholder');
  } else if (el.getAttribute('alt')) {
    label = el.getAttribute('alt');
  } else if (el.innerText && el.innerText.trim()) {
    label = el.innerText.trim();
  }

  if (label) {
    return `Click on ${label}`;
  }
  if (el.tagName === 'BUTTON') {
    return 'Click on button';
  }
  if (el.tagName === 'A') {
    return 'Click on link';
  }
  if (el.tagName === 'INPUT') {
    return `Click on input (${el.type})`;
  }
  return `Click on ${el.tagName.toLowerCase()}`;
}

function getInputDescription(el) {
  // Try to get a meaningful label for input fields (without "Click on" prefix)
  let label = '';
  if (el.getAttribute('aria-label')) {
    label = el.getAttribute('aria-label');
  } else if (el.labels && el.labels.length > 0) {
    label = Array.from(el.labels).map(l => l.innerText.trim()).join(', ');
  } else if (el.getAttribute('placeholder')) {
    label = el.getAttribute('placeholder');
  } else if (el.getAttribute('alt')) {
    label = el.getAttribute('alt');
  } else if (el.innerText && el.innerText.trim()) {
    label = el.innerText.trim();
  }

  if (label) {
    return label;
  }
  if (el.tagName === 'INPUT') {
    return `${el.type} field`;
  }
  return 'input field';
}

function injectEditorModal(steps) {
  function showModal() {
    // Remove existing modal if present
    const existing = document.getElementById('editor-modal-overlay');
    if (existing) existing.remove();

    // Modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'editor-modal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.zIndex = '1000001';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    // Modal content
    const modal = document.createElement('div');
    modal.style.background = '#fff';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.18)';
    modal.style.maxWidth = '700px';
    modal.style.width = '90vw';
    modal.style.maxHeight = '90vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.position = 'relative';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '12px';
    closeBtn.style.right = '16px';
    closeBtn.style.fontSize = '2rem';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = '#888';
    closeBtn.style.zIndex = '10';
    closeBtn.onclick = () => {
      try {
        // First, clean up local state
        cleanupModalState();
        // Then update background state - keep steps but stop recording
        chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: false, steps: modalSteps }, (response) => {
        });
      } catch (e) {
        // Ignore extension context errors
      }
      overlay.remove();
    };
    modal.appendChild(closeBtn);

    // Fixed Header
    const header = document.createElement('div');
    header.style.padding = '24px 24px 16px 24px';
    header.style.borderBottom = '1px solid #eee';
    header.style.background = '#fff';
    header.style.borderRadius = '12px 12px 0 0';
    header.innerHTML = '<h2 style="margin: 0; color: #333; font-size: 20px;">Recorded Steps</h2>';
    modal.appendChild(header);

    // Scrollable Content Area
    const contentArea = document.createElement('div');
    contentArea.style.flex = '1';
    contentArea.style.overflowY = 'auto';
    contentArea.style.padding = '16px 24px';
    contentArea.style.background = '#fafafa';
    contentArea.innerHTML = '<ul class="screenshot-list" id="modal-screenshot-list"></ul>';
    modal.appendChild(contentArea);

  // Fixed Footer
    const footer = document.createElement('div');
    footer.style.padding = '16px 24px 24px 24px';
    footer.style.borderTop = '1px solid #eee';
    footer.style.background = '#fff';
    footer.style.borderRadius = '0 0 12px 12px';
    footer.style.textAlign = 'center';
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

      footer.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button id="modal-download-pdf" disabled>Export PDF</button>
          <button id="modal-download-html" disabled>Export HTML</button>
          <button id="modal-download-word" disabled>Export Word</button>
        </div>
      `;
    const style = document.createElement('style');
    style.textContent = `
      .screenshot-list { list-style: none; padding: 0; display: flex; flex-direction: column; align-items: center; }
      .screenshot-item { margin-bottom: 20px; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; align-items: center; max-width: 500px; width: 100%; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; }
      .screenshot-item textarea { width: 100%; min-height: 40px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px; font-family: inherit; resize: vertical; }
      .screenshot-item img { width: 100%; height: auto; max-height: 260px; border: 1px solid #e0e0e0; border-radius: 6px; object-fit: contain; margin-bottom: 10px; }
      .delete-icon { position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; background: rgba(244, 67, 54, 0.9); color: white; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; transition: all 0.2s; z-index: 10; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
      .delete-icon:hover { background: rgba(211, 47, 47, 1); transform: scale(1.1); }
      #modal-download-pdf, #modal-download-html, #modal-download-word { background: #4caf50; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; width: auto; min-width: 200px; margin: 0 auto; display: block; transition: background 0.2s; }
      #modal-download-pdf:disabled, #modal-download-html:disabled, #modal-download-word:disabled { background: #e0e0e0 !important; color: #aaa !important; cursor: not-allowed !important; opacity: 0.7; border: none; box-shadow: none; }
      #modal-download-pdf:hover:not(:disabled), #modal-download-html:hover:not(:disabled), #modal-download-word:hover:not(:disabled) { background: #388e3c; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

  // Editor logic
  let modalSteps = steps.slice();
  const modalList = modal.querySelector('#modal-screenshot-list');
  const modalDownloadBtn = modal.querySelector('#modal-download-pdf');
  const modalDownloadHtmlBtn = modal.querySelector('#modal-download-html');
  const modalDownloadWordBtn = modal.querySelector('#modal-download-word');

    function renderModalList() {
  const any = modalSteps.length === 0;
  modalDownloadBtn.disabled = any;
  modalDownloadHtmlBtn.disabled = any;
  modalDownloadWordBtn.disabled = any;
      modalList.innerHTML = '';
      if (modalSteps.length === 0) {
        const msg = document.createElement('div');
        msg.style.textAlign = 'center';
        msg.style.color = '#888';
        msg.style.fontSize = '18px';
        msg.style.margin = '40px 0';
        msg.textContent = 'No steps recorded yet. Please interact with the page before stopping recording.';
        modalList.appendChild(msg);
      } else {
        modalSteps.forEach((step, idx) => {
          const li = document.createElement('li');
          li.className = 'screenshot-item';
          li.innerHTML = `
            <img src="${step.screenshot}" />
            <button class="delete-icon">×</button>
            <textarea class="desc-edit">${step.description}</textarea>
          `;
          li.querySelector('.delete-icon').onclick = () => {
            modalSteps.splice(idx, 1);
            chrome.runtime.sendMessage({ action: 'UPDATE_STEPS', steps: modalSteps });
            renderModalList();
          };
          li.querySelector('.desc-edit').onchange = (e) => {
            modalSteps[idx].description = e.target.value;
            chrome.runtime.sendMessage({ action: 'UPDATE_STEPS', steps: modalSteps });
          };
          modalList.appendChild(li);
        });
      }
  const any2 = modalSteps.length === 0;
  modalDownloadBtn.disabled = any2;
  modalDownloadHtmlBtn.disabled = any2;
  modalDownloadWordBtn.disabled = any2;
    }

    renderModalList();

    modalDownloadBtn.onclick = () => {
      // Show loading state
      const originalText = modalDownloadBtn.textContent;
      modalDownloadBtn.disabled = true;
      modalDownloadBtn.innerHTML = '<span style="display: inline-block; width: 16px; height: 16px; border: 2px solid #ffffff; border-radius: 50%; border-top-color: transparent; animation: spin 1s linear infinite; margin-right: 8px;"></span>Generating PDF...';
      
      // Send message to background script to handle PDF generation
      try {
        chrome.runtime.sendMessage({
          action: 'GENERATE_PDF',
          steps: modalSteps
        }, (response) => {
          // Reset button state
          modalDownloadBtn.disabled = modalSteps.length === 0;
          modalDownloadBtn.textContent = originalText;
          
          if (chrome.runtime.lastError) {
            alert('Error generating PDF. Please try again.');
            return;
          }
          
          if (response && response.success) {
          } else {
            alert('Error generating PDF: ' + (response ? response.error : 'Unknown error'));
          }
        });
      } catch (error) {
        // Reset button state on error
        modalDownloadBtn.disabled = modalSteps.length === 0;
        modalDownloadBtn.textContent = originalText;
        
        alert('Extension context error. Please reload the page and try again.');
      }
    };

    function handleOtherExport(action, btn, label) {
      const originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span style="display: inline-block; width: 16px; height: 16px; border: 2px solid #ffffff; border-radius: 50%; border-top-color: transparent; animation: spin 1s linear infinite; margin-right: 8px;"></span>' + `Generating ${label}...`;
      try {
        chrome.runtime.sendMessage({ action, steps: modalSteps }, (response) => {
          btn.disabled = modalSteps.length === 0;
          btn.innerHTML = originalHTML;
          if (chrome.runtime.lastError) {
            alert(`Error generating ${label}. Please try again.`);
            return;
          }
          if (!response || !response.success) {
            alert(`Error generating ${label}: ` + (response ? response.error : 'Unknown error'));
          }
        });
      } catch (error) {
        btn.disabled = modalSteps.length === 0;
        btn.innerHTML = originalHTML;
        alert('Extension context error. Please reload the page and try again.');
      }
    }

    // Hook buttons
    modalDownloadHtmlBtn.onclick = () => handleOtherExport('GENERATE_HTML', modalDownloadHtmlBtn, 'HTML');
    modalDownloadWordBtn.onclick = () => handleOtherExport('GENERATE_WORD', modalDownloadWordBtn, 'Word');
  }

  // Show modal immediately without jsPDF loading
  showModal();
}

async function captureNavigationEvent(url) {
  const description = `Navigated to ${url}`;
  // Wait a moment for page to render
  await new Promise(res => setTimeout(res, 300));
  await new Promise(res => setTimeout(res, 80));
  chrome.runtime.sendMessage({
    action: 'CAPTURE_SCREENSHOT',
    description: description,
    highlight: { left: 0, top: 0, width: window.innerWidth, height: 60 }
  }, async (screenshotUrl) => {
    if (screenshotUrl) {
      const img = new window.Image();
      img.src = screenshotUrl;
      img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // No highlighting for navigation events since address bar isn't captured
        const screenshot = canvas.toDataURL('image/png');
        steps.push({
          description,
          screenshot: screenshot,
          highlight: { left: 0, top: 0, width: window.innerWidth, height: 60 }
        });
        chrome.runtime.sendMessage({ action: 'SET_TAB_STATE', isRecording: true, steps });
      };
    }
  });
} 