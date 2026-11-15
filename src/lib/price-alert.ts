/**
 * The price-drop decision, kept apart from the database so it can be read and tested on its own.
 *
 *   price >= basePrice                          -> no alert, alertActive = false
 *   alertActive                                 -> no alert (already announced this drop)
 *   drop >= MIN_DROP_PERCENT or new lowest      -> alert, alertActive = true
 *   anything else below the reference           -> no alert, alertActive stays false
 *
 * A product that stays cheap for a week still buzzes once. A drop of a few cents does not buzz at
 * all, and because it leaves `alertActive` false, a real drop that follows it still does.
 */

/** A drop smaller than this, in percent of the reference, is noise unless it is a new lowest price. */
export const MIN_DROP_PERCENT = 5;

export type AlertInput = {
  price: number;
  basePrice: number;
  alertActive: boolean;
  /** The lowest price recorded before this reading, or null when there is none yet. */
  previousLowest: number | null;
};

export type AlertDecision = { alert: boolean; alertActive: boolean };

export function dropPercent(basePrice: number, price: number): number {
  return ((basePrice - price) / basePrice) * 100;
}

export function decideAlert({ price, basePrice, alertActive, previousLowest }: AlertInput): AlertDecision {
  if (price >= basePrice) return { alert: false, alertActive: false };
  if (alertActive) return { alert: false, alertActive: true };
  const significant = dropPercent(basePrice, price) >= MIN_DROP_PERCENT;
  const atLowest = previousLowest === null || price <= previousLowest;
  return significant || atLowest ? { alert: true, alertActive: true } : { alert: false, alertActive: false };
}
