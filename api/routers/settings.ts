import { z } from "zod";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure, superadminProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { settings } from "@db/schema";
import {
  SETTING_KEYS,
  SETTING_LABEL,
  toBusinessSettings,
  toExpenseApprovalPolicy,
  type SettingKey,
} from "@contracts/settings";
import { formatNaira } from "@contracts/money";
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
    return { ...toBusinessSettings(rows), expenseApproval: toExpenseApprovalPolicy(rows) };
  }),

  /**
   * Expense-approval workflow rules — SUPERADMIN ONLY. `required` toggles the
   * whole workflow; `thresholdNaira` sets an amount below which expenses
   * auto-approve (0 = every expense needs sign-off). Who may approve is
   * controlled separately on the Permissions page (expenseApprovals domain).
   */
  updateExpenseApproval: superadminProcedure
    .input(
      z.object({
        required: z.boolean(),
        thresholdNaira: z.number().min(0).max(10_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const thresholdKobo = Math.round(input.thresholdNaira * 100);
      const pairs: [SettingKey, string][] = [
        ["expense_approval_required", input.required ? "true" : "false"],
        ["expense_approval_threshold_kobo", String(thresholdKobo)],
      ];
      for (const [key, value] of pairs) {
        await db
          .insert(settings)
          .values({ key, value, updatedById: ctx.staff.sub })
          .onDuplicateKeyUpdate({ set: { value, updatedById: ctx.staff.sub } });
      }
      void logEvent(db, {
        actor: ctx.staff,
        action: "settings.update",
        entityType: "settings",
        detail: `Expense approval rules — ${input.required ? "required" : "OFF"}, auto-approve below ${formatNaira(thresholdKobo)}`,
      });
      const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings);
      return toExpenseApprovalPolicy(rows);
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
