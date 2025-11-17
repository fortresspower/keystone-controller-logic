export function getBit(value: number, bit: number): 0 | 1 {
  // Validate args
  if (!Number.isInteger(value)) {
    throw new Error("getBit: value must be an integer");
  }
  if (!Number.isInteger(bit) || bit < 0 || bit > 31) {
    throw new Error("getBit: bit index must be an integer between 0 and 31");
  }

  const mask = 1 << bit;
  return ((value & mask) !== 0 ? 1 : 0) as 0 | 1;
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
