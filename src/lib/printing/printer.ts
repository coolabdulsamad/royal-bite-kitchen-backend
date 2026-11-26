/**
 * Printer manager — single app-wide source of truth for how receipts print.
 *
 * Modes:
 *  - "browser": uses window.print() with the @media print CSS (default, always works)
 *  - "direct":  raw ESC/POS bytes to a USB or Bluetooth thermal printer
 *
 * Settings persist in localStorage. Device handles can't be persisted, so a
 * direct printer reconnects via connectUsb/connectBle (WebUSB can silently
 * re-grant previously allowed devices via reconnectUsbPrinter).
 */
import { useSyncExternalStore } from "react";
import {
  kitchenTicketToEscPos,
  receiptToEscPos,
  testTicketEscPos,
  type KitchenTicketData,
  type ReceiptData,
} from "./escpos";
import { getCachedBusinessSettings } from "../businessSettings";
import {
  connectBlePrinter,
  connectUsbPrinter,
  isWebBleSupported,
  isWebUsbSupported,
  type DirectPrinter,
} from "./transports";

export interface PrinterSettings {
  /** Auto-print right after each completed sale. */
  autoPrint: boolean;
  /** 48 ≈ 80mm paper, 32 ≈ 58mm paper. */
  width: 32 | 48;
  /** Print "NGN 1,780" instead of "₦1,780" (printers that garble UTF-8). */
  asciiMoney: boolean;
}

const SETTINGS_KEY = "rbk.print.settings";

const DEFAULT_SETTINGS: PrinterSettings = {
  autoPrint: false,
  width: 48,
  asciiMoney: false,
};

export interface PrinterState {
  settings: PrinterSettings;
  direct: { kind: "usb" | "ble"; label: string } | null;
  busy: boolean;
  lastError: string | null;
  usbSupported: boolean;
  bleSupported: boolean;
}

type Listener = () => void;

class PrinterManager {
  private settings: PrinterSettings;
  private printer: DirectPrinter | null = null;
  private busy = false;
  private lastError: string | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): PrinterSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<PrinterSettings>;
      return {
        autoPrint: Boolean(parsed.autoPrint),
        width: parsed.width === 32 ? 32 : 48,
        asciiMoney: Boolean(parsed.asciiMoney),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // storage unavailable — settings stay session-only
    }
  }

  // ── observable state ──
  // getState must return a STABLE snapshot reference between emissions,
  // otherwise useSyncExternalStore re-renders forever.
  private snapshot: PrinterState | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.snapshot = null; // invalidate — rebuilt lazily on next getState
    for (const l of this.listeners) l();
  }

  getState = (): PrinterState => {
    if (this.snapshot === null) {
      this.snapshot = {
        settings: this.settings,
        direct: this.printer
          ? { kind: this.printer.kind, label: this.printer.label }
          : null,
        busy: this.busy,
        lastError: this.lastError,
        usbSupported: typeof navigator !== "undefined" && isWebUsbSupported(),
        bleSupported: typeof navigator !== "undefined" && isWebBleSupported(),
      };
    }
    return this.snapshot;
  };

  updateSettings(patch: Partial<PrinterSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.saveSettings();
    this.emit();
  }

  clearError() {
    this.lastError = null;
    this.emit();
  }

  // ── connections ──
  async connectUsb(): Promise<void> {
    this.busy = true;
    this.lastError = null;
    this.emit();
    try {
      await this.disconnectDirect();
      this.printer = await connectUsbPrinter();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Could not connect the USB printer.";
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async connectBle(): Promise<void> {
    this.busy = true;
    this.lastError = null;
    this.emit();
    try {
      await this.disconnectDirect();
      this.printer = await connectBlePrinter();
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message : "Could not connect the Bluetooth printer.";
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async disconnectDirect(): Promise<void> {
    if (this.printer) {
      await this.printer.disconnect().catch(() => {});
      this.printer = null;
      this.emit();
    }
  }

  // ── printing ──
  /** Print a receipt. Returns "direct" or "browser" to say which path was used. */
  async printReceipt(sale: ReceiptData): Promise<"direct" | "browser"> {
    if (this.printer) {
      this.busy = true;
      this.lastError = null;
      this.emit();
      try {
        const biz = getCachedBusinessSettings();
        const bytes = receiptToEscPos(sale, {
          width: this.settings.width,
          asciiMoney: this.settings.asciiMoney,
          storeName: biz.businessName,
          footerLine: biz.receiptFooter,
          headerLines: biz.receiptShowAddress
            ? [biz.businessAddress, biz.businessPhone].filter(Boolean)
            : [biz.businessPhone].filter(Boolean),
        });
        await this.printer.write(bytes);
        return "direct";
      } catch (err) {
        this.lastError =
          err instanceof Error ? err.message : "Printing failed — check the printer.";
        // direct printer is likely gone; drop it so the next print uses the browser
        await this.disconnectDirect();
        throw err instanceof Error ? err : new Error("Printing failed.");
      } finally {
        this.busy = false;
        this.emit();
      }
    }
    window.print();
    return "browser";
  }

  /**
   * Kitchen ticket — direct thermal printers only. There's no on-screen paper
   * layout for tickets, so with no direct printer this is a no-op ("skipped")
   * rather than a confusing browser print of the whole page.
   */
  async printKitchenTicket(ticket: KitchenTicketData): Promise<"direct" | "skipped"> {
    if (!this.printer) return "skipped";
    this.busy = true;
    this.lastError = null;
    this.emit();
    try {
      const bytes = kitchenTicketToEscPos(ticket, {
        width: this.settings.width,
        asciiMoney: this.settings.asciiMoney,
      });
      await this.printer.write(bytes);
      return "direct";
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message : "Printing failed — check the printer.";
      await this.disconnectDirect();
      throw err instanceof Error ? err : new Error("Printing failed.");
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async printTestTicket(): Promise<"direct" | "browser"> {
    if (this.printer) {
      this.busy = true;
      this.lastError = null;
      this.emit();
      try {
        const bytes = testTicketEscPos({
          width: this.settings.width,
          asciiMoney: this.settings.asciiMoney,
        });
        await this.printer.write(bytes);
        return "direct";
      } catch (err) {
        this.lastError =
          err instanceof Error ? err.message : "Test print failed — check the printer.";
        await this.disconnectDirect();
        throw err instanceof Error ? err : new Error("Test print failed.");
      } finally {
        this.busy = false;
        this.emit();
      }
    }
    window.print();
    return "browser";
  }
}

export const printerManager = new PrinterManager();

export function usePrinter(): PrinterState {
  return useSyncExternalStore(printerManager.subscribe, printerManager.getState);
}
