import { describe, expect, it } from "vitest";
import {
  normalizePartnerPayload,
  PartnerPayloadError,
} from "./partners";

describe("normalizePartnerPayload — Glovo-style", () => {
  const glovoBody = {
    order_id: "GLV-9001",
    customer: { name: "Ada Obi", phone: "08031234567" },
    delivery_address: "12 Admiralty Way, Lekki",
    note: "No pepper please",
    items: [
      { id: "p1", name: "Peppered Chicken", quantity: 2, price: 4000 },
      { name: "Jollof Rice", quantity: 1, price: "2,500.00" },
    ],
  };

  it("normalizes a full Glovo payload", () => {
    const o = normalizePartnerPayload("glovo", glovoBody);
    expect(o.externalId).toBe("GLV-9001");
    expect(o.customerName).toBe("Ada Obi");
    expect(o.customerPhone).toBe("08031234567");
    expect(o.deliveryAddress).toBe("12 Admiralty Way, Lekki");
    expect(o.notes).toBe("No pepper please");
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toEqual({
      externalId: "p1",
      name: "Peppered Chicken",
      quantity: 2,
      unitPriceKobo: 400000,
    });
    // string price with comma separator → kobo
    expect(o.items[1].unitPriceKobo).toBe(250000);
    expect(o.items[1].externalId).toBeNull();
  });

  it("unwraps {order: {...}} envelopes", () => {
    const o = normalizePartnerPayload("glovo", { order: glovoBody });
    expect(o.externalId).toBe("GLV-9001");
    expect(o.items).toHaveLength(2);
  });
});

describe("normalizePartnerPayload — Chowdeck-style", () => {
  it("normalizes reference/customer_*/qty aliases", () => {
    const o = normalizePartnerPayload("chowdeck", {
      reference: "CD-4471",
      customer_name: "Tunde Bakare",
      customer_phone: "+2349011112222",
      address: "5 Adeola Odeku, VI",
      items: [
        { title: "Ofada Rice", qty: "3", unit_price: "1800" },
      ],
    });
    expect(o.externalId).toBe("CD-4471");
    expect(o.customerName).toBe("Tunde Bakare");
    expect(o.customerPhone).toBe("+2349011112222");
    expect(o.deliveryAddress).toBe("5 Adeola Odeku, VI");
    expect(o.items[0].name).toBe("Ofada Rice");
    expect(o.items[0].quantity).toBe(3);
    expect(o.items[0].unitPriceKobo).toBe(180000);
  });

  it("handles address objects and missing optional fields", () => {
    const o = normalizePartnerPayload("chowdeck", {
      id: 7788,
      items: [{ name: "Chips", price: 1200.5 }],
      address: { street: "1 Bourdillon Rd", area: "Ikoyi", city: "Lagos" },
    });
    expect(o.externalId).toBe("7788");
    expect(o.customerName).toBeNull();
    expect(o.deliveryAddress).toBe("1 Bourdillon Rd, Ikoyi, Lagos");
    expect(o.notes).toBeNull();
    expect(o.items[0].unitPriceKobo).toBe(120050);
  });

  it("defaults quantity to 1", () => {
    const o = normalizePartnerPayload("glovo", {
      orderId: "X1",
      items: [{ name: "Malt", price: 500 }],
    });
    expect(o.items[0].quantity).toBe(1);
  });
});

describe("normalizePartnerPayload — validation", () => {
  it("rejects non-object payloads", () => {
    expect(() => normalizePartnerPayload("glovo", "nope")).toThrow(PartnerPayloadError);
  });

  it("rejects a missing order id", () => {
    expect(() =>
      normalizePartnerPayload("glovo", { items: [{ name: "Rice", price: 100 }] }),
    ).toThrow(/no order id/);
  });

  it("rejects an empty items array", () => {
    expect(() =>
      normalizePartnerPayload("chowdeck", { orderId: "A", items: [] }),
    ).toThrow(/no items/);
  });

  it("rejects an item without a name", () => {
    expect(() =>
      normalizePartnerPayload("glovo", { orderId: "A", items: [{ price: 100 }] }),
    ).toThrow(/no name/);
  });

  it("rejects an item without a valid price", () => {
    expect(() =>
      normalizePartnerPayload("glovo", {
        orderId: "A",
        items: [{ name: "Rice", price: "free" }],
      }),
    ).toThrow(/no valid price/);
  });

  it("rejects an invalid quantity", () => {
    expect(() =>
      normalizePartnerPayload("glovo", {
        orderId: "A",
        items: [{ name: "Rice", quantity: 0, price: 100 }],
      }),
    ).toThrow(/invalid quantity/);
  });
});
