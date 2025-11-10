export function getBit(v: number, b: number) {
  if (b < 0 || b > 31) throw RangeError("bit 0..31");
  return (v >>> b) & 1;
}

export function setBit(v: number, b: number, on: boolean) {
  if (b < 0 || b > 31) throw RangeError("bit 0..31");
  return on ? (v | (1 << b)) >>> 0 : (v & ~(1 << b)) >>> 0;
}

export function getBits(v: number, s: number, l: number) {
  if (s < 0 || s > 31 || l < 1 || l > 32 - s) throw RangeError("range");
  const mask = ((1 << l) - 1) >>> 0;
  return (v >>> s) & mask;
}
