// Stripe Price IDs for each membership plan + billing period combination.
// These are the production prices we created in the SDG Memberships Stripe account.

export const STRIPE_PRICES = {
  cowork: {
    monthly: {
      id: 'price_1TeZTIPt9atNoUkkAxBe6BwO',
      label: 'Monthly',
      displayPrice: '$155',
      periodLabel: 'per month',
      cents: 15500,
    },
    quarterly: {
      id: 'price_1TeZTpPt9atNoUkkWmsjncbD',
      label: 'Quarterly',
      displayPrice: '$442',
      periodLabel: 'per 3 months',
      cents: 44200,
      savingsLabel: 'Save $23',
    },
    annual: {
      id: 'price_1TeZToPt9atNoUkkI2XLZbOF',
      label: 'Annual',
      displayPrice: '$1,545',
      periodLabel: 'per year',
      cents: 154500,
      savingsLabel: 'Save $315 — about 2 months free',
    },
  },
  iykyk: {
    monthly: {
      id: 'price_1TeZUOPt9atNoUkkar4KmJa2',
      label: 'Monthly',
      displayPrice: '$225',
      periodLabel: 'per month',
      cents: 22500,
    },
    quarterly: {
      id: 'price_1TeZUvPt9atNoUkkLmnLcH6U',
      label: 'Quarterly',
      displayPrice: '$641',
      periodLabel: 'per 3 months',
      cents: 64100,
      savingsLabel: 'Save $34',
    },
    annual: {
      id: 'price_1TeZUvPt9atNoUkkHJwPlfm3',
      label: 'Annual',
      displayPrice: '$2,241',
      periodLabel: 'per year',
      cents: 224100,
      savingsLabel: 'Save $459 — about 2 months free',
    },
  },
};

export const PLAN_DISPLAY = {
  cowork: 'Cowork',
  // Internal key stays 'iykyk' (matches Stripe + DB), display label is now "Experience".
  iykyk: 'Experience',
};

// Reverse lookup — given a Stripe price ID, find the plan + period.
// Used by the webhook handler to know what someone just subscribed to.
export function lookupPlanByPriceId(priceId) {
  for (const [plan, periods] of Object.entries(STRIPE_PRICES)) {
    for (const [period, info] of Object.entries(periods)) {
      if (info.id === priceId) {
        return { plan, period };
      }
    }
  }
  return null;
}
