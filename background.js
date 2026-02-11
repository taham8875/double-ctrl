chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename || 'image.png',
      saveAs: true
    }, (downloadId) => {
      sendResponse({ success: !!downloadId });
    });
    return true; // Keep channel open for async response
  }
});
