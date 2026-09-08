export const SUPPORTED_CARRIERS = [
  { code: "DHL_EXPRESS", displayName: "DHL Express" },
  { code: "NINJA_VAN", displayName: "Ninja Van" },
] as const;

export type CarrierCode = (typeof SUPPORTED_CARRIERS)[number]["code"];
export type CarrierEnvironment = "sandbox" | "production";

export type CarrierCredentials = {
  apiKey?: string;
  apiSecret?: string;
  accountNumber?: string;
  clientId?: string;
  webhookSecret?: string;
};

export type CarrierSettings = {
  id: string;
  organization_id: string;
  carrier_code: CarrierCode;
  display_name: string;
  is_active: boolean;
  is_sandbox: boolean;
  encrypted_credentials: string;
};

export type CarrierSummary = Omit<CarrierSettings, "encrypted_credentials"> & {
  created_at?: string;
  updated_at?: string;
};

export type ShipmentRequest = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPostcode: string;
  itemCount: number;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  serviceCode?: string;
};

export type ShipmentResult = {
  trackingNumber: string;
  serviceCode: string;
  labelBase64: string;
  labelContentType: "application/pdf";
  carrierStatus: "LABEL_CREATED";
};

export function isCarrierCode(value: unknown): value is CarrierCode {
  return typeof value === "string" && SUPPORTED_CARRIERS.some((carrier) => carrier.code === value);
}

export function carrierDisplayName(code: CarrierCode) {
  return SUPPORTED_CARRIERS.find((carrier) => carrier.code === code)?.displayName ?? code;
}
