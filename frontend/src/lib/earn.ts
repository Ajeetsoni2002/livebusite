/** Rupees a contributor earns for each approved paper or note. Mirrors backend RATE_PER_UPLOAD. */
export const RATE = 10;
export const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

const KEY = "buit-earn-dismissed";
/** The floating promo stays hidden for three days after it is closed. */
export function promoDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) || 0) < 3 * 86400_000;
  } catch {
    return false;
  }
}
export function dismissPromo() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable: it simply shows again next visit */
  }
}
