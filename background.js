// Content scripts can't open browser windows; they ask here.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'axs:openWindow' || sender.id !== chrome.runtime.id) return;
  let url;
  try {
    url = new URL(msg.url);
  } catch {
    return reply({ ok: false, message: 'Bad link' });
  }
  if (!/^https?:$/.test(url.protocol)) return reply({ ok: false, message: 'Not a web link' });
  chrome.windows.create({ url: url.href, focused: true })
    .then(() => reply({ ok: true }), err => reply({ ok: false, message: err.message }));
  return true;
});
