import { useSyncExternalStore } from "react";
import { api } from "./api";
import { db, logSync, nextLocalReceiptNo, type OutboxRow } from "./db";
import { isOnline } from "./connectivity";
import type { CompletedSaleResult } from "@/pages/pos/PaymentModal";

/** Payment row with amounts in kobo (receipt/display shape). */
export interface CompletedPayment {
  method: "cash" | "bank_pos" | "transfer";
  amountKobo: number;
  reference: string | null;
}

export interface OutboxEntry {
  clientRef: string;
  localReceiptNo: string;
  payload: OfflineSalePayload;
  totalKobo: number;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  lastError: string | null;
  syncedReceiptNo: string | null;
}

/** The sales.completeSale input as sent from the POS (amounts in naira at the wire). */
export interface OfflineSalePayload {
  items: Array<{ itemId: number; quantity: number; optionIds: number[] }>;
  discount: { type: "percent" | "fixed"; value: number } | null;
  payments: Array<{
    method: "cash" | "bank_pos" | "transfer";
    amount: number;
    reference?: string;
    terminalId?: number;
  }>;
  saleDate?: string;
  clientRef: string;
  /** Set when paying a kitchen order — the sync links it to the sale
   *  (the ticket stays on the board until served). */
  orderId?: number;
  /** Customer attached to the sale (credit sales are online-only, but a
   *  fully-paid sale can still carry one through the queue). */
  customerId?: number;
}

interface OutboxState {
  entries: OutboxEntry[];
  lastSyncAt: string | null;
  syncing: boolean;
}

const MAX_ATTEMPTS = 8;

class OutboxStore {
  private snapshot: OutboxState = { entries: [], lastSyncAt: null, syncing: false };
  private listeners = new Set<() => void>();
  private syncInFlight: Promise<void> | null = null;
  private loaded = false;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getState = (): OutboxState => this.snapshot;

  private emit(next: Partial<OutboxState>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const fn of this.listeners) fn();
  }

  private async reload() {
    const rows = await db.outbox.orderBy("createdAt").toArray();
    this.emit({
      entries: rows.map((r) => ({
        clientRef: r.clientRef,
        localReceiptNo: r.localReceiptNo,
        payload: JSON.parse(r.payload) as OfflineSalePayload,
        totalKobo: r.totalKobo,
        createdAt: r.createdAt,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        syncedReceiptNo: r.syncedReceiptNo,
      })),
    });
  }

  async init() {
    if (this.loaded) return;
    this.loaded = true;
    // Anything stuck in "syncing" from a crashed session goes back to pending.
    await db.outbox.where("status").equals("syncing").modify({ status: "pending" });
    await this.reload();
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.syncNow());
      // Background retry every 45s while online.
      setInterval(() => {
        if (isOnline()) void this.syncNow();
      }, 45_000);
    }
  }

  /** Queue a sale made offline. Returns the local receipt number. */
  async enqueue(payload: OfflineSalePayload, totalKobo: number): Promise<string> {
    const localReceiptNo = await nextLocalReceiptNo();
    const row: OutboxRow = {
      clientRef: payload.clientRef,
      localReceiptNo,
      payload: JSON.stringify(payload),
      totalKobo,
      createdAt: new Date().toISOString(),
      status: "pending",
      attempts: 0,
      lastError: null,
      syncedReceiptNo: null,
    };
    await db.outbox.put(row);
    await logSync("info", `Queued ${localReceiptNo} (${payload.items.length} lines)`);
    await this.reload();
    return localReceiptNo;
  }

  /** Upload queued sales FIFO. Idempotent server-side via clientRef. */
  async syncNow(): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight;
    if (!isOnline()) return;
    this.syncInFlight = (async () => {
      const pending = await db.outbox
        .where("status")
        .anyOf(["pending", "failed"])
        .and((r) => r.status !== "failed" || r.attempts < MAX_ATTEMPTS)
        .sortBy("createdAt");
      if (pending.length === 0) return;
      this.emit({ syncing: true });
      for (const row of pending) {
        await db.outbox.update(row.clientRef, { status: "syncing", attempts: row.attempts + 1 });
        await this.reload();
        try {
          const payload = JSON.parse(row.payload) as OfflineSalePayload;
          const result = await api.sales.completeSale.mutate(payload);
          await logSync("info", `Synced ${row.localReceiptNo} → ${result.receiptNo}`);
          await db.outbox.delete(row.clientRef);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Sync failed";
          // Business-rule rejections (validation, permission) are permanent:
          // mark failed so the cashier sees it instead of retrying forever.
          await db.outbox.update(row.clientRef, { status: "failed", lastError: message });
          await logSync("error", `${row.localReceiptNo}: ${message}`);
        }
        await this.reload();
      }
      this.emit({ syncing: false, lastSyncAt: new Date().toISOString() });
    })();
    try {
      await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  /** Manual retry of a failed entry. */
  async retry(clientRef: string): Promise<void> {
    await db.outbox.update(clientRef, { status: "pending", attempts: 0, lastError: null });
    await this.reload();
    await this.syncNow();
  }
}

export const outboxStore = new OutboxStore();

export function useOutbox(): OutboxState {
  return useSyncExternalStore(outboxStore.subscribe, outboxStore.getState);
}

/**
 * Build a local CompletedSaleResult for an offline sale so the receipt view,
 * printer and customer display work exactly like an online sale.
 */
export function buildOfflineSaleResult(args: {
  localReceiptNo: string;
  cashierName: string;
  lines: CompletedSaleResult["lines"];
  subtotalKobo: number;
  discountKobo: number;
  totalKobo: number;
  payments: CompletedPayment[];
  changeKobo: number;
  soldAt?: string;
}): CompletedSaleResult {
  return {
    saleId: 0, // no server id yet — resolved at sync
    receiptNo: args.localReceiptNo,
    cashierName: args.cashierName,
    soldAt: args.soldAt ?? new Date().toISOString(),
    lines: args.lines,
    subtotalKobo: args.subtotalKobo,
    discountKobo: args.discountKobo,
    totalKobo: args.totalKobo,
    payments: args.payments,
    changeKobo: args.changeKobo,
    offline: true,
  };
}
