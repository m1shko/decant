const DEFAULTS = { action: 'open', thumbnails: true };

for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = chrome.i18n.getMessage(node.dataset.i18n);

chrome.storage.sync.get(DEFAULTS).then((prefs) => {
  document.querySelector(`input[name="action"][value="${prefs.action}"]`).checked = true;
  document.querySelector('input[name="thumbnails"]').checked = prefs.thumbnails;
});

document.addEventListener('change', (e) => {
  const input = e.target;
  chrome.storage.sync.set({ [input.name]: input.type === 'checkbox' ? input.checked : input.value });
});
