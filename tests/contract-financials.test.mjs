import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSplitPercent,
  extractFlatFeeCents,
  extractSalesTax,
  extractContractFinancialTerms,
  buildFinancialTermsPatch,
} from '../lib/contract-financials.js';

test('extractSplitPercent reads "50% of net profit"', () => {
  assert.equal(extractSplitPercent('Stardust receives 50% of net profit on ticket sales.'), 50);
});

test('extractSplitPercent reads "50/50 split"', () => {
  assert.equal(extractSplitPercent('The parties agree to a 50/50 split of proceeds.'), 50);
});

test('extractSplitPercent reads an uneven ratio', () => {
  assert.equal(extractSplitPercent('A 70/30 split applies.'), 70);
});

test('extractSplitPercent returns null when no split present', () => {
  assert.equal(extractSplitPercent('This contract has no financial split.'), null);
  assert.equal(extractSplitPercent(''), null);
  assert.equal(extractSplitPercent(null), null);
});

test('extractFlatFeeCents reads "$500 flat fee"', () => {
  assert.equal(extractFlatFeeCents('A $500 flat fee is due on signing.'), 50000);
});

test('extractFlatFeeCents reads "flat fee of $1,250.00"', () => {
  assert.equal(extractFlatFeeCents('Performer paid a flat fee of $1,250.00.'), 125000);
});

test('extractFlatFeeCents reads "guarantee of $750"', () => {
  assert.equal(extractFlatFeeCents('Artist guarantee of $750 against the door.'), 75000);
});

test('extractFlatFeeCents returns null when absent', () => {
  assert.equal(extractFlatFeeCents('No fixed payment specified.'), null);
});

test('extractSalesTax detects mention and explicit rate', () => {
  assert.deepEqual(extractSalesTax('Sales tax of 8.25% applies.'), { mentioned: true, bps: 825 });
  assert.deepEqual(extractSalesTax('Buyer pays applicable sales tax.'), { mentioned: true, bps: null });
  assert.deepEqual(extractSalesTax('No tax language here.'), { mentioned: false, bps: null });
});

test('extractContractFinancialTerms aggregates everything', () => {
  const text = 'Stardust Garage keeps 50% of net profit on ticket sales. A $500 flat fee is paid to the artist. Sales tax of 8.25% applies to bar sales.';
  const terms = extractContractFinancialTerms(text);
  assert.equal(terms.stardustSplitPercent, 50);
  assert.equal(terms.flatFeeCents, 50000);
  assert.equal(terms.salesTaxMentioned, true);
  assert.equal(terms.salesTaxBps, 825);
  assert.equal(terms.revenueShareRecipient, 'split');
  assert.deepEqual(terms.matched.sort(), ['flat_fee', 'sales_tax', 'split_percent']);
});

test('extractContractFinancialTerms with no terms returns defaults', () => {
  const terms = extractContractFinancialTerms('A generic non-financial clause.');
  assert.equal(terms.stardustSplitPercent, null);
  assert.equal(terms.flatFeeCents, null);
  assert.equal(terms.revenueShareRecipient, 'stardust');
  assert.deepEqual(terms.matched, []);
});

test('buildFinancialTermsPatch validates split percent range', () => {
  assert.equal(buildFinancialTermsPatch({ stardust_split_percent: 150 }).ok, false);
  assert.equal(buildFinancialTermsPatch({ stardust_split_percent: 50 }).patch.stardust_split_percent, 50);
  assert.equal(buildFinancialTermsPatch({ stardust_split_percent: '' }).patch.stardust_split_percent, null);
});

test('buildFinancialTermsPatch validates flat fee', () => {
  assert.equal(buildFinancialTermsPatch({ flat_fee_cents: -1 }).ok, false);
  assert.equal(buildFinancialTermsPatch({ flat_fee_cents: 1.5 }).ok, false);
  assert.equal(buildFinancialTermsPatch({ flat_fee_cents: 50000 }).patch.flat_fee_cents, 50000);
});

test('buildFinancialTermsPatch validates recipient + financial_terms shape', () => {
  assert.equal(buildFinancialTermsPatch({ revenue_share_recipient: 'bogus' }).ok, false);
  assert.equal(buildFinancialTermsPatch({ revenue_share_recipient: 'counterparty' }).patch.revenue_share_recipient, 'counterparty');
  assert.equal(buildFinancialTermsPatch({ financial_terms: [] }).ok, false);
  assert.deepEqual(buildFinancialTermsPatch({ financial_terms: { a: 1 } }).patch.financial_terms, { a: 1 });
});
