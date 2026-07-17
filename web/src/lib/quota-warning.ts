/** Monthly quota warning thresholds — aligned with dashboard usage card. */
export const QUOTA_WARN_RATIO = 0.8;

/** Same as WM / Streamlit `CREDIT_BALANCE_ALWAYS_WARN_BELOW`. */
export const CREDIT_BALANCE_ALWAYS_WARN_BELOW = 15;

export interface QuotaUsage {
  total: number;
  quota: number | null;
}

export interface CreditBalance {
  total: number;
  used: number;
  remaining: number;
}

export interface QuotaBannerSnapshot {
  usage?: QuotaUsage | null;
  credits?: CreditBalance | null;
}

export function shouldShowQuotaWarningBanner(usage: QuotaUsage | null | undefined): boolean {
  if (!usage?.quota || usage.quota <= 0) return false;
  return usage.total / usage.quota >= QUOTA_WARN_RATIO;
}

export function isQuotaExceeded(usage: QuotaUsage): boolean {
  return usage.total >= usage.quota!;
}

export function quotaUsageLabel(usage: QuotaUsage): string {
  return `${usage.total.toLocaleString()} / ${usage.quota!.toLocaleString()}`;
}

export function shouldShowCreditWarningBanner(balance: CreditBalance | null | undefined): boolean {
  if (!balance || balance.total <= 0) return false;
  const remaining = Math.trunc(balance.remaining);
  if (remaining <= 0) return true;
  if (remaining < CREDIT_BALANCE_ALWAYS_WARN_BELOW) return true;
  return balance.used / balance.total >= QUOTA_WARN_RATIO;
}

export function isCreditsDepleted(balance: CreditBalance): boolean {
  return Math.trunc(balance.remaining) <= 0;
}

export function shouldShowQuotaWarningBannerFromSnapshot(snapshot: QuotaBannerSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return shouldShowQuotaWarningBanner(snapshot.usage) || shouldShowCreditWarningBanner(snapshot.credits);
}

export type BannerKind = 'quota-exceeded' | 'quota-warning' | 'credits-depleted' | 'credits-warning';

export function resolveBannerKind(snapshot: QuotaBannerSnapshot): BannerKind | null {
  const usage = snapshot.usage;
  if (usage && shouldShowQuotaWarningBanner(usage)) {
    return isQuotaExceeded(usage) ? 'quota-exceeded' : 'quota-warning';
  }
  const credits = snapshot.credits;
  if (credits && shouldShowCreditWarningBanner(credits)) {
    return isCreditsDepleted(credits) ? 'credits-depleted' : 'credits-warning';
  }
  return null;
}

export function bannerMessage(snapshot: QuotaBannerSnapshot, kind: BannerKind): string {
  const usage = snapshot.usage;
  const credits = snapshot.credits;
  switch (kind) {
    case 'quota-exceeded':
      return usage ? `Monthly quota reached: ${quotaUsageLabel(usage)} used.` : 'Monthly quota reached.';
    case 'quota-warning':
      return usage
        ? `You're close to your limit: ${quotaUsageLabel(usage)} monthly quota used.`
        : "You're close to your monthly quota limit.";
    case 'credits-depleted':
      return 'You have no credits remaining.';
    case 'credits-warning':
      return credits
        ? `Running out of credits: ${Math.trunc(credits.remaining).toLocaleString()} remaining.`
        : 'Running out of credits.';
  }
}

export function isBannerPersistent(kind: BannerKind): boolean {
  return kind === 'quota-exceeded' || kind === 'credits-depleted';
}
