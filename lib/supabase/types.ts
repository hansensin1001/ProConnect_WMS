// Hand-written types matching supabase/schema.sql.
// Once the project is live, regenerate with:
//   npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          deployment_mode: "managed" | "client_managed";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
      };
      org_members: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          role: "owner" | "manager" | "operator";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["org_members"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["org_members"]["Row"]>;
      };
      warehouses: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          address: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["warehouses"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["warehouses"]["Row"]>;
      };
      warehouse_zones: {
        Row: {
          id: string;
          warehouse_id: string;
          zone_code: string;
          zone_type: "RECEIVING" | "PICKING" | "STORAGE" | "DISPATCH";
        };
        Insert: Partial<Database["public"]["Tables"]["warehouse_zones"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["warehouse_zones"]["Row"]>;
      };
      locations: {
        Row: {
          id: string;
          zone_id: string;
          location_code: string;
          aisle: string | null;
          rack: string | null;
          shelf: string | null;
          bin: string | null;
          is_active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["locations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["locations"]["Row"]>;
      };
      products: {
        Row: {
          id: string;
          org_id: string;
          sku: string;
          barcode: string;
          name: string;
          description: string | null;
          price: number;
          is_serialized: boolean;
          unit_of_measure: string;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
      };
      inventory_balances: {
        Row: {
          id: string;
          product_id: string;
          location_id: string;
          lot_number: string | null;
          quantity_on_hand: number;
          quantity_reserved: number;
          quantity_quarantined: number;
          expiry_date: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["inventory_balances"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["inventory_balances"]["Row"]>;
      };
      serial_numbers: {
        Row: {
          id: string;
          org_id: string;
          product_id: string;
          location_id: string;
          purchase_order_id: string | null;
          purchase_order_item_id: string | null;
          sales_order_id: string | null;
          sales_order_item_id: string | null;
          rma_id: string | null;
          rtv_id: string | null;
          serial_number: string;
          status: "IN_STOCK" | "SHIPPED" | "VOIDED" | "QUARANTINED" | "RTV_PENDING";
          received_at: string;
          shipped_at: string | null;
          returned_at: string | null;
          vendor_returned_at: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["serial_numbers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["serial_numbers"]["Row"]>;
      };
      sales_orders: {
        Row: {
          id: string;
          org_id: string;
          order_number: string;
          platform: string;
          customer_name: string | null;
          status: "NEW" | "ALLOCATED" | "PICKING" | "PACKED" | "SHIPPED";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["sales_orders"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["sales_orders"]["Row"]>;
      };
      order_items: {
        Row: {
          id: string;
          sales_order_id: string;
          product_id: string;
          quantity_requested: number;
          quantity_picked: number;
        };
        Insert: Partial<Database["public"]["Tables"]["order_items"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["order_items"]["Row"]>;
      };
      scan_events: {
        Row: {
          id: string;
          org_id: string;
          warehouse_id: string;
          user_id: string;
          event_type: "PUTAWAY" | "PICK" | "CYCLE_COUNT";
          product_id: string | null;
          location_id: string | null;
          quantity: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["scan_events"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["scan_events"]["Row"]>;
      };
    };
    Views: {};
    Functions: {
      apply_scan_event: {
        Args: {
          p_org_id: string;
          p_warehouse_id: string;
          p_event_type: string;
          p_product_id: string;
          p_location_id: string;
          p_quantity: number;
          p_lot_number?: string;
        };
        Returns: void;
      };
    };
    Enums: {};
    CompositeTypes: {};
  };
};
