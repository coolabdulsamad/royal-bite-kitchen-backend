/** Restaurant-wide configuration keys stored in the `settings` table. */

export const SETTING_KEYS = [
  "business_name",
  "business_address",
  "business_phone",
  "receipt_footer",
  "receipt_show_address",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export interface BusinessSettings {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  receiptFooter: string;
  receiptShowAddress: boolean;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: "Royal Bite Kitchen",
  businessAddress: "",
  businessPhone: "",
  receiptFooter: "Thank you for dining with us",
  receiptShowAddress: true,
};

/** Map raw DB rows (key/value strings) onto the typed settings shape. */
export function toBusinessSettings(rows: { key: string; value: string }[]): BusinessSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    businessName: map.get("business_name") || DEFAULT_SETTINGS.businessName,
    businessAddress: map.get("business_address") ?? DEFAULT_SETTINGS.businessAddress,
    businessPhone: map.get("business_phone") ?? DEFAULT_SETTINGS.businessPhone,
    receiptFooter: map.get("receipt_footer") || DEFAULT_SETTINGS.receiptFooter,
    receiptShowAddress: map.get("receipt_show_address") !== "false",
  };
}

export const SETTING_LABEL: Record<SettingKey, string> = {
  business_name: "Business name",
  business_address: "Address",
  business_phone: "Phone",
  receipt_footer: "Receipt footer",
  receipt_show_address: "Show address on receipts",
};
