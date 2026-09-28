export type PaymentMode = 'none' | 'full' | 'percent' | 'fixed';
export type PaymentPolicy = { paymentMode: PaymentMode; paymentPercent: number; paymentFixedCents: number };

export function chargeAmountCents(totalCents: number, policy: PaymentPolicy): number {
  if (totalCents <= 0 || policy.paymentMode === 'none') return 0;
  if (policy.paymentMode === 'percent') return Math.min(totalCents, Math.max(1, Math.round(totalCents * policy.paymentPercent / 100)));
  if (policy.paymentMode === 'fixed') return Math.min(totalCents, policy.paymentFixedCents);
  return totalCents;
}
