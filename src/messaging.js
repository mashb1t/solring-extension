// Content-script → worker messaging helpers. Thin Promise wrappers over
// chrome.runtime.sendMessage; every response may carry { error }.

export function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

export const getDeck = (md5, force = false) => send({ type: 'getDeck', md5, force });
export const getUserDecks = (username, cursor) => send({ type: 'getUserDecks', username, cursor });
export const importDeck = (canonicalUrl, md5) => send({ type: 'importDeck', canonicalUrl, md5 });
