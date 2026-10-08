import type { DomainVersions, FrozenChallengeDefinition } from "./types";

export const SNAPSHOT_VERSION = "mcs.challenge.snapshot/1";
export const SCHEMA_VERSION = "mcs.challenge.schema/1";
export const ACCOUNTING_VERSION = "usd-micros/1";
export const ROUNDING_VERSION = "half-even-ledger-posting/1";
export const CALENDAR_VERSION = "utc-midnight/1";
export const RULES_VERSION = "mcs.challenge.rules/1";
export const EXECUTION_VERSION = "mcs.challenge.execution/1";

export const DOMAIN_VERSIONS: Readonly<DomainVersions> = Object.freeze({
  snapshot: SNAPSHOT_VERSION,
  schema: SCHEMA_VERSION,
  accounting: ACCOUNTING_VERSION,
  rounding: ROUNDING_VERSION,
  calendar: CALENDAR_VERSION,
  rules: RULES_VERSION,
  execution: EXECUTION_VERSION,
});

export function assertSupportedDomainVersions(versions: DomainVersions): void {
  for (const [name, expected] of Object.entries(DOMAIN_VERSIONS)) {
    const actual = versions[name as keyof DomainVersions];
    if (actual !== expected) {
      throw new RangeError(`Unsupported ${name} version "${actual}". Expected "${expected}".`);
    }
  }
}

function canonicalValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === "bigint") {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON rejects values of type ${typeof value}.`);
  }
  if (seen.has(value)) throw new TypeError("Canonical JSON rejects cyclic structures.");

  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalValue(entry, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects and arrays.");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const fields = keys.map((key) => {
      if (record[key] === undefined) {
        throw new TypeError(`Canonical JSON rejects undefined at key "${key}".`);
      }
      return `${JSON.stringify(key)}:${canonicalValue(record[key], seen)}`;
    });
    result = `{${fields.join(",")}}`;
  }
  seen.delete(value);
  return result;
}

export function canonicalStringify(value: unknown): string {
  return canonicalValue(value, new Set<object>());
}

function rotateRight(value: number, places: number): number {
  return (value >>> places) | (value << (32 - places));
}

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const paddingLength = (64 - ((bytes.length + 1 + 8) % 64)) % 64;
  const data = new Uint8Array(bytes.length + 1 + paddingLength + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;

  const bitLength = bytes.length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(data.length - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

export function canonicalHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalStringify(value))}`;
}

export function isCanonicalHash(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

export function frozenDefinitionHashBasis(
  definition: Omit<FrozenChallengeDefinition, "definitionHash"> | FrozenChallengeDefinition,
): Omit<FrozenChallengeDefinition, "definitionHash"> {
  const { definitionHash: _ignored, ...basis } = definition as FrozenChallengeDefinition;
  return basis;
}
