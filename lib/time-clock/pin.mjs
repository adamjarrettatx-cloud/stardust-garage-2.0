// Shared public input policy only. No secrets or stored PIN values.
export const PIN_LENGTH = 4;
export const PIN_PATTERN = `[0-9]{${PIN_LENGTH}}`;
export function isValidPin(value) {
  return (
    typeof value === "string" &&
    value.length === PIN_LENGTH &&
    /^[0-9]+$/.test(value)
  );
}
