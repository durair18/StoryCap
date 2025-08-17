let steps = [];
const list = document.getElementById('screenshot-list');
const downloadBtn = document.getElementById('download-pdf');

// Get steps from background script instead of storage
chrome.runtime.sendMessage({ action: 'GET_STEPS' }, (response) => {
  steps = response || [];
  renderList();
});

function renderList() {
  downloadBtn.disabled = steps.length === 0;
  list.innerHTML = '';
  if (steps.length === 0) {
    const msg = document.createElement('div');
    msg.style.textAlign = 'center';
    msg.style.color = '#888';
    msg.style.fontSize = '18px';
    msg.style.margin = '40px 0';
    msg.textContent = 'No steps recorded yet. Please interact with the page before stopping recording.';
    list.appendChild(msg);
  } else {
    steps.forEach((step, idx) => {
      const li = document.createElement('li');
      li.className = 'screenshot-item';
      li.innerHTML = `
        <img src="${step.screenshot}" />
        <textarea class="desc-edit">${step.description}</textarea>
        <button class="delete-btn">Delete</button>
      `;
      li.querySelector('.delete-btn').onclick = () => {
        steps.splice(idx, 1);
        renderList();
        downloadBtn.disabled = steps.length === 0;
      };
      li.querySelector('.desc-edit').onchange = (e) => {
        steps[idx].description = e.target.value;
      };
      list.appendChild(li);
    });
  }
  downloadBtn.disabled = steps.length === 0;
}

downloadBtn.onclick = () => {
  chrome.runtime.sendMessage({ action: 'GENERATE_PDF', steps });
}; 