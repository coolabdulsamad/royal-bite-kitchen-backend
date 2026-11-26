import { z } from "zod";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { settings } from "@db/schema";
import { SETTING_KEYS, SETTING_LABEL, toBusinessSettings, type SettingKey } from "@contracts/settings";
import { logEvent } from "../audit";

const updateInput = z.object({
  businessName: z.string().trim().min(2, "Business name is too short").max(120),
  businessAddress: z.string().trim().max(200).optional().default(""),
  businessPhone: z.string().trim().max(40).optional().default(""),
  receiptFooter: z.string().trim().max(120).optional().default(""),
  receiptShowAddress: z.boolean().optional().default(true),
});

/**
 * Restaurant-wide settings. Readable by any signed-in staff member (the
 * receipt layout needs it); writable by admin+ only.
 */
export const settingsRouter = createRouter({
  get: authedProcedure.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings);
    return toBusinessSettings(rows);
  }),

  update: permProcedure("settings", "manage")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const pairs: [SettingKey, string][] = [
        ["business_name", input.businessName],
        ["business_address", input.businessAddress],
        ["business_phone", input.businessPhone],
        ["receipt_footer", input.receiptFooter],
        ["receipt_show_address", input.receiptShowAddress ? "true" : "false"],
      ];
      for (const [key, value] of pairs) {
        await db
          .insert(settings)
          .values({ key, value, updatedById: ctx.staff.sub })
          .onDuplicateKeyUpdate({ set: { value, updatedById: ctx.staff.sub } });
      }
      const changed = pairs
        .map(([key]) => SETTING_LABEL[key])
        .join(", ");
      void logEvent(db, {
        actor: ctx.staff,
        action: "settings.update",
        entityType: "settings",
        detail: `Updated settings — ${changed}`,
      });
      const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings);
      return toBusinessSettings(rows);
    }),
});

export { SETTING_KEYS };
