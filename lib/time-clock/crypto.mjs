import {
  createHmac,
  randomBytes,
  randomInt,
  scrypt as rawScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { PIN_LENGTH } from "./pin.mjs";
const scrypt = promisify(rawScrypt);
export const token = () => randomBytes(32).toString("base64url");
export const pairingCode = () => String(randomInt(10000000, 100000000));
export const newPin = () =>
  String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
export function keyedHash(purpose, value, secret) {
  if (!secret || secret.length < 43)
    throw new Error("time_clock_not_configured");
  return createHmac("sha256", secret)
    .update(`${purpose}\0${value}`)
    .digest("hex");
}
export async function hashPin(pin, secret) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(keyedHash("pin-verifier", pin, secret), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt-v1:${salt}:${hash.toString("hex")}`;
}
export async function verifyPin(pin, verifier, secret) {
  const match = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(
    verifier || "",
  );
  // Use the same KDF even for an unknown lookup to avoid timing enumeration.
  const salt = match?.[1] ?? "0".repeat(32);
  const expected = Buffer.from(match?.[2] ?? "0".repeat(64), "hex");
  const actual = await scrypt(
    keyedHash("pin-verifier", pin, secret),
    salt,
    32,
    { N: 16384, r: 8, p: 1 },
  );
  return timingSafeEqual(actual, expected) && Boolean(match);
}
