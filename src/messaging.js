// Content-script to worker messaging helpers. Thin Promise wrappers over
// chrome.runtime.sendMessage. Every response may carry { error }.

export function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

export const getDeck = (md5, opts = {}) => send({ type: 'getDeck', md5, ...opts });
export const getUserDecks = (username, cursor) => send({ type: 'getUserDecks', username, cursor });
export const importDeck = (canonicalUrl, md5, oldDeckId) => send({ type: 'importDeck', canonicalUrl, md5, oldDeckId });
