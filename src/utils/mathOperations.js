// Before (high CRAP due to complexity + low coverage)
export function calculateDiscount(price, discountRate, isPremium) {
  if (isPremium) {
    if (discountRate > 0.2) {
      return price * (1 - discountRate) * 0.9;
    } else {
      return price * (1 - discountRate);
    }
  } else {
    if (discountRate > 0.1) {
      return price * (1 - discountRate * 0.5);
    } else {
      return price;
    }
  }
}
