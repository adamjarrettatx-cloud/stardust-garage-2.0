// Stripe Price IDs for each membership plan + billing period combination.
// These are the production prices we created in the SDG Memberships Stripe account.

import { MEMBERSHIP_TIERS } from './membership-tiers.js';

export const STRIPE_PRICES = {
  weekender: {
    monthly: {
      // Stripe product: prod_VEGvEtvuMHWSsw ("The Weekender")
      id: 'price_1UDoNrPt9atNoUkkvJYeiiyb',
      label: 'Monthly',
      displayPrice: '$48',
      periodLabel: 'per month',
      cents: 4800,
    },
  },
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

// PLAN_DISPLAY is a shim over the canonical MEMBERSHIP_TIERS registry
// (lib/membership-tiers.js). Keep this shape stable — many callers already
// import PLAN_DISPLAY.<key> directly — but never edit the labels here.
// Rename a tier by editing MEMBERSHIP_TIERS once and every surface updates.
export const PLAN_DISPLAY = Object.freeze({
  weekender: MEMBERSHIP_TIERS.weekender.label,
  cowork: MEMBERSHIP_TIERS.cowork.label,
  iykyk: MEMBERSHIP_TIERS.iykyk.label,
});

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
