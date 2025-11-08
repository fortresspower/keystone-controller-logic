/**
 * Returns the bit value (0 or 1) of an integer at a given bit position.
 * Example: getBit(5, 0) -> 1, getBit(5, 2) -> 1, getBit(5, 1) -> 0
 */
export function getBit(value: number, bitPosition: number): number {
  if (!Number.isInteger(value) || !Number.isInteger(bitPosition) || bitPosition < 0) {
    throw new Error('Invalid arguments: both must be non-negative integers');
  }
  return (value >> bitPosition) & 1;
}
