import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLegalName } from '../lib/legal-name.js';
import { validateTrialPassIntake } from '../lib/trial-pass.js';

test('requires first and last name, rejects malformed or invisible input', () => {
  for (const value of [null, {}, '', ' ', 'John', 'John ', '123 456', 'John 123',
    'John !!!', 'John\u200b Doe', 'John\nDoe', 'john@example.com', 'X '.repeat(70)]) {
    assert.equal(validateLegalName(value).valid, false, JSON.stringify(value));
    assert.equal(validateTrialPassIntake({ fullName: value, phone: '5125550134', email: 'a@b.co' }).field, 'fullName');
  }
});
test('accepts international and compound names without guessing whether they are fake', () => {
  for (const name of ['John Doe', 'José García', 'Anne-Marie O’Neill', '李 明', 'محمد علي', 'A Li', 'María del Carmen López', 'J. Smith']) {
    assert.equal(validateLegalName(name).valid, true, name);
  }
  assert.equal(validateLegalName('  Jose\u0301   Garci\u0301a  ').fullName, 'José García');
});
