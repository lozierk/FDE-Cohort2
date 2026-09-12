/**
 * Tier 1 of the search cache. Hand-written because it is fifteen lines and a dependency for
 * fifteen lines is a dependency you have to keep patched.
 *
 * A Map in JS iterates in insertion order, so "delete then set" moves a key to the back and
 * `keys().next()` is the least recently used one.
 */
export class Lru<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly max = 500) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, expiresAt: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
