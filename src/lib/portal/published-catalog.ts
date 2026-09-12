import type { PlazaModel } from "@/lib/catalog";
import type { PortalModelVendor } from "./content-config";

/** Public discovery is an allowlist; upstream and sample rows cannot republish hidden models. */
export function publishedCatalog(models: PlazaModel[], vendors: PortalModelVendor[]): PlazaModel[] {
  const source = new Map(models.map((model) => [model.model_name.trim().toLowerCase(), model]));
  return vendors.filter((vendor) => vendor.enabled).flatMap((vendor) =>
    vendor.models.flatMap((configured) => {
      const model = source.get(configured.name.trim().toLowerCase()) ?? {
        model_name: configured.name, catalog_only: true,
        quota_type: 0, model_price: 0, model_ratio: 1,
      };
      return [{
        ...model,
        vendor_id: undefined,
        vendor_key: vendor.key,
        vendor_name: vendor.name,
        vendor_logo: vendor.logoUrl,
        portal_category: vendor.category,
        supported_endpoint_types: configured.endpointTypes,
      }];
    }),
  );
}
