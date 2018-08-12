import { UNIX_EPOCH_JULIAN_DATE } from "./constants";

// Gregorian to Julian date
export function toJED(d) {
  return d / 86400000 + UNIX_EPOCH_JULIAN_DATE;
}
