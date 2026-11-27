/**
 * Customer-facing display protocol.
 *
 * The POS window publishes state over a BroadcastChannel; any window opened
 * on /display (same device, same browser) renders it. Works today with a
 * second browser window on a customer-facing screen; the Android APK will
 * render the same page on the built-in second display (Step 10).
 */

export const DISPLAY_CHANNEL = "rbk-customer-display";

export interface DisplayLine {
  name: string;
  quantity: number;
  /** modifier summaries, e.g. "Large +₦700" */
  modifiers: string[];
  lineTotalKobo: number;
}

export interface DisplayPayment {
  /** e.g. "Cash", "Bank POS" */
  label: string;
  amountKobo: number;
}

export type CustomerDisplayState =
  | { kind: "idle" }
  | {
      kind: "building";
      lines: DisplayLine[];
      subtotalKobo: number;
      discountKobo: number;
      totalKobo: number;
      /** Set once the cashier attaches a customer (regulars / credit tabs). */
      customerName?: string | null;
    }
  | {
      kind: "payment";
      totalKobo: number;
      paidKobo: number;
      payments: DisplayPayment[];
      customerName?: string | null;
    }
  | {
      kind: "complete";
      receiptNo: string;
      totalKobo: number;
      paidKobo: number;
      changeKobo: number;
      payments: DisplayPayment[];
      customerName?: string | null;
    };

/** Display → POS handshake: ask the POS to re-send its current state. */
export const DISPLAY_REQUEST_STATE = "rbk-display-request-state";

export type DisplayChannelMessage =
  | { type: "state"; state: CustomerDisplayState }
  | { type: typeof DISPLAY_REQUEST_STATE };
