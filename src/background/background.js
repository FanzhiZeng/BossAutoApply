// background.js (MV3 service worker)
// 职责很单一：接收 content script 上报的进度，缓存最新状态，
// 供 popup 打开时立刻读取（即使 popup 在任务运行期间被关闭过）。

let latestState = {
  running: false,
  appliedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  log: []
};

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'BA_PROGRESS') {
    latestState = message.payload;
    chrome.storage.session.set({ ba_latest_state: latestState }).catch(() => {});

    if (sender.tab && sender.tab.id) {
      const badgeText = latestState.running ? String(latestState.appliedCount) : '';
      chrome.action.setBadgeText({ text: badgeText, tabId: sender.tab.id }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb', tabId: sender.tab.id }).catch(() => {});
    }
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'BA_GET_LATEST_STATE') {
    chrome.storage.session.get('ba_latest_state').then((data) => {
      sendResponse(data.ba_latest_state || latestState);
    });
    return true;
  }
  return false;
});
