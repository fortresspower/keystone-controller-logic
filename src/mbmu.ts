export function parseOutage(row48: number): boolean {
  return ((row48 >>> 7) & 1) === 1;
}
