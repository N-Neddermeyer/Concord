// IDs no formato Snowflake do Discord: 42 bits de timestamp (desde 2015-01-01),
// 5 bits de worker, 5 de processo e 12 de sequência.
const EPOCH = 1420070400000n;
const WORKER = 1n << 17n;

let lastMs = 0n;
let sequence = 0n;

export function snowflake() {
  let now = BigInt(Date.now());
  if (now === lastMs) {
    sequence = (sequence + 1n) & 0xfffn;
    if (sequence === 0n) while (now <= lastMs) now = BigInt(Date.now());
  } else {
    sequence = 0n;
  }
  lastMs = now;
  return String(((now - EPOCH) << 22n) | WORKER | sequence);
}

export function timestampOf(id) {
  return new Date(Number((BigInt(id) >> 22n) + EPOCH)).toISOString();
}
