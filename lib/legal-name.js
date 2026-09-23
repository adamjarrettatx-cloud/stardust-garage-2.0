// Shape validation is not identity verification. Staff must compare against ID;
// never blacklist a plausible name (including "John Doe").
export const LEGAL_NAME_NOTICE = 'Enter your legal first and last name as shown on your ID. If you do not provide your legal name, you may be denied entry.';
export const LEGAL_NAME_ERROR = 'Enter your legal first and last name as shown on your ID.';

export function validateLegalName(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) {
    return { valid: false, error: LEGAL_NAME_ERROR };
  }
  const fullName = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const parts = fullName.split(' ');
  const valid = fullName.length <= 120 && parts.length >= 2
    && parts.every(part => /\p{L}/u.test(part) && /^[\p{L}\p{M}.'’ʼ-]+$/u.test(part));
  return valid ? { valid: true, fullName } : { valid: false, error: LEGAL_NAME_ERROR };
}
