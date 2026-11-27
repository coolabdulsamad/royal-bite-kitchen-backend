import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, permProcedure } from "../auth/guards";
import { getDb } from "../queries/connection";
import { attendanceRecords, users } from "@db/schema";

/**
 * Attendance: staff clock THEMSELVES in/out (server timestamped — no
 * backdating), one open shift at a time. The clock-in/out transactions lock
 * the user's row so a double-tap or two terminals can't open two shifts.
 * Managers get a team report; staff see only their own history.
 */

function toRecord(r: {
  id: number;
  userId: number;
  clockInAt: Date;
  clockOutAt: Date | null;
  clockInNote: string | null;
  clockOutNote: string | null;
}) {
  return {
    id: r.id,
    userId: r.userId,
    clockInAt: r.clockInAt.toISOString(),
    clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
    clockInNote: r.clockInNote,
    clockOutNote: r.clockOutNote,
    workedMinutes:
      r.clockOutAt !== null
        ? Math.max(0, Math.round((+r.clockOutAt - +r.clockInAt) / 60000))
        : null,
  };
}

export const attendanceRouter = createRouter({
  /** My current clock-in state. */
  status: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const [open] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, ctx.staff.sub),
          isNull(attendanceRecords.clockOutAt),
        ),
      )
      .limit(1);
    return { open: open ? toRecord(open) : null };
  }),

  clockIn: authedProcedure
    .input(z.object({ note: z.string().trim().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return await db.transaction(async (tx) => {
        // Lock the user row — serializes concurrent clock-ins for this staff.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.staff.sub))
          .for("update");
        const [open] = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.userId, ctx.staff.sub),
              isNull(attendanceRecords.clockOutAt),
            ),
          )
          .limit(1);
        if (open) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You're already clocked in since ${open.clockInAt.toISOString()}`,
          });
        }
        const now = new Date();
        const [row] = await tx
          .insert(attendanceRecords)
          .values({
            userId: ctx.staff.sub,
            clockInAt: now,
            clockInNote: input.note || null,
          })
          .$returningId();
        return { ok: true as const, id: row.id, clockInAt: now.toISOString() };
      });
    }),

  clockOut: authedProcedure
    .input(z.object({ note: z.string().trim().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return await db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.staff.sub))
          .for("update");
        const [open] = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.userId, ctx.staff.sub),
              isNull(attendanceRecords.clockOutAt),
            ),
          )
          .limit(1);
        if (!open) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You're not clocked in — nothing to clock out of",
          });
        }
        const now = new Date();
        await tx
          .update(attendanceRecords)
          .set({ clockOutAt: now, clockOutNote: input.note || null })
          .where(eq(attendanceRecords.id, open.id));
        return {
          ok: true as const,
          id: open.id,
          clockInAt: open.clockInAt.toISOString(),
          clockOutAt: now.toISOString(),
        };
      });
    }),

  /** My own recent shifts. */
  mine: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.userId, ctx.staff.sub))
        .orderBy(desc(attendanceRecords.clockInAt), desc(attendanceRecords.id))
        .limit(input.limit);
      return rows.map(toRecord);
    }),

  /** Manager+ team report with per-staff totals. */
  report: permProcedure("attendanceTeam", "view")
    .input(
      z.object({
        /** Inclusive range bounds (ISO). */
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        staffId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input.from) conditions.push(gte(attendanceRecords.clockInAt, input.from));
      if (input.to) conditions.push(lte(attendanceRecords.clockInAt, input.to));
      if (input.staffId) conditions.push(eq(attendanceRecords.userId, input.staffId));

      const rows = await db
        .select({
          id: attendanceRecords.id,
          userId: attendanceRecords.userId,
          clockInAt: attendanceRecords.clockInAt,
          clockOutAt: attendanceRecords.clockOutAt,
          clockInNote: attendanceRecords.clockInNote,
          clockOutNote: attendanceRecords.clockOutNote,
          staffName: users.name,
          staffCode: users.staffCode,
        })
        .from(attendanceRecords)
        .innerJoin(users, eq(users.id, attendanceRecords.userId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(attendanceRecords.clockInAt), desc(attendanceRecords.id))
        .limit(300);

      const records = rows.map((r) => ({
        ...toRecord(r),
        staffName: r.staffName,
        staffCode: r.staffCode,
      }));

      const totalsMap = new Map<
        number,
        { staffName: string; staffCode: string; shifts: number; totalMinutes: number; open: number }
      >();
      for (const r of records) {
        const t =
          totalsMap.get(r.userId) ?? {
            staffName: r.staffName,
            staffCode: r.staffCode,
            shifts: 0,
            totalMinutes: 0,
            open: 0,
          };
        t.shifts += 1;
        if (r.workedMinutes !== null) t.totalMinutes += r.workedMinutes;
        else t.open += 1;
        totalsMap.set(r.userId, t);
      }

      return {
        records,
        totals: [...totalsMap.entries()].map(([userId, t]) => ({ userId, ...t })),
      };
    }),
});
