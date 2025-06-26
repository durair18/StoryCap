console.log('editor.js loaded');

let steps = [];
const list = document.getElementById('screenshot-list');
const downloadBtn = document.getElementById('download-pdf');

console.log('editor.js loaded 2');

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
  generatePDF();
};

function generatePDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  steps.forEach((step, idx) => {
    if (idx > 0) pdf.addPage();
    pdf.text(step.description, 10, 15);
    pdf.addImage(step.screenshot, 'PNG', 10, 25, 180, 100, undefined, 'FAST');
  });
  pdf.save('recorded_steps.pdf');
} 