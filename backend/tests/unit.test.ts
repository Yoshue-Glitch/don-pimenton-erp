import { describe, it, expect } from "vitest";
import { computeYield } from "../src/modules/production";
import { computeTotals } from "../src/modules/sales";
import { canonical, hashObject } from "../src/lib/hash";

describe("Cálculos de producción", () => {
  it("rendimiento y merma del ejemplo (1,000 kg → 200 kg)", () => {
    const r = computeYield(1000, 200);
    expect(r.yieldPct.toNumber()).toBe(20);
    expect(r.wasteKg.toNumber()).toBe(800);
  });
  it("rechaza pesos finales mayores al inicial o negativos", () => {
    expect(() => computeYield(1000, 1200)).toThrow();
    expect(() => computeYield(1000, -1)).toThrow();
    expect(() => computeYield(0, 0)).toThrow();
  });
});

describe("Cálculo de importes de venta", () => {
  const line = { productId: 1, unit: "SACO" as const, quantity: 8, unitPrice: 375, discountPct: 0, bagWeightKg: 25 };
  it("8 sacos × S/ 375 con IGV incluido = S/ 3,000", () => {
    const t = computeTotals([line], 0.18, true);
    expect(t.total.toNumber()).toBe(3000);
    expect(t.subtotal.toNumber()).toBe(2542.37);
    expect(t.taxTotal.toNumber()).toBe(457.63);
    expect(t.totalKg.toNumber()).toBe(200);
  });
  it("precio sin impuesto y descuento", () => {
    const t = computeTotals([{ ...line, unit: "KG", quantity: 200, unitPrice: 15, discountPct: 10 }], 0.18, false);
    expect(t.subtotal.toNumber()).toBe(2700);
    expect(t.discountTotal.toNumber()).toBe(300);
    expect(t.taxTotal.toNumber()).toBe(486);
    expect(t.total.toNumber()).toBe(3186);
  });
  it("la venta por saco exige sacos enteros", () => {
    expect(() => computeTotals([{ ...line, quantity: 2.5 }], 0.18, true)).toThrow();
  });
});

describe("Hash canónico", () => {
  it("es independiente del orden de las claves", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashObject({ x: 1, y: 2 })).toBe(hashObject({ y: 2, x: 1 }));
    expect(hashObject({ x: 1 })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
