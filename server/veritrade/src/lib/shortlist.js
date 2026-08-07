// Client-side shortlist — there is no backend shortlist table/endpoint (not part of
// what was directed to be built), so "save candidates" is a per-browser localStorage
// list of user_ids, same trust boundary as any other browser bookmark. Good enough
// for v1; a real cross-device shortlist would need a server table, out of scope here.
const KEY = 'vtShortlist';

export function getShortlist() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

export function isShortlisted(userId) {
  return getShortlist().includes(userId);
}

export function toggleShortlist(userId) {
  const list = getShortlist();
  const next = list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
