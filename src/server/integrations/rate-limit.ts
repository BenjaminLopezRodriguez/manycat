const WINDOW_MS = 30_000;
const lastByUser = new Map<string, number>();

export function assertNotRateLimited(userKey: string, now = Date.now()): void {
  const last = lastByUser.get(userKey);
  if (last !== undefined && now - last < WINDOW_MS) {
    throw new Error("Please wait before requesting again");
  }
}

export function markRateLimited(userKey: string, now = Date.now()): void {
  lastByUser.set(userKey, now);
}

export function _resetRateLimitForTests(): void {
  lastByUser.clear();
}
