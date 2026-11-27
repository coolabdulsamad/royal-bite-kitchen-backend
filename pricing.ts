/**
 * Shared basket pricing — the single place where client-sent cart lines are
 * re-validated and re-priced against the live menu. Used by sales.completeSale
 * and orders.create so an order ticket and its later payment can never drift
 * apart (the server is always the source of truth for money).
 */
import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";
import {
  itemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
} from "@db/schema";
import type { getDb } from "./queries/connection";

export interface ModifierSnapshot {
  group: string;
  option: string;
  /** Lets the POS rebuild a payable cart from an order ticket. */
  optionId: number;
  priceDeltaKobo: number;
}

export interface OrderLineInput {
  itemId: number;
  quantity: number;
  optionIds: number[];
}

export interface PricedLine {
  itemId: number;
  itemName: string;
  /** Base item price before modifiers (kobo) */
  unitPriceKobo: number;
  quantity: number;
  modifiers: ModifierSnapshot[];
  lineTotalKobo: number;
}

type Db = ReturnType<typeof getDb>;

/**
 * Validate and price basket lines against the current menu.
 * Throws TRPCError(BAD_REQUEST) on unknown/unavailable items, foreign or
 * inactive options, single-select violations and missing required groups.
 */
export async function priceOrderLines(
  db: Db,
  lines: OrderLineInput[],
): Promise<{ pricedLines: PricedLine[]; subtotalKobo: number }> {
  const itemIds = lines.map((i) => i.itemId);
  const dbItems = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, itemIds));
  const links = await db
    .select()
    .from(itemModifierGroups)
    .where(inArray(itemModifierGroups.itemId, itemIds));
  const allOptionIds = lines.flatMap((i) => i.optionIds);
  const dbOptions =
    allOptionIds.length > 0
      ? await db
          .select()
          .from(modifierOptions)
          .where(inArray(modifierOptions.id, allOptionIds))
      : [];
  const groupIds = Array.from(new Set(links.map((l) => l.groupId)));
  const dbGroups =
    groupIds.length > 0
      ? await db
          .select()
          .from(modifierGroups)
          .where(inArray(modifierGroups.id, groupIds))
      : [];

  let subtotalKobo = 0;
  const pricedLines: PricedLine[] = [];

  for (const cartLine of lines) {
    const item = dbItems.find((i) => i.id === cartLine.itemId);
    if (!item) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One of the items no longer exists — refresh the menu",
      });
    }
    if (!item.available) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `“${item.name}” is currently unavailable`,
      });
    }

    const itemGroupIds = links
      .filter((l) => l.itemId === item.id)
      .map((l) => l.groupId);
    const chosenOptions = dbOptions.filter((o) =>
      cartLine.optionIds.includes(o.id),
    );

    // Every chosen option must belong to a group attached to this item.
    for (const opt of chosenOptions) {
      if (!itemGroupIds.includes(opt.groupId) || !opt.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid modifier on “${item.name}”`,
        });
      }
    }
    // Single-select groups: at most one option.
    const byGroup = new Map<number, number>();
    for (const opt of chosenOptions) {
      byGroup.set(opt.groupId, (byGroup.get(opt.groupId) ?? 0) + 1);
    }
    for (const [gid, count] of byGroup) {
      const group = dbGroups.find((g) => g.id === gid);
      if (group?.selectionType === "single" && count > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `“${group.name}” allows only one choice on “${item.name}”`,
        });
      }
    }
    // Required groups must be satisfied.
    for (const gid of itemGroupIds) {
      const group = dbGroups.find((g) => g.id === gid);
      if (group?.required && !byGroup.has(gid)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `“${item.name}” needs a choice for “${group.name}”`,
        });
      }
    }

    const modifiers: ModifierSnapshot[] = chosenOptions.map((o) => ({
      group: dbGroups.find((g) => g.id === o.groupId)?.name ?? "",
      option: o.name,
      optionId: o.id,
      priceDeltaKobo: o.priceDeltaKobo,
    }));
    const unitKobo =
      item.priceKobo + chosenOptions.reduce((s, o) => s + o.priceDeltaKobo, 0);
    const lineTotalKobo = unitKobo * cartLine.quantity;
    subtotalKobo += lineTotalKobo;

    pricedLines.push({
      itemId: item.id,
      itemName: item.name,
      unitPriceKobo: item.priceKobo,
      quantity: cartLine.quantity,
      modifiers,
      lineTotalKobo,
    });
  }

  return { pricedLines, subtotalKobo };
}
