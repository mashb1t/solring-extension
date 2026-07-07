// MAIN-world content script. Moxfield authenticates its deck-edit API (api2.moxfield.com)
// with a bearer token it holds in page memory and attaches to its own requests. A content
// script in the isolated world can't read that token, so this script runs in the page (MAIN)
// world, wraps fetch + XMLHttpRequest to observe the Authorization header Moxfield sets on its
// own API calls, and relays the latest value to the isolated content script via postMessage.
//
// The token is NEVER logged, stored, or sent anywhere except posted same-window (to our own
// content script) so the extension can perform deck edits (remove / move-to-board) the exact
// way Moxfield's UI does. It only enables actions the logged-in user could already do by hand.
(() => {
  let last = null;
  const relay = (v) => {
    if (!v || typeof v !== 'string' || !/^bearer /i.test(v) || v === last) return;
    last = v;
    // Same-origin target so no other page/frame receives it.
    window.postMessage({ __solringMoxToken: v }, location.origin);
  };
  const of = window.fetch;
  window.fetch = function (input, init) {
    try {
      const h = init && init.headers;
      if (h) relay(typeof h.get === 'function' ? h.get('authorization') : (h.authorization || h.Authorization));
    } catch { /* ignore */ }
    return of.apply(this, arguments);
  };
  const oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^authorization$/i.test(k)) relay(v); } catch { /* ignore */ }
    return oSet.apply(this, arguments);
  };
})();
