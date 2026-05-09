"use client";

/**
 * Per-browser cache of chains the user has touched. Keyed by chain id.
 * Source of truth for the "My chains" list on home; lets us show names and
 * last-visited timestamps without scanning Waku/the chain on every render.
 */

export type ChainRole = "creator" | "member";

export interface LocalChainEntry {
  id: string; // chain id as decimal string
  name: string; // user-supplied label, empty if none
  role: ChainRole;
  joinedAt: number; // ms
  lastVisitedAt: number; // ms
}

const KEY = "pc_chains";

function loadAll(): Record<string, LocalChainEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalChainEntry>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(map: Record<string, LocalChainEntry>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

export function listLocalChains(): LocalChainEntry[] {
  const all = loadAll();
  return Object.values(all).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}

export function getLocalChain(id: string): LocalChainEntry | null {
  return loadAll()[id] ?? null;
}

/** Insert or merge an entry. */
export function upsertLocalChain(entry: Partial<LocalChainEntry> & { id: string }): LocalChainEntry {
  const all = loadAll();
  const existing = all[entry.id];
  const now = Date.now();
  const merged: LocalChainEntry = {
    id: entry.id,
    name: entry.name ?? existing?.name ?? "",
    role: entry.role ?? existing?.role ?? "member",
    joinedAt: existing?.joinedAt ?? entry.joinedAt ?? now,
    lastVisitedAt: entry.lastVisitedAt ?? now,
  };
  // Don't downgrade creator -> member on revisit
  if (existing?.role === "creator") merged.role = "creator";
  all[entry.id] = merged;
  saveAll(all);
  return merged;
}

export function bumpVisit(id: string): void {
  const all = loadAll();
  if (all[id]) {
    all[id].lastVisitedAt = Date.now();
    saveAll(all);
  } else {
    upsertLocalChain({ id, role: "member" });
  }
}

export function setLocalChainName(id: string, name: string): void {
  const all = loadAll();
  if (!all[id]) {
    upsertLocalChain({ id, name, role: "member" });
    return;
  }
  all[id].name = name;
  saveAll(all);
}
