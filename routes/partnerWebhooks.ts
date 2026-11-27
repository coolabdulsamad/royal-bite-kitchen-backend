import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { menuItems, orderItems, orders, partnerConnections } from "@db/schema";
import {
  ORDER_SOURCE_LABEL,
  PARTNER_PROVIDERS,
  PartnerPayloadError,
  normalizePartnerPayload,
  type PartnerProvider,
} from "@contracts/partners";
import { log } from "../lib/logger";

/**
 * Delivery-partner webhook ingestion — plain REST (not tRPC) because Glovo /
 * Chowdeck servers call it directly. Auth is a per-connection secret token in
 * the x-rbk-webhook-token header; each connection is scoped to one provider,
 * so a Glovo token can never inject Chowdeck orders (and vice versa).
 *
 * Idempotency: (source, external_id) is UNIQUE in the orders table, so a
 * partner retrying a delivered webhook gets the already-created order back
 * with duplicate:true instead of a second kitchen ticket.
 */
export const partnerWebhooks = new Hono<{ Bindings: HttpBindings }>();

partnerWebhooks.post("/:provider", async (c) => {
  const provider = c.req.param("provider") as PartnerProvider;
  if (!(PARTNER_PROVIDERS as readonly string[]).includes(provider)) {
    return c.json({ error: "Unknown provider" }, 404);
  }
  const db = getDb();

  // ---------------------------------------------------------------- auth
  const token = c.req.header("x-rbk-webhook-token") ?? "";
  const [conn] = token
    ? await db
        .select()
        .from(partnerConnections)
        .where(
          and(
            eq(partnerConnections.provider, provider),
            eq(partnerConnections.token, token),
          ),
        )
        .limit(1)
    : [];
  if (!conn) {
    return c.json({ error: "Invalid webhook token" }, 401);
  }
  if (!conn.active) {
    return c.json({ error: "This connection is disabled" }, 403);
  }

  // ------------------------------------------------------------ normalize
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON" }, 400);
  }
  let normalized;
  try {
    normalized = normalizePartnerPayload(provider, body);
  } catch (err) {
    if (err instanceof PartnerPayloadError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }

  // ------------------------------------------- match lines to the menu
  // Case-insensitive exact name match. Unmapped partner items still land on
  // the ticket with their raw name and partner price (itemId stays null) —
  // the kitchen can cook them and the stored prices are what gets charged.
  const menuRows = await db
    .select({ id: menuItems.id, name: menuItems.name })
    .from(menuItems);
  const menuByName = new Map(
    menuRows.map((m) => [m.name.trim().toLowerCase(), m.id]),
  );
  const lines = normalized.items.map((item) => ({
    itemId: menuByName.get(item.name.trim().toLowerCase()) ?? null,
    itemName: item.name,
    unitPriceKobo: item.unitPriceKobo,
    quantity: item.quantity,
    lineTotalKobo: item.unitPriceKobo * item.quantity,
  }));
  const totalKobo = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
  const label = (
    normalized.customerName ?? `${ORDER_SOURCE_LABEL[provider]} ${normalized.externalId}`
  ).slice(0, 64);

  // ------------------------------------------------------------- ingest
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(orders)
        .values({
          orderNo: "PENDING",
          label,
          notes: normalized.notes,
          staffId: null,
          totalKobo,
          source: provider,
          externalId: normalized.externalId,
          partnerConnectionId: conn.id,
          customerName: normalized.customerName,
          customerPhone: normalized.customerPhone,
          deliveryAddress: normalized.deliveryAddress,
        })
        .$returningId();
      const orderNo = `ORD-${String(row.id).padStart(6, "0")}`;
      await tx.update(orders).set({ orderNo }).where(eq(orders.id, row.id));
      for (const line of lines) {
        await tx.insert(orderItems).values({
          orderId: row.id,
          itemId: line.itemId,
          itemName: line.itemName,
          unitPriceKobo: line.unitPriceKobo,
          modifiersJson: null,
          quantity: line.quantity,
          lineTotalKobo: line.lineTotalKobo,
        });
      }
      await tx
        .update(partnerConnections)
        .set({ lastOrderAt: new Date() })
        .where(eq(partnerConnections.id, conn.id));
      return { orderId: row.id, orderNo };
    });
    log.info("partner order ingested", {
      provider,
      connectionId: conn.id,
      externalId: normalized.externalId,
      orderId: created.orderId,
      totalKobo,
    });
    return c.json({
      ok: true as const,
      duplicate: false,
      orderId: created.orderId,
      orderNo: created.orderNo,
    });
  } catch (err) {
    // Unique (source, external_id) violation → the partner retried a webhook
    // we already ingested. Answer with the existing order, don't double-fire
    // the kitchen. Drizzle wraps the driver error, so walk the cause chain.
    const isDup = (() => {
      let e: unknown = err;
      while (e) {
        if (typeof e === "object" && e !== null) {
          const rec = e as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
          if (rec.code === "ER_DUP_ENTRY" || rec.errno === 1062) return true;
          if (typeof rec.message === "string" && rec.message.includes("Duplicate entry")) return true;
          e = rec.cause;
          continue;
        }
        break;
      }
      return false;
    })();
    if (isDup) {
      const [existing] = await db
        .select({ id: orders.id, orderNo: orders.orderNo })
        .from(orders)
        .where(
          and(eq(orders.source, provider), eq(orders.externalId, normalized.externalId)),
        )
        .limit(1);
      if (existing) {
        log.info("partner webhook duplicate", {
          provider,
          connectionId: conn.id,
          externalId: normalized.externalId,
          orderId: existing.id,
        });
        return c.json({
          ok: true as const,
          duplicate: true,
          orderId: existing.id,
          orderNo: existing.orderNo,
        });
      }
    }
    throw err;
  }
});
