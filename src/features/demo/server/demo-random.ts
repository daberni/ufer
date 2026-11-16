/** Small seeded pseudo-random generator (FNV-1a seed, mulberry32 sequence) so a run date always yields the same dataset. */
export class DemoRandom {
  private state: number;

  constructor(seed: string) {
    let hash = 0x811c9dc5;

    for (const character of seed) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }

    this.state = hash >>> 0;
  }

  /** A float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  chance(probability: number) {
    return this.next() < probability;
  }

  /** An integer in [min, max]. */
  integer(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Minor units (cents) between two euro amounts. */
  amount(minEuros: number, maxEuros: number) {
    return this.integer(Math.round(minEuros * 100), Math.round(maxEuros * 100));
  }

  pick<T>(items: readonly T[]) {
    return items[Math.floor(this.next() * items.length)];
  }
}
