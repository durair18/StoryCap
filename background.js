import { jsPDF } from 'jspdf';

// Store state per tab
const tabState = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId || (sender.tab ? sender.tab.id : null);
  
  if (msg.action === 'GET_STEPS') {
    if (tabId && tabState[tabId]) {
      sendResponse(tabState[tabId].steps);
    } else {
      sendResponse([]);
    }
    return true;
  }
  if (msg.action === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
      sendResponse(dataUrl);
    });
    return true;
  }
  if (msg.action === 'DELETE_STEPS') {
    if (tabId && tabState[tabId]) {
      tabState[tabId].steps = [];
    }
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'UPDATE_STEPS') {
    if (tabId) {
      tabState[tabId] = tabState[tabId] || { isRecording: false, steps: [] };
      tabState[tabId].steps = msg.steps;
    }
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'SET_TAB_STATE') {
    console.log('SET_TAB_STATE:', { tabId, isRecording: msg.isRecording, stepsCount: msg.steps ? msg.steps.length : 0 });
    if (tabId) {
      tabState[tabId] = tabState[tabId] || { isRecording: false, steps: [] };
      tabState[tabId].isRecording = msg.isRecording;
      tabState[tabId].steps = msg.steps;
      
      // If stopping recording, set the timestamp
      if (!msg.isRecording) {
        tabState[tabId].recordingStoppedAt = Date.now();
      }
    }
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'GET_TAB_STATE') {
    if (tabId && tabState[tabId]) {
      // Check if recording was recently stopped (within 5 seconds)
      const timeSinceStopped = Date.now() - (tabState[tabId].recordingStoppedAt || 0);
      if (tabState[tabId].isRecording && timeSinceStopped <= 5000) {
        console.log('GET_TAB_STATE: recording recently stopped, returning clean state');
        sendResponse({ isRecording: false, steps: [] });
      } else {
        console.log('GET_TAB_STATE: returning state for tab', tabId, 'with', tabState[tabId].steps.length, 'steps');
        sendResponse(tabState[tabId]);
      }
    } else {
      console.log('GET_TAB_STATE: no state found for tab', tabId);
      sendResponse({ isRecording: false, steps: [] });
    }
    return true;
  }
  if (msg.action === 'ADD_NAVIGATION_EVENT') {
    if (tabId) {
      tabState[tabId] = tabState[tabId] || { isRecording: false, steps: [] };
      tabState[tabId].steps.push(msg.step);
    }
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'GENERATE_PDF') {
    console.log('Generating PDF with', msg.steps.length, 'steps');
    try {
      // Generate PDF directly using imported jsPDF
      const pdf = new jsPDF();
      const imgWidth = 180;
      const imgHeight = 100;
      
      msg.steps.forEach((step, idx) => {
        if (idx > 0) pdf.addPage();
        pdf.text(step.description, 10, 15);
        pdf.addImage(step.screenshot, 'PNG', 10, 25, imgWidth, imgHeight, undefined, 'FAST');
      });
      
      // Convert PDF to data URL and download
      const pdfDataUrl = pdf.output('datauristring');
      
      chrome.downloads.download({
        url: pdfDataUrl,
        filename: 'recorded_steps.pdf',
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('PDF download error:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('PDF downloaded successfully');
          sendResponse({ success: true });
        }
      });
      
    } catch (error) {
      console.error('PDF generation error:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true;
  }
});

// Listen for tab updates (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabState[tabId] && tabState[tabId].isRecording) {
    console.log('Tab navigation detected for recording tab', tabId);
    chrome.tabs.sendMessage(tabId, { action: 'PAGE_NAVIGATED', url: tab.url });
  }
});

// Listen for tab removal to clean up state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabState[tabId]) {
    console.log('Cleaning up state for closed tab:', tabId);
    delete tabState[tabId];
  }
}); 