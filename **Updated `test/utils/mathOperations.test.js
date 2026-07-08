import { calculateDiscount } from '../../src/utils/mathOperations';

describe('calculateDiscount', () => {
  // Premium customer tests
  test('applies premium discount correctly', () => {
    expect(calculateDiscount(100, 0.2, true)).toBe(72); // 100 * 0.8 * 0.9
  });

  test('caps premium discount at 20%', () => {
    expect(calculateDiscount(100, 0.3, true)).toBe(72); // 100 * 0.8 * 0.9
  });

  test('handles zero discount for premium', () => {
    expect(calculateDiscount(100, 0, true)).toBe(90); // 100 * 1 * 0.9
  });

  // Non-premium customer tests
  test('applies non-premium discount correctly', () => {
    expect(calculateDiscount(100, 0.1, false)).toBe(95); // 100 * 0.95
  });

  test('caps non-premium discount at 10%', () => {
    expect(calculateDiscount(100, 0.2, false)).toBe(95); // 100 * 0.95
  });

  test('reduces non-premium discount by 50%', () => {
    expect(calculateDiscount(100, 0.05, false)).toBe(97.5); // 100 * (1 - 0.05*0.5)
  });

  // Edge cases
  test('throws for negative price', () => {
    expect(() => calculateDiscount(-100, 0.1, false)).toThrow('Price must be non-negative');
  });

  test('throws for invalid discount rate', () => {
    expect(() => calculateDiscount(100, 1.1, false)).toThrow('Discount rate must be between 0 and 1');
  });

  test('handles floating-point precision', () => {
    expect(calculateDiscount(99.99, 0.15, true)).toBeCloseTo(71.9928); // 99.99 * 0.85 * 0.9
  });
});
