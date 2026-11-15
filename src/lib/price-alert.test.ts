import { describe, expect, it } from "vitest";
import { decideAlert, MIN_DROP_PERCENT } from "./price-alert";

describe("decideAlert", () => {
  it("alerts on a drop of at least MIN_DROP_PERCENT", () => {
    expect(MIN_DROP_PERCENT).toBe(5);
    expect(decideAlert({ price: 34.99, basePrice: 37.99, alertActive: false, previousLowest: 35.5 }))
      .toEqual({ alert: true, alertActive: true });
  });

  it("stays quiet on a drop of a few cents that is not a new lowest price", () => {
    expect(decideAlert({ price: 59.79, basePrice: 59.99, alertActive: false, previousLowest: 58.5 }))
      .toEqual({ alert: false, alertActive: false });
    expect(decideAlert({ price: 29.44, basePrice: 29.57, alertActive: false, previousLowest: 26.99 }))
      .toEqual({ alert: false, alertActive: false });
  });

  it("alerts on a small drop that reaches the lowest price recorded", () => {
    expect(decideAlert({ price: 58.5, basePrice: 59.99, alertActive: false, previousLowest: 58.5 }))
      .toEqual({ alert: true, alertActive: true });
    expect(decideAlert({ price: 59.79, basePrice: 59.99, alertActive: false, previousLowest: null }))
      .toEqual({ alert: true, alertActive: true });
  });

  it("does not mute a real drop that follows an ignored small one", () => {
    const small = decideAlert({ price: 59.79, basePrice: 59.99, alertActive: false, previousLowest: 58.5 });
    expect(decideAlert({ price: 54.99, basePrice: 59.99, alertActive: small.alertActive, previousLowest: 58.5 }).alert)
      .toBe(true);
  });

  it("announces a drop once and rearms when the price climbs back", () => {
    expect(decideAlert({ price: 30, basePrice: 40, alertActive: true, previousLowest: 30 }))
      .toEqual({ alert: false, alertActive: true });
    expect(decideAlert({ price: 40, basePrice: 40, alertActive: true, previousLowest: 30 }))
      .toEqual({ alert: false, alertActive: false });
  });
});
