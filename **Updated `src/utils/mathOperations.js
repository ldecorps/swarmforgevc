// Constants for discount limits and multipliers
const PREMIUM_MAX_DISCOUNT = 0.2;
const NON_PREMIUM_MAX_DISCOUNT = 0.1;
const PREMIUM_BONUS_MULTIPLIER = 0.9;
const NON_PREMIUM_DISCOUNT_REDUCTION = 0.5;

/**
 * Calculates the final price after applying discounts.
 * @param {number} price - Original price (must be ≥ 0).
 * @param {number} discountRate - Discount rate (0 ≤ rate ≤ 1).
 * @param {boolean} isPremium - Whether the customer is premium.
 * @returns {number} Final price after discounts.
 * @throws {Error} If inputs are invalid.
 */
export function calculateDiscount(price, discountRate, isPremium) {
  if (price < 0) throw new Error('Price must be non-negative');
  if (discountRate < 0 || discountRate > 1) throw new Error('Discount rate must be between 0 and 1');

  const maxDiscount = isPremium ? PREMIUM_MAX_DISCOUNT : NON_PREMIUM_MAX_DISCOUNT;
  const effectiveDiscount = Math.min(discountRate, maxDiscount);
  const discountMultiplier = isPremium
    ? PREMIUM_BONUS_MULTIPLIER
    : (1 - effectiveDiscount * NON_PREMIUM_DISCOUNT_REDUCTION);

  return price * (1 - effectiveDiscount) * discountMultiplier;
}
