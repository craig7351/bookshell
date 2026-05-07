import { createSignal } from "solid-js";

const [searchTabId, setSearchTabId] = createSignal<string | null>(null);

export { searchTabId };

export function openSearch(tabId: string) {
  setSearchTabId(tabId);
}

export function closeSearch() {
  setSearchTabId(null);
}

export function isSearchOpenFor(tabId: string): boolean {
  return searchTabId() === tabId;
}
