import { calculateDiscount } from '../../src/utils/mathOperations';

describe('calculateDiscount', () => {
  test('applies premium discount correctly', () => {
    expect(calculateDiscount(100, 0.2, true)).toBe(72); // 100 * 0.8 * 0.9
  });

  test('caps premium discount at 20%', () => {
    expect(calculateDiscount(100, 0.3, true)).toBe(72); // 100 * 0.8 * 0.9
  });

  test('applies non-premium discount correctly', () => {
    expect(calculateDiscount(100, 0.1, false)).toBe(95); // 100 * 0.95
  });

  test('caps non-premium discount at 10%', () => {
    expect(calculateDiscount(100, 0.2, false)).toBe(95); // 100 * 0.95
  });
});
