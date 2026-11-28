/**
 * Delivery-partner (Glovo / Chowdeck) webhook contracts.
 *
 * Both providers get a tolerant normalizer: their exact field names differ
 * (and shift between API versions), so we accept the common aliases for
 * order id, customer, address, items, quantities and prices. Prices arriving
 * in a webhook are NAIRA (₦, possibly as a decimal string) and are converted
 * to integer kobo here, once.
 */

export const PARTNER_PROVIDERS = ["glovo", "chowdeck"] as const;
export type PartnerProvider = (typeof PARTNER_PROVIDERS)[number];

export const PARTNER_LABEL: Record<PartnerProvider, string> = {
  glovo: "Glovo",
  chowdeck: "Chowdeck",
};

/** Order source labels — "pos" is a counter/till order. */
export const ORDER_SOURCE_LABEL: Record<"pos" | PartnerProvider, string> = {
  pos: "Counter",
  glovo: "Glovo",
  chowdeck: "Chowdeck",
};

export interface PartnerOrderLine {
  /** Partner's own item id, when present — used for diagnostics only. */
  externalId: string | null;
  name: string;
  quantity: number;
  unitPriceKobo: number;
}

export interface NormalizedPartnerOrder {
  externalId: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  items: PartnerOrderLine[];
}

/** Thrown on any payload problem — the webhook maps it to a 400. */
export class PartnerPayloadError extends Error {}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** First defined, non-null, non-empty-string value among the given keys. */
function pick(obj: Obj, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asQuantity(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const q = Math.round(n);
  return q >= 1 && q <= 99 ? q : null;
}

/** Naira (number or "1,250.50") → kobo. Returns null when unparseable. */
function asKobo(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") n = Number(v.replace(/[,₦\s]/g, ""));
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return Math.round(n * 100);
}

/** Customer may be a nested object or flat customer_* fields. */
function customerField(body: Obj, ...keys: string[]): string | null {
  const customer = pick(body, "customer", "customer_info", "user", "client");
  if (isObj(customer)) {
    const v = pick(customer, ...keys);
    const s = asString(v);
    if (s) return s;
    // Glovo-style {name: {first, last}}? Keep it simple: first+last fields.
    if (keys.includes("name")) {
      const first = asString(pick(customer, "first_name", "firstName"));
      const last = asString(pick(customer, "last_name", "lastName"));
      if (first || last) return [first, last].filter(Boolean).join(" ");
    }
  }
  for (const k of keys) {
    const s = asString(pick(body, k, `customer_${k}`, `customer${k[0].toUpperCase()}${k.slice(1)}`));
    if (s) return s;
  }
  return null;
}

function normalizeItems(rawItems: unknown): PartnerOrderLine[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new PartnerPayloadError("Payload has no items array");
  }
  if (rawItems.length > 100) {
    throw new PartnerPayloadError("Too many items in one order (max 100)");
  }
  return rawItems.map((raw, i) => {
    if (!isObj(raw)) {
      throw new PartnerPayloadError(`Item ${i + 1} is not an object`);
    }
    const name = asString(pick(raw, "name", "title", "product_name", "item_name", "itemName"));
    if (!name) throw new PartnerPayloadError(`Item ${i + 1} has no name`);
    const quantity = asQuantity(pick(raw, "quantity", "qty", "count", "units") ?? 1);
    if (quantity === null) {
      throw new PartnerPayloadError(`Item "${name}" has an invalid quantity`);
    }
    const unitPriceKobo = asKobo(
      pick(raw, "price", "unit_price", "unitPrice", "amount", "unit_amount", "cost"),
    );
    if (unitPriceKobo === null) {
      throw new PartnerPayloadError(`Item "${name}" has no valid price (naira)`);
    }
    return {
      externalId: asString(pick(raw, "id", "product_id", "productId", "sku", "item_id")),
      name: name.slice(0, 120),
      quantity,
      unitPriceKobo,
    };
  });
}

/**
 * Normalize a Glovo or Chowdeck webhook body into our canonical shape.
 * Throws PartnerPayloadError with a staff-readable message on bad input.
 */
export function normalizePartnerPayload(
  provider: PartnerProvider,
  body: unknown,
): NormalizedPartnerOrder {
  if (!isObj(body)) throw new PartnerPayloadError("Payload must be a JSON object");

  // Some integrations wrap the order: {order: {...}} / {data: {...}}.
  const inner = pick(body, "order", "data", "payload");
  const root = isObj(inner) && (pick(inner, "items", "products", "lines") !== undefined
      || pick(inner, "order_id", "orderId", "id", "reference") !== undefined)
    ? inner
    : body;

  const externalId = asString(
    pick(root, "order_id", "orderId", "order_number", "reference", "id", "code"),
  );
  if (!externalId) {
    throw new PartnerPayloadError(
      `Payload has no order id (looked for order_id/orderId/reference — ${PARTNER_LABEL[provider]})`,
    );
  }

  const items = normalizeItems(pick(root, "items", "products", "lines", "order_lines", "orderItems"));

  const rawAddress = pick(root, "delivery_address", "deliveryAddress", "address", "dropoff_address");
  const deliveryAddress = isObj(rawAddress)
    ? [rawAddress.street, rawAddress.area, rawAddress.city]
        .map(asString)
        .filter(Boolean)
        .join(", ") || null
    : asString(rawAddress);

  return {
    externalId: externalId.slice(0, 64),
    customerName: customerField(root, "name", "full_name", "fullName"),
    customerPhone: customerField(root, "phone", "phone_number", "phoneNumber", "mobile", "msisdn"),
    deliveryAddress: deliveryAddress ? deliveryAddress.slice(0, 255) : null,
    notes: asString(pick(root, "note", "notes", "comment", "instructions", "special_instructions"))?.slice(0, 500) ?? null,
    items,
  };
}
