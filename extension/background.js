// The toolbar button and the right-click menu: both hand the page (or the
// link) to Decant through a decant:// link.
importScripts('decant.js');

const t = (name) => chrome.i18n.getMessage(name);
const DEFAULTS = { action: 'open', thumbnails: true };

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

// Opening the decant:// link in the tab hands it to the app; the page stays.
async function send(tab, href, action) {
  const url = Decant.linkFor(href);
  if (!url || !tab?.id) return flash(tab, '!', t('nothingToSend'));
  await chrome.tabs.update(tab.id, { url: Decant.decantUrl(action, url) });
  flash(tab, '✓', action === 'save' ? t('savedTitle') : t('sentTitle'));
}

// A short mark on the toolbar button, as feedback.
function flash(tab, text, title) {
  const tabId = tab?.id;
  if (!tabId) return;
  chrome.action.setBadgeBackgroundColor({ color: text === '!' ? '#d93025' : '#6d4aff', tabId });
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    chrome.action.setTitle({ title: t('actionTitle'), tabId }).catch(() => {});
  }, 2500);
}

chrome.action.onClicked.addListener(async (tab) => send(tab, tab.url, (await settings()).action));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const menu = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });
    menu('open-link', t('menuOpenLink'), ['link']);
    menu('save-link', t('menuSaveLink'), ['link']);
    menu('open-page', t('menuOpenPage'), ['page', 'video', 'audio']);
    menu('save-page', t('menuSavePage'), ['page', 'video', 'audio']);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const [action, what] = info.menuItemId.split('-');
  send(tab, what === 'link' ? info.linkUrl : info.pageUrl, action);
});
