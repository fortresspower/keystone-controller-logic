import { bitTools } from '../src'; // or: import { getBit } from '../src/bitTools';

describe('bitTools.getBit', () => {
  it('reads bits correctly', () => {
    expect(bitTools.getBit(5, 0)).toBe(1); // 101b
    expect(bitTools.getBit(5, 1)).toBe(0);
    expect(bitTools.getBit(5, 2)).toBe(1);
  });

  it('throws on invalid args', () => {
    expect(() => bitTools.getBit(5, -1)).toThrow();
    expect(() => bitTools.getBit(3.3, 1)).toThrow();
  });
});
