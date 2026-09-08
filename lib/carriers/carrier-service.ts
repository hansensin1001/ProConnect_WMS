import "server-only";

import { randomBytes } from "crypto";
import { createThermalLabelPdf } from "./label";
import { carrierDisplayName, type CarrierCredentials, type CarrierSettings, type ShipmentRequest, type ShipmentResult } from "./types";

export class CarrierServiceError extends Error {}

interface CarrierAdapter {
  createShipment(settings: CarrierSettings, credentials: CarrierCredentials, request: ShipmentRequest): Promise<ShipmentResult>;
}

function sandboxShipment(settings: CarrierSettings, request: ShipmentRequest) {
  const prefix = settings.carrier_code === "DHL_EXPRESS" ? "DHL-SBX" : settings.carrier_code === "NINJA_VAN" ? "NV-SBX" : "MAN";
  const trackingNumber = `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
  return {
    trackingNumber,
    serviceCode: request.serviceCode?.trim() || "STANDARD",
    labelBase64: createThermalLabelPdf(request, carrierDisplayName(settings.carrier_code), trackingNumber),
    labelContentType: "application/pdf" as const,
    carrierStatus: "LABEL_CREATED" as const,
  };
}

function productionNotConnected(settings: CarrierSettings, credentials: CarrierCredentials): never {
  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new CarrierServiceError(`${settings.display_name} requires an API key and secret before production labels can be created.`);
  }
  throw new CarrierServiceError(`${settings.display_name} production adapter is not enabled for this account. Keep this carrier in Sandbox until its contracted production endpoint and webhook signature format have been certified.`);
}

class DhlExpressAdapter implements CarrierAdapter {
  async createShipment(settings: CarrierSettings, credentials: CarrierCredentials, request: ShipmentRequest) {
    if (settings.is_sandbox) return sandboxShipment(settings, request);
    return productionNotConnected(settings, credentials);
  }
}

class NinjaVanAdapter implements CarrierAdapter {
  async createShipment(settings: CarrierSettings, credentials: CarrierCredentials, request: ShipmentRequest) {
    if (settings.is_sandbox) return sandboxShipment(settings, request);
    return productionNotConnected(settings, credentials);
  }
}

class ManualCarrierAdapter implements CarrierAdapter {
  async createShipment(settings: CarrierSettings, _credentials: CarrierCredentials, request: ShipmentRequest) {
    // A manual shipment still receives a WMS-controlled AWB and printable
    // label, but deliberately makes no external API call.
    return sandboxShipment(settings, request);
  }
}

const adapters: Record<CarrierSettings["carrier_code"], CarrierAdapter> = {
  MANUAL: new ManualCarrierAdapter(),
  DHL_EXPRESS: new DhlExpressAdapter(),
  NINJA_VAN: new NinjaVanAdapter(),
};

/**
 * Provider-neutral gateway. New carriers only need an adapter here; callers
 * continue to use the same shipment result, label, and tracking contracts.
 */
export class CarrierService {
  static async createShipment(settings: CarrierSettings, credentials: CarrierCredentials, request: ShipmentRequest) {
    if (!settings.is_active) throw new CarrierServiceError("The selected carrier is disabled.");
    const adapter = adapters[settings.carrier_code];
    if (!adapter) throw new CarrierServiceError("This carrier is not supported by the integration gateway.");
    return adapter.createShipment(settings, credentials, request);
  }
}
