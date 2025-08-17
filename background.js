import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// Store state per tab
const tabState = {};

// Helper to convert Uint8Array to base64 (service worker safe)
function uint8ToBase64(uint8) {
  const CHUNK_SIZE = 0x8000; // 32KB
  let index = 0;
  const length = uint8.length;
  let result = '';
  let slice;
  while (index < length) {
    slice = uint8.subarray(index, Math.min(index + CHUNK_SIZE, length));
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK_SIZE;
  }
  return btoa(result);
}

// Helper to robustly wrap text for pdf-lib
function wrapText(description, font, fontSize, maxWidth) {
  const lines = [];
  const paragraphs = description.split('\n');
  for (const paragraph of paragraphs) {
    let words = paragraph.split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
      let word = words[i];
      // If this is the first word and the line is empty, preserve any prefix (e.g., "Step 2: Navigated to ")
      if (i === 0 && line === '' && word.length > 0) {
        // Try to fit as much of the first word as possible with the prefix
        let fit = 0;
        while (
          fit < word.length &&
          font.widthOfTextAtSize(line + word.slice(0, fit + 1), fontSize) <= maxWidth
        ) {
          fit++;
        }
        if (fit < word.length) {
          // The first word is too long, break it
          lines.push(line + word.slice(0, fit));
          word = word.slice(fit);
          // Now break the rest of the word as usual
          while (word.length > 0) {
            fit = 1;
            while (
              fit < word.length &&
              font.widthOfTextAtSize(word.slice(0, fit + 1), fontSize) <= maxWidth
            ) {
              fit++;
            }
            lines.push(word.slice(0, fit));
            word = word.slice(fit);
          }
          line = '';
          continue;
        }
      }
      // For all other words, break if needed
      while (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let fit = 1;
        while (
          fit < word.length &&
          font.widthOfTextAtSize(word.slice(0, fit + 1), fontSize) <= maxWidth
        ) {
          fit++;
        }
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, fit));
        word = word.slice(fit);
      }
      let testLine = line ? line + ' ' + word : word;
      let testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

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
        sendResponse({ isRecording: false, steps: [] });
      } else {
        sendResponse(tabState[tabId]);
      }
    } else {
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
    (async () => {
      try {
        const pdfDoc = await PDFDocument.create();
        const PAGE_WIDTH = 595;
        const PAGE_HEIGHT = 842;
        const MARGIN = 40;
        const IMAGE_MAX_WIDTH = PAGE_WIDTH - 2 * MARGIN;
        const IMAGE_MAX_HEIGHT = 400;
        const FONT_SIZE = 12;
        const LINE_HEIGHT = 1.2 * FONT_SIZE;
        const PADDING = 32;
        let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        let y = PAGE_HEIGHT - MARGIN;
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        for (let idx = 0; idx < msg.steps.length; idx++) {
          const step = msg.steps[idx];
          // Add running number to description
          const stepNumber = `Step ${idx + 1}: `;
          const description = stepNumber + (step.description || '');
          // Prepare image if present
          let width = 0, height = 0, imageHeight = 0, imageY = y, imageX = MARGIN;
          let pngImage = null;
          const maxTextWidth = PAGE_WIDTH - 2 * MARGIN;
          const lines = wrapText(description, font, FONT_SIZE, maxTextWidth);
          const minTextBlockHeight = LINE_HEIGHT + PADDING;
          if (step.screenshot) {
            const pngData = step.screenshot.replace(/^data:image\/png;base64,/, '');
            pngImage = await pdfDoc.embedPng(pngData);
            ({ width, height } = pngImage);
            let scale = Math.min(IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height, 1);
            width *= scale;
            height *= scale;
            imageHeight = height;
            // Ensure there is enough space for image + at least one line of text
            if (y - imageHeight - minTextBlockHeight < MARGIN) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN;
            }
            imageX = MARGIN + (IMAGE_MAX_WIDTH - width) / 2;
            page.drawImage(pngImage, {
              x: imageX,
              y: y - imageHeight,
              width,
              height,
            });
            // Draw a subtle border around the image
            page.drawRectangle({
              x: imageX,
              y: y - imageHeight,
              width,
              height,
              borderColor: rgb(0.8, 0.8, 0.8),
              borderWidth: 1,
            });
            y -= imageHeight + PADDING;
          } else {
            // If no image, ensure at least one line of text fits
            if (y - minTextBlockHeight < MARGIN) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN;
            }
          }
          // Draw wrapped text, continuing on new pages if needed
          for (const line of lines) {
            if (y - LINE_HEIGHT < MARGIN) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN;
            }
            page.drawText(line, {
              x: MARGIN,
              y: y - FONT_SIZE,
              size: FONT_SIZE,
              font: font,
              color: rgb(0, 0, 0),
              maxWidth: maxTextWidth,
            });
            y -= LINE_HEIGHT;
          }
          y -= PADDING;
        }
        const pdfBytes = await pdfDoc.save();
        const base64 = uint8ToBase64(pdfBytes);
        const dataUrl = 'data:application/pdf;base64,' + base64;
        chrome.downloads.download({
          url: dataUrl,
          filename: 'recorded_steps.pdf',
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true });
          }
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'GENERATE_HTML' || msg.action === 'GENERATE_WORD') {
    try {
      const steps = msg.steps || [];
      const docTitle = 'Recorded Steps';
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${docTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #ffffff; margin: 24px; }
    .container { max-width: 840px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 16px 0; }
    .step { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .step h2 { font-size: 16px; margin: 0 0 8px 0; color: #111827; }
    .desc { font-size: 14px; margin-bottom: 12px; color: #374151; white-space: pre-wrap; }
    img.step-img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; }
  </style>
  ${msg.action === 'GENERATE_WORD' ? '<xml><w:wordDocument xmlns:w="http://schemas.microsoft.com/office/word/2003/wordml"></w:wordDocument></xml>' : ''}
  
</head>
<body>
  <div class="container">
    <h1>${docTitle}</h1>
    ${steps.map((s, i) => `
      <div class="step">
        <h2>Step ${i + 1}</h2>
        <div class="desc">${(s.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        ${s.screenshot ? `<img class="step-img" src="${s.screenshot}" alt="Step ${i + 1}" />` : ''}
      </div>
    `).join('')}
  </div>
</body>
</html>`;

      const mime = msg.action === 'GENERATE_WORD' ? 'application/msword' : 'text/html';
      const ext = msg.action === 'GENERATE_WORD' ? 'doc' : 'html';
      const dataUrl = `data:${mime};charset=utf-8,` + encodeURIComponent(html);
      chrome.downloads.download({
        url: dataUrl,
        filename: `recorded_steps.${ext}`,
        saveAs: true
      }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

// Listen for tab updates (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabState[tabId] && tabState[tabId].isRecording) {
    chrome.tabs.sendMessage(tabId, { action: 'PAGE_NAVIGATED', url: tab.url });
  }
});

// Listen for tab removal to clean up state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabState[tabId]) {
    delete tabState[tabId];
  }
}); 