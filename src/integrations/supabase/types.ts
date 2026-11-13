export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      admin_allowlist: {
        Row: {
          created_at: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          alert_pct: number
          auto_route: boolean
          daily_limit_usd: number | null
          enabled: boolean
          id: boolean
          last_check_at: string | null
          last_check_status: string | null
          limit_policy: string
          model_advanced: string
          model_copilot: string | null
          model_economy: string
          model_vision: string | null
          model_voice: string
          monthly_limit_usd: number | null
          prices: Json
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_pct?: number
          auto_route?: boolean
          daily_limit_usd?: number | null
          enabled?: boolean
          id?: boolean
          last_check_at?: string | null
          last_check_status?: string | null
          limit_policy?: string
          model_advanced?: string
          model_copilot?: string | null
          model_economy?: string
          model_vision?: string | null
          model_voice?: string
          monthly_limit_usd?: number | null
          prices?: Json
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_pct?: number
          auto_route?: boolean
          daily_limit_usd?: number | null
          enabled?: boolean
          id?: boolean
          last_check_at?: string | null
          last_check_status?: string | null
          limit_policy?: string
          model_advanced?: string
          model_copilot?: string | null
          model_economy?: string
          model_vision?: string | null
          model_voice?: string
          monthly_limit_usd?: number | null
          prices?: Json
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          audio_seconds: number
          cost_usd: number
          created_at: string
          error_code: string | null
          feature: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          ok: boolean
          output_tokens: number
          profile: string
          task: string | null
        }
        Insert: {
          audio_seconds?: number
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          feature: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model: string
          ok?: boolean
          output_tokens?: number
          profile: string
          task?: string | null
        }
        Update: {
          audio_seconds?: number
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          feature?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          ok?: boolean
          output_tokens?: number
          profile?: string
          task?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          customer_id: string | null
          decant_ml: number | null
          device: string | null
          event: string
          id: number
          meta: Json
          path: string | null
          price: number | null
          product_id: string | null
          promotion_id: string | null
          query: string | null
          session_key: string | null
          source: string | null
          user_id: string | null
          variant: string | null
          visitor_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          decant_ml?: number | null
          device?: string | null
          event: string
          id?: number
          meta?: Json
          path?: string | null
          price?: number | null
          product_id?: string | null
          promotion_id?: string | null
          query?: string | null
          session_key?: string | null
          source?: string | null
          user_id?: string | null
          variant?: string | null
          visitor_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          decant_ml?: number | null
          device?: string | null
          event?: string
          id?: number
          meta?: Json
          path?: string | null
          price?: number | null
          product_id?: string | null
          promotion_id?: string | null
          query?: string | null
          session_key?: string | null
          source?: string | null
          user_id?: string | null
          variant?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "analytics_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_sessions: {
        Row: {
          browser: string | null
          connection: string | null
          cpu_cores: number | null
          created_at: string
          customer_id: string | null
          device: string | null
          dpr: number | null
          id: string
          landing_path: string | null
          language: string | null
          last_event_at: string
          memory_gb: number | null
          orientation: string | null
          os: string | null
          referrer: string | null
          save_data: boolean | null
          screen: string | null
          session_key: string
          source: string | null
          standalone: boolean | null
          started_at: string
          theme: string | null
          timezone: string | null
          touch: boolean | null
          updated_at: string
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          viewport: string | null
          visitor_id: string
        }
        Insert: {
          browser?: string | null
          connection?: string | null
          cpu_cores?: number | null
          created_at?: string
          customer_id?: string | null
          device?: string | null
          dpr?: number | null
          id?: string
          landing_path?: string | null
          language?: string | null
          last_event_at?: string
          memory_gb?: number | null
          orientation?: string | null
          os?: string | null
          referrer?: string | null
          save_data?: boolean | null
          screen?: string | null
          session_key: string
          source?: string | null
          standalone?: boolean | null
          started_at?: string
          theme?: string | null
          timezone?: string | null
          touch?: boolean | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport?: string | null
          visitor_id: string
        }
        Update: {
          browser?: string | null
          connection?: string | null
          cpu_cores?: number | null
          created_at?: string
          customer_id?: string | null
          device?: string | null
          dpr?: number | null
          id?: string
          landing_path?: string | null
          language?: string | null
          last_event_at?: string
          memory_gb?: number | null
          orientation?: string | null
          os?: string | null
          referrer?: string | null
          save_data?: boolean | null
          screen?: string | null
          session_key?: string
          source?: string | null
          standalone?: boolean | null
          started_at?: string
          theme?: string | null
          timezone?: string | null
          touch?: boolean | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_visitors: {
        Row: {
          browser: string | null
          created_at: string
          customer_id: string | null
          device: string | null
          dpr: number | null
          first_landing: string | null
          first_referrer: string | null
          first_seen_at: string
          first_source: string | null
          language: string | null
          last_referrer: string | null
          last_seen_at: string
          last_source: string | null
          os: string | null
          screen: string | null
          sessions_count: number
          standalone: boolean | null
          theme: string | null
          timezone: string | null
          touch: boolean | null
          updated_at: string
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          viewport: string | null
          visitor_id: string
        }
        Insert: {
          browser?: string | null
          created_at?: string
          customer_id?: string | null
          device?: string | null
          dpr?: number | null
          first_landing?: string | null
          first_referrer?: string | null
          first_seen_at?: string
          first_source?: string | null
          language?: string | null
          last_referrer?: string | null
          last_seen_at?: string
          last_source?: string | null
          os?: string | null
          screen?: string | null
          sessions_count?: number
          standalone?: boolean | null
          theme?: string | null
          timezone?: string | null
          touch?: boolean | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport?: string | null
          visitor_id: string
        }
        Update: {
          browser?: string | null
          created_at?: string
          customer_id?: string | null
          device?: string | null
          dpr?: number | null
          first_landing?: string | null
          first_referrer?: string | null
          first_seen_at?: string
          first_source?: string | null
          language?: string | null
          last_referrer?: string | null
          last_seen_at?: string
          last_source?: string | null
          os?: string | null
          screen?: string | null
          sessions_count?: number
          standalone?: boolean | null
          theme?: string | null
          timezone?: string | null
          touch?: boolean | null
          updated_at?: string
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_visitors_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      back_in_stock_notifications: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          notified_at: string | null
          product_id: string
          status: string
          subscription_id: string
          user_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          notified_at?: string | null
          product_id: string
          status?: string
          subscription_id: string
          user_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          notified_at?: string | null
          product_id?: string
          status?: string
          subscription_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "back_in_stock_notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "back_in_stock_notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "back_in_stock_notifications_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "back_in_stock_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      back_in_stock_subscriptions: {
        Row: {
          active: boolean
          anonymous_id: string | null
          canceled_at: string | null
          channel: string
          created_at: string
          email: string | null
          id: string
          notified_at: string | null
          phone: string | null
          phone_normalized: string | null
          product_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          anonymous_id?: string | null
          canceled_at?: string | null
          channel?: string
          created_at?: string
          email?: string | null
          id?: string
          notified_at?: string | null
          phone?: string | null
          phone_normalized?: string | null
          product_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          anonymous_id?: string | null
          canceled_at?: string | null
          channel?: string
          created_at?: string
          email?: string | null
          id?: string
          notified_at?: string | null
          phone?: string | null
          phone_normalized?: string | null
          product_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "back_in_stock_subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "back_in_stock_subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_accounts: {
        Row: {
          blocked_by: string | null
          created_at: string
          email: string
        }
        Insert: {
          blocked_by?: string | null
          created_at?: string
          email: string
        }
        Update: {
          blocked_by?: string | null
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      brand_aliases: {
        Row: {
          alias: string
          alias_key: string
          brand_id: string
          created_at: string
          id: string
          source: string
          supplier_id: string | null
        }
        Insert: {
          alias: string
          alias_key: string
          brand_id: string
          created_at?: string
          id?: string
          source?: string
          supplier_id?: string | null
        }
        Update: {
          alias?: string
          alias_key?: string
          brand_id?: string
          created_at?: string
          id?: string
          source?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_aliases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_duplicate_ignores: {
        Row: {
          actor: string | null
          brand_a: string | null
          brand_b: string | null
          created_at: string
          id: string
          pair_key: string
        }
        Insert: {
          actor?: string | null
          brand_a?: string | null
          brand_b?: string | null
          created_at?: string
          id?: string
          pair_key: string
        }
        Update: {
          actor?: string | null
          brand_a?: string | null
          brand_b?: string | null
          created_at?: string
          id?: string
          pair_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_duplicate_ignores_brand_a_fkey"
            columns: ["brand_a"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_duplicate_ignores_brand_b_fkey"
            columns: ["brand_b"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_merges: {
        Row: {
          actor: string | null
          aliases_moved: number
          created_at: string
          from_brand_name: string
          id: string
          products_moved: number
          to_brand_id: string | null
          to_brand_name: string
        }
        Insert: {
          actor?: string | null
          aliases_moved?: number
          created_at?: string
          from_brand_name: string
          id?: string
          products_moved?: number
          to_brand_id?: string | null
          to_brand_name: string
        }
        Update: {
          actor?: string | null
          aliases_moved?: number
          created_at?: string
          from_brand_name?: string
          id?: string
          products_moved?: number
          to_brand_id?: string | null
          to_brand_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_merges_to_brand_id_fkey"
            columns: ["to_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_segment_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          label: string
          rule_key: string
          segment: string
          source: string
          target_brand: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label: string
          rule_key: string
          segment: string
          source?: string
          target_brand?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string
          rule_key?: string
          segment?: string
          source?: string
          target_brand?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          allow_perfumes: boolean
          canonical_name: string
          created_at: string
          id: string
          normalized_name: string | null
          segment: string
          segment_reviewed_by: string | null
          segment_source: string | null
          segment_updated_at: string | null
          slug: string
        }
        Insert: {
          allow_perfumes?: boolean
          canonical_name: string
          created_at?: string
          id?: string
          normalized_name?: string | null
          segment?: string
          segment_reviewed_by?: string | null
          segment_source?: string | null
          segment_updated_at?: string | null
          slug: string
        }
        Update: {
          allow_perfumes?: boolean
          canonical_name?: string
          created_at?: string
          id?: string
          normalized_name?: string | null
          segment?: string
          segment_reviewed_by?: string | null
          segment_source?: string | null
          segment_updated_at?: string | null
          slug?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          brand: string | null
          cart_id: string
          created_at: string
          decant_ml: number | null
          id: string
          image_url: string | null
          product_id: string | null
          product_name: string | null
          quantity: number
          unit_price: number | null
          variant: string
          variant_key: string
        }
        Insert: {
          brand?: string | null
          cart_id: string
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_url?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          unit_price?: number | null
          variant?: string
          variant_key: string
        }
        Update: {
          brand?: string | null
          cart_id?: string
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_url?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          unit_price?: number | null
          variant?: string
          variant_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "shopping_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_aliases: {
        Row: {
          alias: string
          alias_key: string
          alias_type: string
          brand_id: string | null
          confirmations: number
          created_at: string
          id: string
          product_id: string | null
          source: string
          supplier_id: string | null
        }
        Insert: {
          alias: string
          alias_key: string
          alias_type: string
          brand_id?: string | null
          confirmations?: number
          created_at?: string
          id?: string
          product_id?: string | null
          source?: string
          supplier_id?: string | null
        }
        Update: {
          alias?: string
          alias_key?: string
          alias_type?: string
          brand_id?: string | null
          confirmations?: number
          created_at?: string
          id?: string
          product_id?: string | null
          source?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_aliases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "catalog_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_order_items: {
        Row: {
          coupon_discount: number
          created_at: string
          decant_ml: number | null
          id: string
          image_snapshot: string | null
          order_id: string
          product_id: string | null
          product_name_snapshot: string
          promotion_discount: number
          promotion_id: string | null
          promotion_percent: number | null
          quantity: number
          subtotal: number
          paid: boolean
          supplier_chosen: boolean
          supplier_id: string | null
          supplier_product_id: string | null
          supplier_snapshot: string | null
          supplier_url_snapshot: string | null
          unit_base_price: number | null
          unit_cost_snapshot: number | null
          unit_sale_price: number
          variant: string
          variant_label: string | null
        }
        Insert: {
          coupon_discount?: number
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_snapshot?: string | null
          order_id: string
          product_id?: string | null
          product_name_snapshot: string
          promotion_discount?: number
          promotion_id?: string | null
          promotion_percent?: number | null
          quantity?: number
          subtotal?: number
          paid?: boolean
          supplier_chosen?: boolean
          supplier_id?: string | null
          supplier_product_id?: string | null
          supplier_snapshot?: string | null
          supplier_url_snapshot?: string | null
          unit_base_price?: number | null
          unit_cost_snapshot?: number | null
          unit_sale_price?: number
          variant?: string
          variant_label?: string | null
        }
        Update: {
          coupon_discount?: number
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_snapshot?: string | null
          order_id?: string
          product_id?: string | null
          product_name_snapshot?: string
          promotion_discount?: number
          promotion_id?: string | null
          promotion_percent?: number | null
          quantity?: number
          subtotal?: number
          paid?: boolean
          supplier_chosen?: boolean
          supplier_id?: string | null
          supplier_product_id?: string | null
          supplier_snapshot?: string | null
          supplier_url_snapshot?: string | null
          unit_base_price?: number | null
          unit_cost_snapshot?: number | null
          unit_sale_price?: number
          variant?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "catalog_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_orders: {
        Row: {
          amount_due: number
          amount_paid: number
          canceled_at: string | null
          card_total: number | null
          confirmed_at: string | null
          cost_total: number
          coupon_code: string | null
          coupon_discount: number
          coupon_id: string | null
          coupon_percent: number | null
          created_at: string
          created_by: string | null
          crm_customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_phone_normalized: string | null
          customer_user_id: string | null
          deleted_at: string | null
          delivered_at: string | null
          delivery_notes: string | null
          deposit_percent: number
          expected_delivery_date: string | null
          expected_delivery_time: string | null
          final_total: number | null
          fulfillment_type: string
          grand_total: number | null
          id: string
          idempotency_key: string | null
          is_confirmed: boolean
          items_subtotal: number
          notes: string | null
          order_number: string | null
          order_origin: string
          origin: string
          paid_at: string | null
          payment_discount_percent: number
          payment_due_date: string | null
          payment_method: string
          payment_status: string
          pix_total: number | null
          pricing_tier: string
          promotion_discount: number
          sales_total: number
          shipping_cep: string | null
          shipping_city: string | null
          shipping_complement: string | null
          shipping_days: number | null
          shipping_district: string | null
          shipping_number: string | null
          shipping_price: number
          shipping_quote: Json | null
          shipping_service: string | null
          shipping_state: string | null
          shipping_street: string | null
          status: string
          total_quantity: number
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          canceled_at?: string | null
          card_total?: number | null
          confirmed_at?: string | null
          cost_total?: number
          coupon_code?: string | null
          coupon_discount?: number
          coupon_id?: string | null
          coupon_percent?: number | null
          created_at?: string
          created_by?: string | null
          crm_customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_phone_normalized?: string | null
          customer_user_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          deposit_percent?: number
          expected_delivery_date?: string | null
          expected_delivery_time?: string | null
          final_total?: number | null
          fulfillment_type?: string
          grand_total?: number | null
          id?: string
          idempotency_key?: string | null
          is_confirmed?: boolean
          items_subtotal?: number
          notes?: string | null
          order_number?: string | null
          order_origin?: string
          origin?: string
          paid_at?: string | null
          payment_discount_percent?: number
          payment_due_date?: string | null
          payment_method?: string
          payment_status?: string
          pix_total?: number | null
          pricing_tier?: string
          promotion_discount?: number
          sales_total?: number
          shipping_cep?: string | null
          shipping_city?: string | null
          shipping_complement?: string | null
          shipping_days?: number | null
          shipping_district?: string | null
          shipping_number?: string | null
          shipping_price?: number
          shipping_quote?: Json | null
          shipping_service?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          status?: string
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          canceled_at?: string | null
          card_total?: number | null
          confirmed_at?: string | null
          cost_total?: number
          coupon_code?: string | null
          coupon_discount?: number
          coupon_id?: string | null
          coupon_percent?: number | null
          created_at?: string
          created_by?: string | null
          crm_customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_phone_normalized?: string | null
          customer_user_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_notes?: string | null
          deposit_percent?: number
          expected_delivery_date?: string | null
          expected_delivery_time?: string | null
          final_total?: number | null
          fulfillment_type?: string
          grand_total?: number | null
          id?: string
          idempotency_key?: string | null
          is_confirmed?: boolean
          items_subtotal?: number
          notes?: string | null
          order_number?: string | null
          order_origin?: string
          origin?: string
          paid_at?: string | null
          payment_discount_percent?: number
          payment_due_date?: string | null
          payment_method?: string
          payment_status?: string
          pix_total?: number | null
          pricing_tier?: string
          promotion_discount?: number
          sales_total?: number
          shipping_cep?: string | null
          shipping_city?: string | null
          shipping_complement?: string | null
          shipping_days?: number | null
          shipping_district?: string | null
          shipping_number?: string | null
          shipping_price?: number
          shipping_quote?: Json | null
          shipping_service?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          status?: string
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_orders_crm_customer_id_fkey"
            columns: ["crm_customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_search_misses: {
        Row: {
          created_at: string
          hits: number
          last_at: string
          query: string
          query_norm: string
        }
        Insert: {
          created_at?: string
          hits?: number
          last_at?: string
          query: string
          query_norm: string
        }
        Update: {
          created_at?: string
          hits?: number
          last_at?: string
          query?: string
          query_norm?: string
        }
        Relationships: []
      }
      copilot_actions: {
        Row: {
          created_at: string
          error: string | null
          executed_at: string | null
          expires_at: string
          id: string
          intent: string
          params: Json
          preview: Json | null
          result: Json | null
          risk: string
          status: string
          thread_id: string | null
          tool: string
          undo_of: string | null
          undone_by: string | null
          user_id: string
          utterance: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          intent?: string
          params?: Json
          preview?: Json | null
          result?: Json | null
          risk?: string
          status?: string
          thread_id?: string | null
          tool: string
          undo_of?: string | null
          undone_by?: string | null
          user_id?: string
          utterance?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          intent?: string
          params?: Json
          preview?: Json | null
          result?: Json | null
          risk?: string
          status?: string
          thread_id?: string | null
          tool?: string
          undo_of?: string | null
          undone_by?: string | null
          user_id?: string
          utterance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "copilot_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_actions_undo_of_fkey"
            columns: ["undo_of"]
            isOneToOne: false
            referencedRelation: "copilot_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_aliases: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          meaning: string
          phrase: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          meaning: string
          phrase: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          meaning?: string
          phrase?: string
        }
        Relationships: []
      }
      copilot_commands: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          instructions: string
          name: string
          phrases: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          instructions: string
          name: string
          phrases?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          instructions?: string
          name?: string
          phrases?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      copilot_threads: {
        Row: {
          created_at: string
          id: string
          messages: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      copilot_voice_metrics: {
        Row: {
          audio_bytes: number | null
          auth_ms: number | null
          created_at: string
          entities: Json | null
          fast_path: boolean
          id: string
          intent: string | null
          resolve_ms: number | null
          source: string
          speech_ms: number | null
          thread_id: string | null
          total_ms: number | null
          transcript_normalized: string | null
          transcript_raw: string | null
          transcription_ms: number | null
          user_id: string
        }
        Insert: {
          audio_bytes?: number | null
          auth_ms?: number | null
          created_at?: string
          entities?: Json | null
          fast_path?: boolean
          id?: string
          intent?: string | null
          resolve_ms?: number | null
          source?: string
          speech_ms?: number | null
          thread_id?: string | null
          total_ms?: number | null
          transcript_normalized?: string | null
          transcript_raw?: string | null
          transcription_ms?: number | null
          user_id?: string
        }
        Update: {
          audio_bytes?: number | null
          auth_ms?: number | null
          created_at?: string
          entities?: Json | null
          fast_path?: boolean
          id?: string
          intent?: string | null
          resolve_ms?: number | null
          source?: string
          speech_ms?: number | null
          thread_id?: string | null
          total_ms?: number | null
          transcript_normalized?: string | null
          transcript_raw?: string | null
          transcription_ms?: number | null
          user_id?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          created_at: string
          device_id: string | null
          discount_amount: number
          id: string
          order_id: string | null
          order_total: number
          user_id: string | null
        }
        Insert: {
          coupon_id: string
          created_at?: string
          device_id?: string | null
          discount_amount?: number
          id?: string
          order_id?: string | null
          order_total?: number
          user_id?: string | null
        }
        Update: {
          coupon_id?: string
          created_at?: string
          device_id?: string | null
          discount_amount?: number
          id?: string
          order_id?: string | null
          order_total?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          announce: boolean
          announce_cta: string | null
          announce_footnote: string | null
          announce_message: string | null
          announce_reset_at: string | null
          announce_theme: string
          announce_title: string | null
          applies_to: string
          code: string
          created_at: string
          created_by: string | null
          decant_sizes: number[]
          discount_percent: number
          discount_total: number
          ends_at: string | null
          id: string
          max_per_user: number | null
          max_redemptions: number | null
          product_ids: string[]
          redemptions: number
          sales_total: number
          stackable: boolean
          starts_at: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          active?: boolean
          announce?: boolean
          announce_cta?: string | null
          announce_footnote?: string | null
          announce_message?: string | null
          announce_reset_at?: string | null
          announce_theme?: string
          announce_title?: string | null
          applies_to?: string
          code: string
          created_at?: string
          created_by?: string | null
          decant_sizes?: number[]
          discount_percent: number
          discount_total?: number
          ends_at?: string | null
          id?: string
          max_per_user?: number | null
          max_redemptions?: number | null
          product_ids?: string[]
          redemptions?: number
          sales_total?: number
          stackable?: boolean
          starts_at?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          active?: boolean
          announce?: boolean
          announce_cta?: string | null
          announce_footnote?: string | null
          announce_message?: string | null
          announce_reset_at?: string | null
          announce_theme?: string
          announce_title?: string | null
          applies_to?: string
          code?: string
          created_at?: string
          created_by?: string | null
          decant_sizes?: number[]
          discount_percent?: number
          discount_total?: number
          ends_at?: string | null
          id?: string
          max_per_user?: number | null
          max_redemptions?: number | null
          product_ids?: string[]
          redemptions?: number
          sales_total?: number
          stackable?: boolean
          starts_at?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      crm_customer_devices: {
        Row: {
          created_at: string
          customer_id: string
          device_id: string
          id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          device_id: string
          id?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          device_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_customer_devices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_customers: {
        Row: {
          archived_at: string | null
          created_at: string
          email: string | null
          first_source: string | null
          id: string
          lead_trigger: string | null
          marketing_optin: boolean
          marketing_optin_at: string | null
          name: string | null
          phone: string | null
          phone_normalized: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          first_source?: string | null
          id?: string
          lead_trigger?: string | null
          marketing_optin?: boolean
          marketing_optin_at?: string | null
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          first_source?: string | null
          id?: string
          lead_trigger?: string | null
          marketing_optin?: boolean
          marketing_optin_at?: string | null
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      crm_events: {
        Row: {
          created_at: string
          customer_id: string | null
          details: Json | null
          entity_id: string | null
          event: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          details?: Json | null
          entity_id?: string | null
          event: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          details?: Json | null
          entity_id?: string | null
          event?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          note: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          note: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      decant_combos: {
        Row: {
          active: boolean
          combo_price: number
          created_at: string
          created_by: string | null
          decant_sizes: number[]
          discount_total: number
          ends_at: string | null
          id: string
          name: string
          orders_count: number
          quantity: number
          sales_total: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          combo_price: number
          created_at?: string
          created_by?: string | null
          decant_sizes?: number[]
          discount_total?: number
          ends_at?: string | null
          id?: string
          name?: string
          orders_count?: number
          quantity: number
          sales_total?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          combo_price?: number
          created_at?: string
          created_by?: string | null
          decant_sizes?: number[]
          discount_total?: number
          ends_at?: string | null
          id?: string
          name?: string
          orders_count?: number
          quantity?: number
          sales_total?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      decant_events: {
        Row: {
          created_at: string
          details: Json | null
          event: string
          id: string
          product_id: string | null
          session_id: string | null
          user_id: string | null
          variant: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event: string
          id?: string
          product_id?: string | null
          session_id?: string | null
          user_id?: string | null
          variant?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          event?: string
          id?: string
          product_id?: string | null
          session_id?: string | null
          user_id?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      decant_settings: {
        Row: {
          id: boolean
          price_10ml: number
          price_2ml: number
          price_5ml: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          price_10ml?: number
          price_2ml?: number
          price_5ml?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          price_10ml?: number
          price_2ml?: number
          price_5ml?: number
          updated_at?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          anonymous_id: string | null
          created_at: string
          id: string
          product_id: string
          user_id: string | null
          want_decant: boolean
        }
        Insert: {
          anonymous_id?: string | null
          created_at?: string
          id?: string
          product_id: string
          user_id?: string | null
          want_decant?: boolean
        }
        Update: {
          anonymous_id?: string | null
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string | null
          want_decant?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrance_accords: {
        Row: {
          accord_name: string
          created_at: string
          id: string
          intensity: number
          position: number
          product_id: string
          source: string | null
        }
        Insert: {
          accord_name: string
          created_at?: string
          id?: string
          intensity?: number
          position?: number
          product_id: string
          source?: string | null
        }
        Update: {
          accord_name?: string
          created_at?: string
          id?: string
          intensity?: number
          position?: number
          product_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragrance_accords_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrance_accords_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrance_audit_log: {
        Row: {
          after: Json
          before: Json
          changed: boolean
          changes: Json
          created_at: string
          fragrantica_url: string | null
          id: string
          match_confidence: number
          product_id: string
          product_name: string
          status: string
        }
        Insert: {
          after?: Json
          before?: Json
          changed?: boolean
          changes?: Json
          created_at?: string
          fragrantica_url?: string | null
          id?: string
          match_confidence?: number
          product_id: string
          product_name: string
          status: string
        }
        Update: {
          after?: Json
          before?: Json
          changed?: boolean
          changes?: Json
          created_at?: string
          fragrantica_url?: string | null
          id?: string
          match_confidence?: number
          product_id?: string
          product_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fragrance_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrance_audit_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrance_details: {
        Row: {
          audit_status: string
          audited_at: string | null
          confidence: number
          created_at: string
          description: string | null
          description_generated_at: string | null
          description_source: string | null
          enriched_at: string | null
          evidence: Json
          external_match_score: number
          fragrantica_match_confidence: number
          fragrantica_match_score: number
          fragrantica_url: string | null
          import_method: string | null
          last_search_at: string | null
          locked: boolean
          olfactory_family: string | null
          product_id: string
          search_attempts: number
          search_status: string
          source_conflict: boolean
          source_primary: string | null
          source_primary_url: string | null
          source_secondary: string | null
          source_secondary_url: string | null
          status: string
          updated_at: string
          verified: boolean
          verified_by: string | null
        }
        Insert: {
          audit_status?: string
          audited_at?: string | null
          confidence?: number
          created_at?: string
          description?: string | null
          description_generated_at?: string | null
          description_source?: string | null
          enriched_at?: string | null
          evidence?: Json
          external_match_score?: number
          fragrantica_match_confidence?: number
          fragrantica_match_score?: number
          fragrantica_url?: string | null
          import_method?: string | null
          last_search_at?: string | null
          locked?: boolean
          olfactory_family?: string | null
          product_id: string
          search_attempts?: number
          search_status?: string
          source_conflict?: boolean
          source_primary?: string | null
          source_primary_url?: string | null
          source_secondary?: string | null
          source_secondary_url?: string | null
          status?: string
          updated_at?: string
          verified?: boolean
          verified_by?: string | null
        }
        Update: {
          audit_status?: string
          audited_at?: string | null
          confidence?: number
          created_at?: string
          description?: string | null
          description_generated_at?: string | null
          description_source?: string | null
          enriched_at?: string | null
          evidence?: Json
          external_match_score?: number
          fragrantica_match_confidence?: number
          fragrantica_match_score?: number
          fragrantica_url?: string | null
          import_method?: string | null
          last_search_at?: string | null
          locked?: boolean
          olfactory_family?: string | null
          product_id?: string
          search_attempts?: number
          search_status?: string
          source_conflict?: boolean
          source_primary?: string | null
          source_primary_url?: string | null
          source_secondary?: string | null
          source_secondary_url?: string | null
          status?: string
          updated_at?: string
          verified?: boolean
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragrance_details_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrance_details_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrance_notes: {
        Row: {
          created_at: string
          id: string
          note_id: string | null
          note_label: string
          position: number
          product_id: string
          pyramid_level: string
          source: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note_id?: string | null
          note_label: string
          position?: number
          product_id: string
          pyramid_level: string
          source?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string | null
          note_label?: string
          position?: number
          product_id?: string
          pyramid_level?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragrance_notes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "olfactory_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragrance_notes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrance_notes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrantica_brand_pages: {
        Row: {
          brand: string
          brand_norm: string
          created_at: string
          fetched_at: string
          perfumes: number
          status: string
          url: string | null
        }
        Insert: {
          brand: string
          brand_norm: string
          created_at?: string
          fetched_at?: string
          perfumes?: number
          status?: string
          url?: string | null
        }
        Update: {
          brand?: string
          brand_norm?: string
          created_at?: string
          fetched_at?: string
          perfumes?: number
          status?: string
          url?: string | null
        }
        Relationships: []
      }
      fragrantica_import_logs: {
        Row: {
          accords_found: number
          applied: boolean
          blocked_reason: string | null
          completeness: number
          created_at: string
          duration_ms: number | null
          error: string | null
          http_status: number | null
          id: string
          import_method: string | null
          issues: Json
          match_confidence: number | null
          notes_found: number
          parser_version: string
          product_id: string | null
          quality_after: number | null
          quality_before: number | null
          status: string
          strategies: Json
          strategy_used: string | null
          structure: string
          url: string | null
        }
        Insert: {
          accords_found?: number
          applied?: boolean
          blocked_reason?: string | null
          completeness?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          import_method?: string | null
          issues?: Json
          match_confidence?: number | null
          notes_found?: number
          parser_version: string
          product_id?: string | null
          quality_after?: number | null
          quality_before?: number | null
          status: string
          strategies?: Json
          strategy_used?: string | null
          structure?: string
          url?: string | null
        }
        Update: {
          accords_found?: number
          applied?: boolean
          blocked_reason?: string | null
          completeness?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          import_method?: string | null
          issues?: Json
          match_confidence?: number | null
          notes_found?: number
          parser_version?: string
          product_id?: string | null
          quality_after?: number | null
          quality_before?: number | null
          status?: string
          strategies?: Json
          strategy_used?: string | null
          structure?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragrantica_import_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrantica_import_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrantica_index: {
        Row: {
          brand: string | null
          brand_norm: string | null
          concentration: string | null
          created_at: string
          flanker: string | null
          gender: string | null
          id: string
          last_seen_at: string
          name: string
          normalized_name: string
          url: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          brand_norm?: string | null
          concentration?: string | null
          created_at?: string
          flanker?: string | null
          gender?: string | null
          id?: string
          last_seen_at?: string
          name: string
          normalized_name: string
          url: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          brand_norm?: string | null
          concentration?: string | null
          created_at?: string
          flanker?: string | null
          gender?: string | null
          id?: string
          last_seen_at?: string
          name?: string
          normalized_name?: string
          url?: string
          year?: number | null
        }
        Relationships: []
      }
      fragrantica_search_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          from_cache: boolean
          id: string
          product_id: string | null
          query: string | null
          reason: string | null
          requests: number
          score: number
          stage: string | null
          status: string
          url: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          from_cache?: boolean
          id?: string
          product_id?: string | null
          query?: string | null
          reason?: string | null
          requests?: number
          score?: number
          stage?: string | null
          status: string
          url?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          from_cache?: boolean
          id?: string
          product_id?: string | null
          query?: string | null
          reason?: string | null
          requests?: number
          score?: number
          stage?: string | null
          status?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fragrantica_search_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fragrantica_search_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_mappings: {
        Row: {
          attributes: Json | null
          decided_at: string
          decided_by: string | null
          engine_version: string
          id: string
          product_id: string | null
          score: number | null
          signals: Json
          state: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          attributes?: Json | null
          decided_at?: string
          decided_by?: string | null
          engine_version?: string
          id?: string
          product_id?: string | null
          score?: number | null
          signals?: Json
          state: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          attributes?: Json | null
          decided_at?: string
          decided_by?: string | null
          engine_version?: string
          id?: string
          product_id?: string | null
          score?: number | null
          signals?: Json
          state?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "identity_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_mappings_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: true
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_merge_log: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          id: string
          payload: Json
          reason: string | null
          reverted_at: string | null
          reverted_by: string | null
          score: number | null
          source_product_ids: string[]
          target_product_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          score?: number | null
          source_product_ids?: string[]
          target_product_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          payload?: Json
          reason?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          score?: number | null
          source_product_ids?: string[]
          target_product_id?: string | null
        }
        Relationships: []
      }
      identity_negative_pairs: {
        Row: {
          created_at: string
          decided_by: string | null
          id: string
          product_a: string
          product_b: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          decided_by?: string | null
          id?: string
          product_a: string
          product_b: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          decided_by?: string | null
          id?: string
          product_a?: string
          product_b?: string
          reason?: string | null
        }
        Relationships: []
      }
      identity_review_items: {
        Row: {
          created_at: string
          details: Json
          engine_version: string
          id: string
          kind: string
          pair_key: string
          product_a: string | null
          product_b: string | null
          reasons: Json
          recommendation: string
          resolution: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          score: number | null
          status: string
          supplier_product_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          engine_version?: string
          id?: string
          kind: string
          pair_key: string
          product_a?: string | null
          product_b?: string | null
          reasons?: Json
          recommendation: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          score?: number | null
          status?: string
          supplier_product_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          engine_version?: string
          id?: string
          kind?: string
          pair_key?: string
          product_a?: string | null
          product_b?: string | null
          reasons?: Json
          recommendation?: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          score?: number | null
          status?: string
          supplier_product_id?: string | null
        }
        Relationships: []
      }
      identity_runs: {
        Row: {
          anomaly: string | null
          engine_version: string
          finished_at: string | null
          id: string
          mode: string
          report: Json
          started_at: string
          started_by: string | null
          status: string
        }
        Insert: {
          anomaly?: string | null
          engine_version?: string
          finished_at?: string | null
          id?: string
          mode: string
          report?: Json
          started_at?: string
          started_by?: string | null
          status?: string
        }
        Update: {
          anomaly?: string | null
          engine_version?: string
          finished_at?: string | null
          id?: string
          mode?: string
          report?: Json
          started_at?: string
          started_by?: string | null
          status?: string
        }
        Relationships: []
      }
      identity_settings: {
        Row: {
          engine_version: string
          id: boolean
          max_auto_merges_per_run: number
          max_new_canonical_ratio: number
          updated_at: string
          v3_enabled: boolean
        }
        Insert: {
          engine_version?: string
          id?: boolean
          max_auto_merges_per_run?: number
          max_new_canonical_ratio?: number
          updated_at?: string
          v3_enabled?: boolean
        }
        Update: {
          engine_version?: string
          id?: boolean
          max_auto_merges_per_run?: number
          max_new_canonical_ratio?: number
          updated_at?: string
          v3_enabled?: boolean
        }
        Relationships: []
      }
      identity_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          label: string
          run_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          label: string
          run_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          label?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "identity_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          created_at: string
          last4: string
          provider: string
          token: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          last4: string
          provider: string
          token: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          last4?: string
          provider?: string
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          action_id: string | null
          actor: string | null
          after_qty: number
          before_qty: number
          created_at: string
          delta: number
          id: string
          mode: string
          product_id: string
          reason: string | null
          source: string
        }
        Insert: {
          action_id?: string | null
          actor?: string | null
          after_qty: number
          before_qty: number
          created_at?: string
          delta: number
          id?: string
          mode: string
          product_id: string
          reason?: string | null
          source?: string
        }
        Update: {
          action_id?: string | null
          actor?: string | null
          after_qty?: number
          before_qty?: number
          created_at?: string
          delta?: number
          id?: string
          mode?: string
          product_id?: string
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      live_interactions: {
        Row: {
          accepted_at: string | null
          coupon_code: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          dismissed_at: string | null
          id: string
          kind: string
          message: string | null
          product_id: string | null
          seen_at: string | null
          session_key: string
          visitor_id: string
        }
        Insert: {
          accepted_at?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dismissed_at?: string | null
          id?: string
          kind: string
          message?: string | null
          product_id?: string | null
          seen_at?: string | null
          session_key: string
          visitor_id: string
        }
        Update: {
          accepted_at?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dismissed_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          product_id?: string | null
          seen_at?: string | null
          session_key?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_interactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_interactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "live_interactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      live_sessions: {
        Row: {
          browser: string | null
          cart_items: number
          cart_total: number
          connection: string | null
          current_decant_ml: number | null
          current_product_id: string | null
          current_product_name: string | null
          current_route: string | null
          current_variant: string | null
          customer_id: string | null
          declined_at: string | null
          device: string | null
          display_name: string | null
          favorites_count: number
          first_source: string | null
          identified: boolean
          in_checkout: boolean
          intent: string
          is_active: boolean
          language: string | null
          last_action: string | null
          last_activity_at: string
          last_query: string | null
          os: string | null
          phone: string | null
          session_key: string
          source: string | null
          standalone: boolean | null
          started_at: string
          theme: string | null
          timezone: string | null
          updated_at: string
          user_id: string | null
          viewport: string | null
          views_count: number
          visitor_first_seen: string | null
          visitor_id: string
          visitor_sessions: number | null
        }
        Insert: {
          browser?: string | null
          cart_items?: number
          cart_total?: number
          connection?: string | null
          current_decant_ml?: number | null
          current_product_id?: string | null
          current_product_name?: string | null
          current_route?: string | null
          current_variant?: string | null
          customer_id?: string | null
          declined_at?: string | null
          device?: string | null
          display_name?: string | null
          favorites_count?: number
          first_source?: string | null
          identified?: boolean
          in_checkout?: boolean
          intent?: string
          is_active?: boolean
          language?: string | null
          last_action?: string | null
          last_activity_at?: string
          last_query?: string | null
          os?: string | null
          phone?: string | null
          session_key: string
          source?: string | null
          standalone?: boolean | null
          started_at?: string
          theme?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
          viewport?: string | null
          views_count?: number
          visitor_first_seen?: string | null
          visitor_id: string
          visitor_sessions?: number | null
        }
        Update: {
          browser?: string | null
          cart_items?: number
          cart_total?: number
          connection?: string | null
          current_decant_ml?: number | null
          current_product_id?: string | null
          current_product_name?: string | null
          current_route?: string | null
          current_variant?: string | null
          customer_id?: string | null
          declined_at?: string | null
          device?: string | null
          display_name?: string | null
          favorites_count?: number
          first_source?: string | null
          identified?: boolean
          in_checkout?: boolean
          intent?: string
          is_active?: boolean
          language?: string | null
          last_action?: string | null
          last_activity_at?: string
          last_query?: string | null
          os?: string | null
          phone?: string | null
          session_key?: string
          source?: string | null
          standalone?: boolean | null
          started_at?: string
          theme?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
          viewport?: string | null
          views_count?: number
          visitor_first_seen?: string | null
          visitor_id?: string
          visitor_sessions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_sessions_current_product_id_fkey"
            columns: ["current_product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "live_sessions_current_product_id_fkey"
            columns: ["current_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_interests: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_name: string | null
          id: string
          item_name: string
          negotiation_item_id: string | null
          notified: boolean
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          item_name: string
          negotiation_item_id?: string | null
          notified?: boolean
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          item_name?: string
          negotiation_item_id?: string | null
          notified?: boolean
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_interests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_interests_negotiation_item_id_fkey"
            columns: ["negotiation_item_id"]
            isOneToOne: false
            referencedRelation: "negotiation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_items: {
        Row: {
          accords: Json
          brand: string | null
          condition_note: string
          created_at: string
          created_by: string | null
          description: string | null
          fragrantica_url: string | null
          id: string
          image_url: string | null
          name: string
          notes: Json
          olfactory_family: string | null
          priority: number
          product_id: string | null
          show_when_negotiating: boolean
          status: string
          updated_at: string
          volume_ml: number | null
        }
        Insert: {
          accords?: Json
          brand?: string | null
          condition_note?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fragrantica_url?: string | null
          id?: string
          image_url?: string | null
          name: string
          notes?: Json
          olfactory_family?: string | null
          priority?: number
          product_id?: string | null
          show_when_negotiating?: boolean
          status?: string
          updated_at?: string
          volume_ml?: number | null
        }
        Update: {
          accords?: Json
          brand?: string | null
          condition_note?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fragrantica_url?: string | null
          id?: string
          image_url?: string | null
          name?: string
          notes?: Json
          olfactory_family?: string | null
          priority?: number
          product_id?: string | null
          show_when_negotiating?: boolean
          status?: string
          updated_at?: string
          volume_ml?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "negotiation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      olfactory_note_assets: {
        Row: {
          canonical_note_name: string
          created_at: string
          display_name: string
          external_id: string | null
          id: string
          image_url: string | null
          source: string
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          canonical_note_name: string
          created_at?: string
          display_name: string
          external_id?: string | null
          id?: string
          image_url?: string | null
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          canonical_note_name?: string
          created_at?: string
          display_name?: string
          external_id?: string | null
          id?: string
          image_url?: string | null
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      olfactory_notes: {
        Row: {
          aliases: string[]
          canonical_name: string
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
        }
        Relationships: []
      }
      omni_audit: {
        Row: {
          action: string
          actor_id: string | null
          conversation_id: string | null
          created_at: string
          details: Json
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          conversation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          conversation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "omni_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "omni_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      omni_channels: {
        Row: {
          ai_mode: string
          automation_enabled: boolean
          connection_status: string
          external_account_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          ai_mode?: string
          automation_enabled?: boolean
          connection_status?: string
          external_account_id?: string | null
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          ai_mode?: string
          automation_enabled?: boolean
          connection_status?: string
          external_account_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      omni_conversations: {
        Row: {
          ai_active: boolean
          assigned_to: string | null
          channel_id: string
          contact_phone: string | null
          created_at: string
          crm_customer_id: string | null
          customer_name: string | null
          external_thread_id: string
          id: string
          important: boolean
          interest: string | null
          last_inbound_at: string | null
          last_message_at: string
          last_preview: string
          priority: string
          status: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          ai_active?: boolean
          assigned_to?: string | null
          channel_id: string
          contact_phone?: string | null
          created_at?: string
          crm_customer_id?: string | null
          customer_name?: string | null
          external_thread_id: string
          id?: string
          important?: boolean
          interest?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_preview?: string
          priority?: string
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          ai_active?: boolean
          assigned_to?: string | null
          channel_id?: string
          contact_phone?: string | null
          created_at?: string
          crm_customer_id?: string | null
          customer_name?: string | null
          external_thread_id?: string
          id?: string
          important?: boolean
          interest?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_preview?: string
          priority?: string
          status?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "omni_conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "omni_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      omni_knowledge: {
        Row: {
          active: boolean
          approved_by: string
          created_at: string
          guidance: string
          id: string
          revision: number
          topic: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approved_by: string
          created_at?: string
          guidance: string
          id?: string
          revision?: number
          topic: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approved_by?: string
          created_at?: string
          guidance?: string
          id?: string
          revision?: number
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      omni_knowledge_history: {
        Row: {
          active: boolean
          changed_at: string
          edited_by: string
          guidance: string
          id: string
          knowledge_id: string
          revision: number
          topic: string
        }
        Insert: {
          active: boolean
          changed_at?: string
          edited_by: string
          guidance: string
          id?: string
          knowledge_id: string
          revision: number
          topic: string
        }
        Update: {
          active?: boolean
          changed_at?: string
          edited_by?: string
          guidance?: string
          id?: string
          knowledge_id?: string
          revision?: number
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "omni_knowledge_history_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "omni_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      omni_messages: {
        Row: {
          body: string
          client_operation_id: string | null
          conversation_id: string
          created_at: string
          delivery_status: string
          direction: string
          error: string | null
          external_message_id: string | null
          id: string
          sender_id: string | null
          sender_kind: string
        }
        Insert: {
          body: string
          client_operation_id?: string | null
          conversation_id: string
          created_at?: string
          delivery_status?: string
          direction: string
          error?: string | null
          external_message_id?: string | null
          id?: string
          sender_id?: string | null
          sender_kind: string
        }
        Update: {
          body?: string
          client_operation_id?: string | null
          conversation_id?: string
          created_at?: string
          delivery_status?: string
          direction?: string
          error?: string | null
          external_message_id?: string | null
          id?: string
          sender_id?: string | null
          sender_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "omni_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "omni_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          created_at: string
          created_by: string | null
          details: Json | null
          event: string
          id: string
          order_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          event: string
          id?: string
          order_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          event?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      perfume_aliases: {
        Row: {
          alias: string
          alias_key: string
          created_at: string
          id: string
          registry_id: string
          source: string
        }
        Insert: {
          alias: string
          alias_key: string
          created_at?: string
          id?: string
          registry_id: string
          source?: string
        }
        Update: {
          alias?: string
          alias_key?: string
          created_at?: string
          id?: string
          registry_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfume_aliases_registry_id_fkey"
            columns: ["registry_id"]
            isOneToOne: false
            referencedRelation: "perfume_identity_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      perfume_hype: {
        Row: {
          brand_norm: string
          key: string
          score: number
        }
        Insert: {
          brand_norm: string
          key: string
          score: number
        }
        Update: {
          brand_norm?: string
          key?: string
          score?: number
        }
        Relationships: []
      }
      perfume_identity_registry: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          canonical_name: string
          concentration: string | null
          confidence: number
          created_at: string
          external_reference_url: string | null
          gender: string | null
          id: string
          normalized_name: string
          source: string
          sources: Json
          updated_at: string
          verified: boolean
          verified_by: string | null
          volume_ml: number | null
        }
        Insert: {
          brand_id?: string | null
          brand_name?: string | null
          canonical_name: string
          concentration?: string | null
          confidence?: number
          created_at?: string
          external_reference_url?: string | null
          gender?: string | null
          id?: string
          normalized_name: string
          source?: string
          sources?: Json
          updated_at?: string
          verified?: boolean
          verified_by?: string | null
          volume_ml?: number | null
        }
        Update: {
          brand_id?: string | null
          brand_name?: string | null
          canonical_name?: string
          concentration?: string | null
          confidence?: number
          created_at?: string
          external_reference_url?: string | null
          gender?: string | null
          id?: string
          normalized_name?: string
          source?: string
          sources?: Json
          updated_at?: string
          verified?: boolean
          verified_by?: string | null
          volume_ml?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "perfume_identity_registry_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      permanent_catalog_blocklist: {
        Row: {
          brand: string | null
          canonical_name: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          dedupe_key: string | null
          id: string
          identity_key: string | null
          normalized_name: string | null
          reason: string | null
          slug: string | null
          supplier_id: string | null
          supplier_sku: string | null
          supplier_url: string | null
        }
        Insert: {
          brand?: string | null
          canonical_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          dedupe_key?: string | null
          id?: string
          identity_key?: string | null
          normalized_name?: string | null
          reason?: string | null
          slug?: string | null
          supplier_id?: string | null
          supplier_sku?: string | null
          supplier_url?: string | null
        }
        Update: {
          brand?: string | null
          canonical_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          dedupe_key?: string | null
          id?: string
          identity_key?: string | null
          normalized_name?: string | null
          reason?: string | null
          slug?: string | null
          supplier_id?: string | null
          supplier_sku?: string | null
          supplier_url?: string | null
        }
        Relationships: []
      }
      pricing_overrides: {
        Row: {
          fixed_retail_price: number | null
          fixed_wholesale_price: number | null
          id: string
          product_id: string
          retail_markup: number | null
          wholesale_markup: number | null
        }
        Insert: {
          fixed_retail_price?: number | null
          fixed_wholesale_price?: number | null
          id?: string
          product_id: string
          retail_markup?: number | null
          wholesale_markup?: number | null
        }
        Update: {
          fixed_retail_price?: number | null
          fixed_wholesale_price?: number | null
          id?: string
          product_id?: string
          retail_markup?: number | null
          wholesale_markup?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "pricing_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          id: boolean
          pix_discount_active: boolean
          pix_discount_percent: number
          psych_max_reduction: number
          psych_pricing_active: boolean
          psych_strategy: string
          retail_markup: number
          updated_at: string
          wholesale_markup: number
          wholesale_min_quantity: number
        }
        Insert: {
          id?: boolean
          pix_discount_active?: boolean
          pix_discount_percent?: number
          psych_max_reduction?: number
          psych_pricing_active?: boolean
          psych_strategy?: string
          retail_markup?: number
          updated_at?: string
          wholesale_markup?: number
          wholesale_min_quantity?: number
        }
        Update: {
          id?: boolean
          pix_discount_active?: boolean
          pix_discount_percent?: number
          psych_max_reduction?: number
          psych_pricing_active?: boolean
          psych_strategy?: string
          retail_markup?: number
          updated_at?: string
          wholesale_markup?: number
          wholesale_min_quantity?: number
        }
        Relationships: []
      }
      product_costs: {
        Row: {
          best_cost: number | null
          best_supplier_id: string | null
          product_id: string
          updated_at: string
        }
        Insert: {
          best_cost?: number | null
          best_supplier_id?: string | null
          product_id: string
          updated_at?: string
        }
        Update: {
          best_cost?: number | null
          best_supplier_id?: string | null
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_best_supplier_id_fkey"
            columns: ["best_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_duplicates: {
        Row: {
          created_at: string
          id: string
          level: string
          product_a: string
          product_b: string
          reviewed_by: string | null
          score: number
          signals: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          product_a: string
          product_b: string
          reviewed_by?: string | null
          score?: number
          signals?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          product_a?: string
          product_b?: string
          reviewed_by?: string | null
          score?: number
          signals?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_duplicates_product_a_fkey"
            columns: ["product_a"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_duplicates_product_a_fkey"
            columns: ["product_a"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_duplicates_product_b_fkey"
            columns: ["product_b"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_duplicates_product_b_fkey"
            columns: ["product_b"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_field_provenance: {
        Row: {
          field: string
          locked: boolean
          product_id: string
          source: string
          updated_at: string
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          field: string
          locked?: boolean
          product_id: string
          source: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Update: {
          field?: string
          locked?: boolean
          product_id?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_field_provenance_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_field_provenance_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_identity_history: {
        Row: {
          action: string
          after: Json
          before: Json
          changed_by: string | null
          changed_by_email: string | null
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          action?: string
          after?: Json
          before?: Json
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          action?: string
          after?: Json
          before?: Json
          changed_by?: string | null
          changed_by_email?: string | null
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_identity_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_identity_suggestions: {
        Row: {
          confidence: number
          created_at: string
          current_brand: string | null
          current_name: string | null
          details: Json | null
          id: string
          kind: string
          product_id: string
          queries: Json
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          sources: Json
          status: string
          suggested_brand: string | null
          suggested_brand_id: string | null
          suggested_concentration: string | null
          suggested_flanker: string | null
          suggested_gender: string | null
          suggested_name: string | null
          suggested_volume_ml: number | null
          supplier_product_id: string | null
          supplier_title: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          current_brand?: string | null
          current_name?: string | null
          details?: Json | null
          id?: string
          kind?: string
          product_id: string
          queries?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          sources?: Json
          status?: string
          suggested_brand?: string | null
          suggested_brand_id?: string | null
          suggested_concentration?: string | null
          suggested_flanker?: string | null
          suggested_gender?: string | null
          suggested_name?: string | null
          suggested_volume_ml?: number | null
          supplier_product_id?: string | null
          supplier_title?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          current_brand?: string | null
          current_name?: string | null
          details?: Json | null
          id?: string
          kind?: string
          product_id?: string
          queries?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          sources?: Json
          status?: string
          suggested_brand?: string | null
          suggested_brand_id?: string | null
          suggested_concentration?: string | null
          suggested_flanker?: string | null
          suggested_gender?: string | null
          suggested_name?: string | null
          suggested_volume_ml?: number | null
          supplier_product_id?: string | null
          supplier_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_identity_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_suggestions_suggested_brand_id_fkey"
            columns: ["suggested_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identity_suggestions_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_image_cache: {
        Row: {
          card_bytes: number | null
          error: string | null
          height: number | null
          optimized_bytes: number | null
          optimized_url: string | null
          original_bytes: number | null
          processing_ms: number | null
          source_url: string
          status: string
          thumb_bytes: number | null
          updated_at: string
          width: number | null
        }
        Insert: {
          card_bytes?: number | null
          error?: string | null
          height?: number | null
          optimized_bytes?: number | null
          optimized_url?: string | null
          original_bytes?: number | null
          processing_ms?: number | null
          source_url: string
          status?: string
          thumb_bytes?: number | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          card_bytes?: number | null
          error?: string | null
          height?: number | null
          optimized_bytes?: number | null
          optimized_url?: string | null
          original_bytes?: number | null
          processing_ms?: number | null
          source_url?: string
          status?: string
          thumb_bytes?: number | null
          updated_at?: string
          width?: number | null
        }
        Relationships: []
      }
      product_matches: {
        Row: {
          created_at: string
          id: string
          match_score: number
          reviewed_by: string | null
          status: string
          supplier_product_a: string
          supplier_product_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_score: number
          reviewed_by?: string | null
          status?: string
          supplier_product_a: string
          supplier_product_b: string
        }
        Update: {
          created_at?: string
          id?: string
          match_score?: number
          reviewed_by?: string | null
          status?: string
          supplier_product_a?: string
          supplier_product_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_matches_supplier_product_a_fkey"
            columns: ["supplier_product_a"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_matches_supplier_product_b_fkey"
            columns: ["supplier_product_b"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_merges: {
        Row: {
          canonical_product_id: string
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          id: string
          identity_key: string | null
          merged_name: string | null
          merged_product_id: string
          merged_slug: string | null
          score: number
          signals: Json
        }
        Insert: {
          canonical_product_id: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          id?: string
          identity_key?: string | null
          merged_name?: string | null
          merged_product_id: string
          merged_slug?: string | null
          score?: number
          signals?: Json
        }
        Update: {
          canonical_product_id?: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          id?: string
          identity_key?: string | null
          merged_name?: string | null
          merged_product_id?: string
          merged_slug?: string | null
          score?: number
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "product_merges_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_merges_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_views: {
        Row: {
          anonymous_id: string | null
          id: string
          product_id: string
          user_id: string | null
          viewed_at: string
        }
        Insert: {
          anonymous_id?: string | null
          id?: string
          product_id: string
          user_id?: string | null
          viewed_at?: string
        }
        Update: {
          anonymous_id?: string | null
          id?: string
          product_id?: string
          user_id?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_views_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_views_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          availability_override: string
          availability_source: string | null
          base_retail_price: number | null
          base_wholesale_price: number | null
          brand: string | null
          brand_id: string | null
          brand_review_required: boolean
          canonical_identity_locked: boolean
          canonical_name: string
          catalog_eligibility_reason: string | null
          catalog_eligible: boolean
          catalog_excluded_manually: boolean
          concentration: string | null
          created_at: string
          decant_available: boolean
          decant_ml_consumed: number
          decant_price_10ml: number | null
          decant_price_2ml: number | null
          decant_price_5ml: number | null
          dedupe_key: string | null
          flanker: string | null
          full_bottle_available: boolean
          gender: string | null
          gender_confidence: number
          gender_norm: string
          height_cm: number | null
          id: string
          identity_confidence: number
          identity_key: string | null
          identity_source: string | null
          identity_status: string
          identity_verified: boolean
          identity_verified_at: string | null
          identity_verified_by: string | null
          image_manual_broken: boolean
          image_manual_set_at: string | null
          image_manual_set_by: string | null
          image_manual_url: string | null
          image_mode: string
          image_signature: string | null
          image_source_offer_id: string | null
          image_source_supplier_id: string | null
          image_url: string | null
          image_urls: Json
          in_stock: boolean
          length_cm: number | null
          local_decant_ml: number
          local_stock: number
          manual_cost: number | null
          manual_pricing: boolean
          pinned_at: string | null
          pinned_new: boolean
          price_on_request: boolean
          product_line: string | null
          product_type: string
          public_visible: boolean
          raw_name: string | null
          ready_to_deliver: boolean | null
          retail_price: number | null
          sale_mode: string
          search_aliases: string[]
          search_norm: string | null
          search_text: string | null
          slug: string
          source: string
          stock_quantity: number | null
          stock_tracked: boolean
          supplier_available: boolean
          suspicious_price: boolean
          updated_at: string
          visibility_status: string
          volume_ml: number | null
          weight_g: number | null
          wholesale_price: number | null
          width_cm: number | null
        }
        Insert: {
          active?: boolean
          availability_override?: string
          availability_source?: string | null
          base_retail_price?: number | null
          base_wholesale_price?: number | null
          brand?: string | null
          brand_id?: string | null
          brand_review_required?: boolean
          canonical_identity_locked?: boolean
          canonical_name: string
          catalog_eligibility_reason?: string | null
          catalog_eligible?: boolean
          catalog_excluded_manually?: boolean
          concentration?: string | null
          created_at?: string
          decant_available?: boolean
          decant_ml_consumed?: number
          decant_price_10ml?: number | null
          decant_price_2ml?: number | null
          decant_price_5ml?: number | null
          dedupe_key?: string | null
          flanker?: string | null
          full_bottle_available?: boolean
          gender?: string | null
          gender_confidence?: number
          gender_norm?: string
          height_cm?: number | null
          id?: string
          identity_confidence?: number
          identity_key?: string | null
          identity_source?: string | null
          identity_status?: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          image_manual_broken?: boolean
          image_manual_set_at?: string | null
          image_manual_set_by?: string | null
          image_manual_url?: string | null
          image_mode?: string
          image_signature?: string | null
          image_source_offer_id?: string | null
          image_source_supplier_id?: string | null
          image_url?: string | null
          image_urls?: Json
          in_stock?: boolean
          length_cm?: number | null
          local_decant_ml?: number
          local_stock?: number
          manual_cost?: number | null
          manual_pricing?: boolean
          pinned_at?: string | null
          pinned_new?: boolean
          price_on_request?: boolean
          product_line?: string | null
          product_type?: string
          public_visible?: boolean
          raw_name?: string | null
          ready_to_deliver?: boolean | null
          retail_price?: number | null
          sale_mode?: string
          search_aliases?: string[]
          search_norm?: string | null
          search_text?: string | null
          slug: string
          source?: string
          stock_quantity?: number | null
          stock_tracked?: boolean
          supplier_available?: boolean
          suspicious_price?: boolean
          updated_at?: string
          visibility_status?: string
          volume_ml?: number | null
          weight_g?: number | null
          wholesale_price?: number | null
          width_cm?: number | null
        }
        Update: {
          active?: boolean
          availability_override?: string
          availability_source?: string | null
          base_retail_price?: number | null
          base_wholesale_price?: number | null
          brand?: string | null
          brand_id?: string | null
          brand_review_required?: boolean
          canonical_identity_locked?: boolean
          canonical_name?: string
          catalog_eligibility_reason?: string | null
          catalog_eligible?: boolean
          catalog_excluded_manually?: boolean
          concentration?: string | null
          created_at?: string
          decant_available?: boolean
          decant_ml_consumed?: number
          decant_price_10ml?: number | null
          decant_price_2ml?: number | null
          decant_price_5ml?: number | null
          dedupe_key?: string | null
          flanker?: string | null
          full_bottle_available?: boolean
          gender?: string | null
          gender_confidence?: number
          gender_norm?: string
          height_cm?: number | null
          id?: string
          identity_confidence?: number
          identity_key?: string | null
          identity_source?: string | null
          identity_status?: string
          identity_verified?: boolean
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          image_manual_broken?: boolean
          image_manual_set_at?: string | null
          image_manual_set_by?: string | null
          image_manual_url?: string | null
          image_mode?: string
          image_signature?: string | null
          image_source_offer_id?: string | null
          image_source_supplier_id?: string | null
          image_url?: string | null
          image_urls?: Json
          in_stock?: boolean
          length_cm?: number | null
          local_decant_ml?: number
          local_stock?: number
          manual_cost?: number | null
          manual_pricing?: boolean
          pinned_at?: string | null
          pinned_new?: boolean
          price_on_request?: boolean
          product_line?: string | null
          product_type?: string
          public_visible?: boolean
          raw_name?: string | null
          ready_to_deliver?: boolean | null
          retail_price?: number | null
          sale_mode?: string
          search_aliases?: string[]
          search_norm?: string | null
          search_text?: string | null
          slug?: string
          source?: string
          stock_quantity?: number | null
          stock_tracked?: boolean
          supplier_available?: boolean
          suspicious_price?: boolean
          updated_at?: string
          visibility_status?: string
          volume_ml?: number | null
          weight_g?: number | null
          wholesale_price?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cart: Json
          created_at: string
          email: string | null
          id: string
          name: string | null
        }
        Insert: {
          cart?: Json
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
        }
        Update: {
          cart?: Json
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      promotion_impressions: {
        Row: {
          clicked: boolean
          coupon_id: string | null
          device_id: string | null
          id: string
          promotion_id: string | null
          seen_at: string
          user_id: string | null
        }
        Insert: {
          clicked?: boolean
          coupon_id?: string | null
          device_id?: string | null
          id?: string
          promotion_id?: string | null
          seen_at?: string
          user_id?: string | null
        }
        Update: {
          clicked?: boolean
          coupon_id?: string | null
          device_id?: string | null
          id?: string
          promotion_id?: string | null
          seen_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotion_impressions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_impressions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          announce: boolean
          announce_cta: string | null
          announce_footnote: string | null
          announce_message: string | null
          announce_reset_at: string | null
          announce_theme: string
          announce_title: string | null
          app_badge_label: string | null
          app_exclusive: boolean
          applies_to: string
          clicks: number
          created_at: string
          created_by: string | null
          cta_label: string | null
          decant_sizes: number[]
          discount_percent: number
          discount_total: number
          ends_at: string | null
          headline: string | null
          id: string
          name: string
          orders_count: number
          product_ids: string[]
          sales_total: number
          stackable: boolean
          starts_at: string | null
          updated_at: string
          views: number
        }
        Insert: {
          active?: boolean
          announce?: boolean
          announce_cta?: string | null
          announce_footnote?: string | null
          announce_message?: string | null
          announce_reset_at?: string | null
          announce_theme?: string
          announce_title?: string | null
          app_badge_label?: string | null
          app_exclusive?: boolean
          applies_to?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          decant_sizes?: number[]
          discount_percent: number
          discount_total?: number
          ends_at?: string | null
          headline?: string | null
          id?: string
          name: string
          orders_count?: number
          product_ids?: string[]
          sales_total?: number
          stackable?: boolean
          starts_at?: string | null
          updated_at?: string
          views?: number
        }
        Update: {
          active?: boolean
          announce?: boolean
          announce_cta?: string | null
          announce_footnote?: string | null
          announce_message?: string | null
          announce_reset_at?: string | null
          announce_theme?: string
          announce_title?: string | null
          app_badge_label?: string | null
          app_exclusive?: boolean
          applies_to?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          decant_sizes?: number[]
          discount_percent?: number
          discount_total?: number
          ends_at?: string | null
          headline?: string | null
          id?: string
          name?: string
          orders_count?: number
          product_ids?: string[]
          sales_total?: number
          stackable?: boolean
          starts_at?: string | null
          updated_at?: string
          views?: number
        }
        Relationships: []
      }
      purchase_comparisons: {
        Row: {
          applied_to_restock_at: string | null
          chosen_option: string | null
          created_at: string
          created_by: string | null
          id: string
          items: Json
          request_text: string | null
          result: Json | null
        }
        Insert: {
          applied_to_restock_at?: string | null
          chosen_option?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          request_text?: string | null
          result?: Json | null
        }
        Update: {
          applied_to_restock_at?: string | null
          chosen_option?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          request_text?: string | null
          result?: Json | null
        }
        Relationships: []
      }
      purchase_settings: {
        Row: {
          block_below_margin: boolean
          cost_per_km: number | null
          fuel_km_per_liter: number | null
          fuel_price: number | null
          id: boolean
          min_margin_pct: number | null
          origin_address: string | null
          origin_latitude: number | null
          origin_longitude: number | null
          return_to_origin: boolean
          stale_after_hours: number
          updated_at: string
        }
        Insert: {
          block_below_margin?: boolean
          cost_per_km?: number | null
          fuel_km_per_liter?: number | null
          fuel_price?: number | null
          id?: boolean
          min_margin_pct?: number | null
          origin_address?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          return_to_origin?: boolean
          stale_after_hours?: number
          updated_at?: string
        }
        Update: {
          block_below_margin?: boolean
          cost_per_km?: number | null
          fuel_km_per_liter?: number | null
          fuel_price?: number | null
          id?: boolean
          min_margin_pct?: number | null
          origin_address?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          return_to_origin?: boolean
          stale_after_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          enabled: boolean
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          revoked_at: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          enabled?: boolean
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          enabled?: boolean
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      restock_item_sources: {
        Row: {
          created_at: string
          id: string
          order_id: string
          order_item_id: string
          quantity: number
          restock_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          order_item_id: string
          quantity?: number
          restock_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          order_item_id?: string
          quantity?: number
          restock_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restock_item_sources_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_item_sources_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "catalog_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_item_sources_restock_item_id_fkey"
            columns: ["restock_item_id"]
            isOneToOne: false
            referencedRelation: "restock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_items: {
        Row: {
          comparison_id: string | null
          cost_locked: boolean
          created_at: string
          extra_fee: number
          id: string
          manual_choice: boolean
          product_id: string | null
          planned_purchase_date: string | null
          purchased_at: string | null
          quantity: number
          received_at: string | null
          restock_list_id: string
          status: string
          supplier_id: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          comparison_id?: string | null
          cost_locked?: boolean
          created_at?: string
          extra_fee?: number
          id?: string
          manual_choice?: boolean
          product_id?: string | null
          planned_purchase_date?: string | null
          purchased_at?: string | null
          quantity?: number
          received_at?: string | null
          restock_list_id: string
          status?: string
          supplier_id?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          comparison_id?: string | null
          cost_locked?: boolean
          created_at?: string
          extra_fee?: number
          id?: string
          manual_choice?: boolean
          product_id?: string | null
          planned_purchase_date?: string | null
          purchased_at?: string | null
          quantity?: number
          received_at?: string | null
          restock_list_id?: string
          status?: string
          supplier_id?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restock_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "restock_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_items_restock_list_id_fkey"
            columns: ["restock_list_id"]
            isOneToOne: false
            referencedRelation: "restock_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_lists: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipping_settings: {
        Row: {
          city: string
          district: string | null
          height_cm: number
          id: boolean
          item_weight_g: number
          last_quote_at: string | null
          last_test_at: string | null
          last_test_message: string | null
          last_test_ok: boolean | null
          length_cm: number
          local_delivery_cities: string[]
          number: string | null
          origin_cep: string | null
          package_weight_g: number
          provider: string
          receiving_cep: string | null
          state: string
          store_name: string
          street: string | null
          token_last4: string | null
          updated_at: string
          width_cm: number
        }
        Insert: {
          city?: string
          district?: string | null
          height_cm?: number
          id?: boolean
          item_weight_g?: number
          last_quote_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          length_cm?: number
          local_delivery_cities?: string[]
          number?: string | null
          origin_cep?: string | null
          package_weight_g?: number
          provider?: string
          receiving_cep?: string | null
          state?: string
          store_name?: string
          street?: string | null
          token_last4?: string | null
          updated_at?: string
          width_cm?: number
        }
        Update: {
          city?: string
          district?: string | null
          height_cm?: number
          id?: boolean
          item_weight_g?: number
          last_quote_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          length_cm?: number
          local_delivery_cities?: string[]
          number?: string | null
          origin_cep?: string | null
          package_weight_g?: number
          provider?: string
          receiving_cep?: string | null
          state?: string
          store_name?: string
          street?: string | null
          token_last4?: string | null
          updated_at?: string
          width_cm?: number
        }
        Relationships: []
      }
      shopping_carts: {
        Row: {
          abandoned_at: string | null
          anonymous_id: string | null
          converted_at: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          estimated_total: number
          id: string
          items_count: number
          last_activity_at: string
          order_id: string | null
          phone_normalized: string | null
          recovered_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          abandoned_at?: string | null
          anonymous_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          estimated_total?: number
          id?: string
          items_count?: number
          last_activity_at?: string
          order_id?: string | null
          phone_normalized?: string | null
          recovered_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          abandoned_at?: string | null
          anonymous_id?: string | null
          converted_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          estimated_total?: number
          id?: string
          items_count?: number
          last_activity_at?: string
          order_id?: string | null
          phone_normalized?: string | null
          recovered_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopping_carts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sale_events: {
        Row: {
          created_at: string
          created_by: string | null
          details: Json | null
          event: string
          id: string
          sale_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          event: string
          id?: string
          sale_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: Json | null
          event?: string
          id?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_sale_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "store_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sale_items: {
        Row: {
          brand_snapshot: string | null
          created_at: string
          decant_ml: number | null
          id: string
          image_snapshot: string | null
          ml_consumed: number
          product_id: string | null
          product_name_snapshot: string | null
          quantity: number
          sale_id: string
          subtotal: number
          unit_cost_snapshot: number | null
          unit_price: number
          variant: string
        }
        Insert: {
          brand_snapshot?: string | null
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_snapshot?: string | null
          ml_consumed?: number
          product_id?: string | null
          product_name_snapshot?: string | null
          quantity?: number
          sale_id: string
          subtotal?: number
          unit_cost_snapshot?: number | null
          unit_price?: number
          variant?: string
        }
        Update: {
          brand_snapshot?: string | null
          created_at?: string
          decant_ml?: number | null
          id?: string
          image_snapshot?: string | null
          ml_consumed?: number
          product_id?: string | null
          product_name_snapshot?: string | null
          quantity?: number
          sale_id?: string
          subtotal?: number
          unit_cost_snapshot?: number | null
          unit_price?: number
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "store_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "store_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sales: {
        Row: {
          canceled_at: string | null
          cost_complete: boolean
          cost_total: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          discount: number
          edit_seq: number
          entry_method: string
          gross_profit: number
          id: string
          idempotency_key: string | null
          payment_method: string | null
          sale_channel: string
          sale_number: string
          sold_at: string
          status: string
          subtotal: number
          total: number
          transcript: string | null
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          cost_complete?: boolean
          cost_total?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          discount?: number
          edit_seq?: number
          entry_method?: string
          gross_profit?: number
          id?: string
          idempotency_key?: string | null
          payment_method?: string | null
          sale_channel?: string
          sale_number?: string
          sold_at?: string
          status?: string
          subtotal?: number
          total?: number
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          cost_complete?: boolean
          cost_total?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          discount?: number
          edit_seq?: number
          entry_method?: string
          gross_profit?: number
          id?: string
          idempotency_key?: string | null
          payment_method?: string | null
          sale_channel?: string
          sale_number?: string
          sold_at?: string
          status?: string
          subtotal?: number
          total?: number
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_categories: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          name: string
          supplier_id: string
          url: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
          supplier_id: string
          url?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
          supplier_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_categories_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_freight_quotes: {
        Row: {
          carrier: string | null
          created_at: string
          created_by: string | null
          days: number | null
          destination_cep: string | null
          id: string
          note: string | null
          origin_cep: string | null
          price: number
          service: string | null
          source: string
          status: string
          supplier_id: string
          units: number | null
          weight_kg: number | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          days?: number | null
          destination_cep?: string | null
          id?: string
          note?: string | null
          origin_cep?: string | null
          price: number
          service?: string | null
          source: string
          status?: string
          supplier_id: string
          units?: number | null
          weight_kg?: number | null
        }
        Update: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          days?: number | null
          destination_cep?: string | null
          id?: string
          note?: string | null
          origin_cep?: string | null
          price?: number
          service?: string | null
          source?: string
          status?: string
          supplier_id?: string
          units?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_freight_quotes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_offer_catalog: {
        Row: {
          created_by: string | null
          decision: string
          supplier_id: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          created_by?: string | null
          decision: string
          supplier_id: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          created_by?: string | null
          decision?: string
          supplier_id?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_offer_catalog_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_offer_catalog_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: true
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_price_history: {
        Row: {
          id: string
          in_stock: boolean | null
          price: number | null
          recorded_at: string
          source: string
          stock_quantity: number | null
          supplier_product_id: string
        }
        Insert: {
          id?: string
          in_stock?: boolean | null
          price?: number | null
          recorded_at?: string
          source?: string
          stock_quantity?: number | null
          supplier_product_id: string
        }
        Update: {
          id?: string
          in_stock?: boolean | null
          price?: number | null
          recorded_at?: string
          source?: string
          stock_quantity?: number | null
          supplier_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_price_history_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_preferences: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mode: string
          note: string | null
          product_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mode: string
          note?: string | null
          product_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mode?: string
          note?: string | null
          product_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_preferences_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_product_preferences_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_preferences_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          active: boolean
          availability_status: string
          brand: string | null
          brand_id: string | null
          catalog_eligibility_reason: string | null
          catalog_eligible: boolean
          catalog_excluded_manually: boolean
          categories: Json
          concentration: string | null
          cost_captured_at: string | null
          cost_source: string | null
          data_hash: string | null
          ean: string | null
          first_seen_at: string
          first_seen_source: string
          id: string
          image_checked_at: string | null
          image_url: string | null
          image_urls: Json
          in_stock: boolean
          last_synced_at: string
          link_decided_by: string | null
          link_locked: boolean
          manual_lock: boolean
          missing_since: string | null
          missing_sync_count: number
          normalized_cost: number | null
          normalized_name: string | null
          offer_source: string
          previous_price: number | null
          price: number | null
          price_anomaly: boolean
          product_id: string | null
          product_type: string
          raw_data: Json | null
          raw_payload_hash: string | null
          raw_supplier_price: number | null
          source_updated_at: string | null
          stock_quantity: number | null
          stock_reliable: boolean
          supplier_id: string
          supplier_product_name: string
          supplier_promotional_price: number | null
          supplier_sku: string | null
          url: string | null
          volume_ml: number | null
        }
        Insert: {
          active?: boolean
          availability_status?: string
          brand?: string | null
          brand_id?: string | null
          catalog_eligibility_reason?: string | null
          catalog_eligible?: boolean
          catalog_excluded_manually?: boolean
          categories?: Json
          concentration?: string | null
          cost_captured_at?: string | null
          cost_source?: string | null
          data_hash?: string | null
          ean?: string | null
          first_seen_at?: string
          first_seen_source?: string
          id?: string
          image_checked_at?: string | null
          image_url?: string | null
          image_urls?: Json
          in_stock?: boolean
          last_synced_at?: string
          link_decided_by?: string | null
          link_locked?: boolean
          manual_lock?: boolean
          missing_since?: string | null
          missing_sync_count?: number
          normalized_cost?: number | null
          normalized_name?: string | null
          offer_source?: string
          previous_price?: number | null
          price?: number | null
          price_anomaly?: boolean
          product_id?: string | null
          product_type?: string
          raw_data?: Json | null
          raw_payload_hash?: string | null
          raw_supplier_price?: number | null
          source_updated_at?: string | null
          stock_quantity?: number | null
          stock_reliable?: boolean
          supplier_id: string
          supplier_product_name: string
          supplier_promotional_price?: number | null
          supplier_sku?: string | null
          url?: string | null
          volume_ml?: number | null
        }
        Update: {
          active?: boolean
          availability_status?: string
          brand?: string | null
          brand_id?: string | null
          catalog_eligibility_reason?: string | null
          catalog_eligible?: boolean
          catalog_excluded_manually?: boolean
          categories?: Json
          concentration?: string | null
          cost_captured_at?: string | null
          cost_source?: string | null
          data_hash?: string | null
          ean?: string | null
          first_seen_at?: string
          first_seen_source?: string
          id?: string
          image_checked_at?: string | null
          image_url?: string | null
          image_urls?: Json
          in_stock?: boolean
          last_synced_at?: string
          link_decided_by?: string | null
          link_locked?: boolean
          manual_lock?: boolean
          missing_since?: string | null
          missing_sync_count?: number
          normalized_cost?: number | null
          normalized_name?: string | null
          offer_source?: string
          previous_price?: number | null
          price?: number | null
          price_anomaly?: boolean
          product_id?: string | null
          product_type?: string
          raw_data?: Json | null
          raw_payload_hash?: string | null
          raw_supplier_price?: number | null
          source_updated_at?: string | null
          stock_quantity?: number | null
          stock_reliable?: boolean
          supplier_id?: string
          supplier_product_name?: string
          supplier_promotional_price?: number | null
          supplier_sku?: string | null
          url?: string | null
          volume_ml?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_raw_items: {
        Row: {
          attributes: Json | null
          created_at: string
          engine_version: string | null
          id: string
          processed_at: string | null
          raw: Json
          raw_hash: string
          supplier_id: string
          supplier_product_id: string | null
          supplier_sku: string | null
          title: string
        }
        Insert: {
          attributes?: Json | null
          created_at?: string
          engine_version?: string | null
          id?: string
          processed_at?: string | null
          raw?: Json
          raw_hash: string
          supplier_id: string
          supplier_product_id?: string | null
          supplier_sku?: string | null
          title: string
        }
        Update: {
          attributes?: Json | null
          created_at?: string
          engine_version?: string | null
          id?: string
          processed_at?: string | null
          raw?: Json
          raw_hash?: string
          supplier_id?: string
          supplier_product_id?: string | null
          supplier_sku?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_raw_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_raw_items_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_sync_changes: {
        Row: {
          created_at: string
          id: string
          kind: string
          new_price: number | null
          old_price: number | null
          product_name: string | null
          run_id: string | null
          supplier_id: string
          supplier_product_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          new_price?: number | null
          old_price?: number | null
          product_name?: string | null
          run_id?: string | null
          supplier_id: string
          supplier_product_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          new_price?: number | null
          old_price?: number | null
          product_name?: string | null
          run_id?: string | null
          supplier_id?: string
          supplier_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_sync_changes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_sync_changes_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_sync_events: {
        Row: {
          code: string | null
          counters: Json
          id: string
          level: string
          message: string
          occurred_at: string
          response_meta: Json | null
          run_id: string
          stage: string
          supplier_id: string
        }
        Insert: {
          code?: string | null
          counters?: Json
          id?: string
          level?: string
          message: string
          occurred_at?: string
          response_meta?: Json | null
          run_id: string
          stage: string
          supplier_id: string
        }
        Update: {
          code?: string | null
          counters?: Json
          id?: string
          level?: string
          message?: string
          occurred_at?: string
          response_meta?: Json | null
          run_id?: string
          stage?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_sync_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_sync_events_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_items: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          image_url: string | null
          issue_note: string | null
          issue_qty: number
          name: string
          product_id: string | null
          quantity: number
          received_qty: number | null
          resolution: string | null
          resolved_at: string | null
          restock_item_id: string | null
          result: string | null
          supplier_order_id: string
          unit_cost: number
          volume_ml: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          issue_note?: string | null
          issue_qty?: number
          name?: string
          product_id?: string | null
          quantity?: number
          received_qty?: number | null
          resolution?: string | null
          resolved_at?: string | null
          restock_item_id?: string | null
          result?: string | null
          supplier_order_id: string
          unit_cost?: number
          volume_ml?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          issue_note?: string | null
          issue_qty?: number
          name?: string
          product_id?: string | null
          quantity?: number
          received_qty?: number | null
          resolution?: string | null
          resolved_at?: string | null
          restock_item_id?: string | null
          result?: string | null
          supplier_order_id?: string
          unit_cost?: number
          volume_ml?: number | null
        }
        Relationships: []
      }
      supplier_orders: {
        Row: {
          checked_at: string | null
          created_at: string
          created_by: string | null
          id: string
          message: string | null
          sent_via: string
          seq: number
          status: string
          supplier_id: string | null
          supplier_name: string
          total: number
          units: number
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          sent_via?: string
          seq?: number
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total?: number
          units?: number
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          sent_via?: string
          seq?: number
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          total?: number
          units?: number
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          active: boolean
          adapter: string | null
          adapter_config: Json
          address: string | null
          allows_pickup: boolean
          auto_sync: boolean
          catalog_mode: string
          circuit_open_until: string | null
          city: string | null
          consecutive_sync_failures: number
          created_at: string
          creates_catalog_products: boolean
          current_sync_run_id: string | null
          declared_value: number | null
          freight_cost_affects_pricing: boolean
          freight_services: string | null
          id: string
          ingestion_stats: Json | null
          last_catalog_size: number | null
          last_health_check: Json | null
          last_health_check_at: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          latitude: number | null
          logistics_notes: string | null
          longitude: number | null
          min_margin_pct: number | null
          min_order: number | null
          name: string
          notes: string | null
          opening_hours: string | null
          operating_days: string | null
          origin_cep: string | null
          payment_discount_percent: number
          phone: string | null
          pickup_address: string | null
          pickup_schedule: string | null
          pkg_height_cm: number | null
          pkg_length_cm: number | null
          pkg_width_cm: number | null
          platform: string | null
          prep_days: number | null
          priority: string
          shipping_cost: number | null
          show_in_comparison: boolean
          slug: string
          state: string | null
          supply_mode: string
          sync_cursor: number | null
          sync_error_code: string | null
          sync_interval_minutes: number
          sync_locked_at: string | null
          sync_message: string | null
          sync_run_started_at: string | null
          sync_stage: string | null
          sync_status: string
          transit_days: number | null
          travel_cost: number | null
          unit_weight_g: number | null
          units_per_package: number | null
          update_mode: string
          use_for_availability: boolean
          use_for_pricing: boolean
          use_for_purchasing: boolean
          website: string | null
        }
        Insert: {
          active?: boolean
          adapter?: string | null
          adapter_config?: Json
          address?: string | null
          allows_pickup?: boolean
          auto_sync?: boolean
          catalog_mode?: string
          circuit_open_until?: string | null
          city?: string | null
          consecutive_sync_failures?: number
          created_at?: string
          creates_catalog_products?: boolean
          current_sync_run_id?: string | null
          declared_value?: number | null
          freight_cost_affects_pricing?: boolean
          freight_services?: string | null
          id?: string
          ingestion_stats?: Json | null
          last_catalog_size?: number | null
          last_health_check?: Json | null
          last_health_check_at?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          latitude?: number | null
          logistics_notes?: string | null
          longitude?: number | null
          min_margin_pct?: number | null
          min_order?: number | null
          name: string
          notes?: string | null
          opening_hours?: string | null
          operating_days?: string | null
          origin_cep?: string | null
          payment_discount_percent?: number
          phone?: string | null
          pickup_address?: string | null
          pickup_schedule?: string | null
          pkg_height_cm?: number | null
          pkg_length_cm?: number | null
          pkg_width_cm?: number | null
          platform?: string | null
          prep_days?: number | null
          priority?: string
          shipping_cost?: number | null
          show_in_comparison?: boolean
          slug: string
          state?: string | null
          supply_mode?: string
          sync_cursor?: number | null
          sync_error_code?: string | null
          sync_interval_minutes?: number
          sync_locked_at?: string | null
          sync_message?: string | null
          sync_run_started_at?: string | null
          sync_stage?: string | null
          sync_status?: string
          transit_days?: number | null
          travel_cost?: number | null
          unit_weight_g?: number | null
          units_per_package?: number | null
          update_mode?: string
          use_for_availability?: boolean
          use_for_pricing?: boolean
          use_for_purchasing?: boolean
          website?: string | null
        }
        Update: {
          active?: boolean
          adapter?: string | null
          adapter_config?: Json
          address?: string | null
          allows_pickup?: boolean
          auto_sync?: boolean
          catalog_mode?: string
          circuit_open_until?: string | null
          city?: string | null
          consecutive_sync_failures?: number
          created_at?: string
          creates_catalog_products?: boolean
          current_sync_run_id?: string | null
          declared_value?: number | null
          freight_cost_affects_pricing?: boolean
          freight_services?: string | null
          id?: string
          ingestion_stats?: Json | null
          last_catalog_size?: number | null
          last_health_check?: Json | null
          last_health_check_at?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          latitude?: number | null
          logistics_notes?: string | null
          longitude?: number | null
          min_margin_pct?: number | null
          min_order?: number | null
          name?: string
          notes?: string | null
          opening_hours?: string | null
          operating_days?: string | null
          origin_cep?: string | null
          payment_discount_percent?: number
          phone?: string | null
          pickup_address?: string | null
          pickup_schedule?: string | null
          pkg_height_cm?: number | null
          pkg_length_cm?: number | null
          pkg_width_cm?: number | null
          platform?: string | null
          prep_days?: number | null
          priority?: string
          shipping_cost?: number | null
          show_in_comparison?: boolean
          slug?: string
          state?: string | null
          supply_mode?: string
          sync_cursor?: number | null
          sync_error_code?: string | null
          sync_interval_minutes?: number
          sync_locked_at?: string | null
          sync_message?: string | null
          sync_run_started_at?: string | null
          sync_stage?: string | null
          sync_status?: string
          transit_days?: number | null
          travel_cost?: number | null
          unit_weight_g?: number | null
          units_per_package?: number | null
          update_mode?: string
          use_for_availability?: boolean
          use_for_pricing?: boolean
          use_for_purchasing?: boolean
          website?: string | null
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          anomalies: number
          brand_review_count: number
          catalog_incomplete: boolean
          details: Json | null
          duration_ms: number | null
          eligible_count: number
          error_code: string | null
          error_count: number
          error_message: string | null
          events: Json
          finished_at: string | null
          hidden_segment_count: number
          id: string
          ignored_products: number
          matched_products: number
          pages_fetched: number
          parsed_products: number
          products_found: number
          products_new: number
          products_processed: number
          products_unchanged: number
          products_updated: number
          products_without_image: number
          raw_products: number
          response_meta: Json | null
          review_products: number
          stage: string | null
          started_at: string
          status: string
          supplier_id: string | null
          unique_products: number
        }
        Insert: {
          anomalies?: number
          brand_review_count?: number
          catalog_incomplete?: boolean
          details?: Json | null
          duration_ms?: number | null
          eligible_count?: number
          error_code?: string | null
          error_count?: number
          error_message?: string | null
          events?: Json
          finished_at?: string | null
          hidden_segment_count?: number
          id?: string
          ignored_products?: number
          matched_products?: number
          pages_fetched?: number
          parsed_products?: number
          products_found?: number
          products_new?: number
          products_processed?: number
          products_unchanged?: number
          products_updated?: number
          products_without_image?: number
          raw_products?: number
          response_meta?: Json | null
          review_products?: number
          stage?: string | null
          started_at?: string
          status: string
          supplier_id?: string | null
          unique_products?: number
        }
        Update: {
          anomalies?: number
          brand_review_count?: number
          catalog_incomplete?: boolean
          details?: Json | null
          duration_ms?: number | null
          eligible_count?: number
          error_code?: string | null
          error_count?: number
          error_message?: string | null
          events?: Json
          finished_at?: string | null
          hidden_segment_count?: number
          id?: string
          ignored_products?: number
          matched_products?: number
          pages_fetched?: number
          parsed_products?: number
          products_found?: number
          products_new?: number
          products_processed?: number
          products_unchanged?: number
          products_updated?: number
          products_without_image?: number
          raw_products?: number
          response_meta?: Json | null
          review_products?: number
          stage?: string | null
          started_at?: string
          status?: string
          supplier_id?: string | null
          unique_products?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_match_log: {
        Row: {
          confidence: string | null
          confirmed_product_id: string | null
          corrected: boolean
          created_at: string
          id: string
          latency_ms: number | null
          sale_id: string | null
          spoken_name: string | null
          suggested_product_id: string | null
          transcript: string | null
        }
        Insert: {
          confidence?: string | null
          confirmed_product_id?: string | null
          corrected?: boolean
          created_at?: string
          id?: string
          latency_ms?: number | null
          sale_id?: string | null
          spoken_name?: string | null
          suggested_product_id?: string | null
          transcript?: string | null
        }
        Update: {
          confidence?: string | null
          confirmed_product_id?: string | null
          corrected?: boolean
          created_at?: string
          id?: string
          latency_ms?: number | null
          sale_id?: string | null
          spoken_name?: string | null
          suggested_product_id?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_match_log_confirmed_product_id_fkey"
            columns: ["confirmed_product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "voice_match_log_confirmed_product_id_fkey"
            columns: ["confirmed_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_match_log_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "store_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_match_log_suggested_product_id_fkey"
            columns: ["suggested_product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "voice_match_log_suggested_product_id_fkey"
            columns: ["suggested_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_product_aliases: {
        Row: {
          canonical_product_id: string
          confirmation_count: number
          created_at: string
          id: string
          last_used_at: string
          phonetic_key: string | null
          transcript_normalized: string
        }
        Insert: {
          canonical_product_id: string
          confirmation_count?: number
          created_at?: string
          id?: string
          last_used_at?: string
          phonetic_key?: string | null
          transcript_normalized: string
        }
        Update: {
          canonical_product_id?: string
          confirmation_count?: number
          created_at?: string
          id?: string
          last_used_at?: string
          phonetic_key?: string | null
          transcript_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_product_aliases_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "fragrance_pyramid_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "voice_product_aliases_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      fragrance_pyramid_status: {
        Row: {
          accords_count: number | null
          audit_status: string | null
          audited_at: string | null
          base_count: number | null
          confidence: number | null
          enriched_at: string | null
          fragrantica_url: string | null
          has_description: boolean | null
          heart_count: number | null
          locked: boolean | null
          match_confidence: number | null
          notes_without_image: number | null
          product_id: string | null
          status: string | null
          top_count: number | null
          verified: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_brand_delete: { Args: { p_brand_id: string }; Returns: Json }
      admin_brand_duplicates: {
        Args: { p_limit?: number }
        Returns: {
          a_id: string
          a_name: string
          a_products: number
          b_id: string
          b_name: string
          b_products: number
          reason: string
        }[]
      }
      admin_brand_list: {
        Args: { p_category?: string; p_filter?: string; p_q?: string }
        Returns: {
          aliases: string[]
          allow_perfumes: boolean
          canonical_name: string
          id: string
          other_types: string[]
          others: number
          perfumes: number
          publicos: number
          segment: string
          total: number
        }[]
      }
      admin_brand_merge: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_brand_move_products: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_brand_rename: {
        Args: { p_brand_id: string; p_name: string }
        Returns: Json
      }
      admin_dashboard:
        | { Args: { p_from: string; p_to: string }; Returns: Json }
        | {
            Args: { p_channel: string; p_from: string; p_to: string }
            Returns: Json
          }
      admin_payment_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_store_stock: { Args: never; Returns: Json }
      admin_top_viewed: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          brand: string
          canonical_name: string
          product_id: string
          slug: string
          views: number
        }[]
      }
      am_i_blocked: { Args: never; Returns: boolean }
      analytics_funnel: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      brand_key: { Args: { txt: string }; Returns: string }
      brand_near: { Args: { a: string; b: string }; Returns: boolean }
      brand_slug: { Args: { txt: string }; Returns: string }
      bulk_reprice_from_cached_costs: { Args: never; Returns: number }
      catalog_norm: { Args: { txt: string }; Returns: string }
      commercial_price: {
        Args: { p_active: boolean; p_base: number; p_max: number }
        Returns: number
      }
      compute_availability_source: {
        Args: { p_local: number; p_override: string; p_supplier: boolean }
        Returns: string
      }
      crm_cleanup_apply: {
        Args: { p_include_real?: boolean; p_scopes: string[] }
        Returns: Json
      }
      crm_cleanup_preview: { Args: { p_include_real?: boolean }; Returns: Json }
      crm_customer_delete: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      crm_customer_detail: { Args: { p_customer_id: string }; Returns: Json }
      crm_customer_journey: { Args: { p_customer_id: string }; Returns: Json }
      crm_customer_list: {
        Args: {
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_q?: string
        }
        Returns: {
          abandoned_count: number
          active_cart_items: number
          avg_ticket: number
          email: string
          favorites_count: number
          first_order_at: string
          id: string
          last_activity_at: string
          last_order_at: string
          name: string
          orders_count: number
          phone: string
          total: number
          total_spent: number
          user_id: string
          waiting_count: number
        }[]
      }
      crm_customer_pick: {
        Args: { p_limit?: number; p_q?: string }
        Returns: {
          id: string
          last_order_at: string
          name: string
          orders: number
          phone: string
          phone_normalized: string
        }[]
      }
      crm_customer_set_archived: {
        Args: { p_archived: boolean; p_customer_id: string }
        Returns: boolean
      }
      crm_customer_update: {
        Args: {
          p_customer_id: string
          p_email?: string
          p_name?: string
          p_phone?: string
        }
        Returns: string
      }
      crm_log_event: {
        Args: {
          p_customer_id: string
          p_details?: Json
          p_entity_id?: string
          p_event: string
        }
        Returns: undefined
      }
      crm_overview: { Args: never; Returns: Json }
      crm_protected_devices: {
        Args: { p_include_real: boolean }
        Returns: string[]
      }
      crm_protected_users: {
        Args: { p_include_real: boolean }
        Returns: string[]
      }
      crm_purge_customers_without_orders: { Args: never; Returns: Json }
      crm_real_customers: { Args: never; Returns: string[] }
      crm_upsert_customer: {
        Args: {
          p_device_id?: string
          p_email?: string
          p_name?: string
          p_phone?: string
          p_user_id?: string
        }
        Returns: string
      }
      decant_ml_adjust: {
        Args: {
          p_ml: number
          p_mode: string
          p_product_id: string
          p_reason?: string
        }
        Returns: Json
      }
      decant_vial_cost: { Args: { p_ml: number }; Returns: number }
      ensure_profile: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      fragrance_publicly_visible: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inventory_adjust: {
        Args: {
          p_action_id?: string
          p_mode: string
          p_product_id: string
          p_qty: number
          p_reason?: string
          p_source?: string
        }
        Returns: Json
      }
      is_staff:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      is_staff_block_guard: { Args: never; Returns: boolean }
      log_product_view: {
        Args: { p_anonymous_id?: string; p_product_id: string }
        Returns: undefined
      }
      log_search_miss: { Args: { p_query: string }; Returns: undefined }
      mark_abandoned_carts: { Args: { p_minutes?: number }; Returns: number }
      new_arrivals: {
        Args: { p_limit?: number; p_new_days?: number }
        Returns: {
          arrived_at: string
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          is_new: boolean
          product_type: string
          retail_price: number
          slug: string
          volume_ml: number
          wholesale_price: number
        }[]
      }
      new_arrivals_audit: {
        Args: { p_limit?: number }
        Returns: {
          brand: string
          first_seen_at: string
          first_seen_source: string
          in_stock: boolean
          product_id: string
          product_name: string
          supplier_added_at: string
          supplier_name: string
        }[]
      }
      norm_email: { Args: { txt: string }; Returns: string }
      norm_phone: { Args: { txt: string }; Returns: string }
      olfactory_similar: {
        Args: { p_limit?: number; p_product_id: string }
        Returns: {
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          product_type: string
          retail_price: number
          shared_accords: string[]
          similarity_score: number
          slug: string
          stock_quantity: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      omni_receive_whatsapp: {
        Args: {
          p_body: string
          p_message_id: string
          p_name: string
          p_wa_id: string
        }
        Returns: string
      }
      owner_add_admin: { Args: { _email: string }; Returns: undefined }
      owner_block_account: { Args: { _email: string }; Returns: undefined }
      owner_list_admins: {
        Args: never
        Returns: {
          active: boolean
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      owner_list_blocked: {
        Args: never
        Returns: {
          created_at: string
          email: string
        }[]
      }
      owner_remove_admin: { Args: { _email: string }; Returns: undefined }
      owner_unblock_account: { Args: { _email: string }; Returns: undefined }
      public_coupons: {
        Args: never
        Returns: {
          active: boolean
          announce: boolean
          announce_cta: string
          announce_footnote: string
          announce_message: string
          announce_reset_at: string
          announce_theme: string
          announce_title: string
          applies_to: string
          code: string
          decant_sizes: number[]
          discount_percent: number
          ends_at: string
          id: string
          product_ids: string[]
          stackable: boolean
          starts_at: string
        }[]
      }
      public_decant_combos: {
        Args: never
        Returns: {
          active: boolean
          combo_price: number
          decant_sizes: number[]
          ends_at: string
          id: string
          name: string
          quantity: number
          starts_at: string
        }[]
      }
      public_pricing_settings: {
        Args: never
        Returns: {
          pix_discount_active: boolean
          pix_discount_percent: number
          wholesale_min_quantity: number
        }[]
      }
      public_promotions: {
        Args: never
        Returns: {
          active: boolean
          announce: boolean
          announce_cta: string
          announce_footnote: string
          announce_message: string
          announce_reset_at: string
          announce_theme: string
          announce_title: string
          app_badge_label: string
          app_exclusive: boolean
          applies_to: string
          cta_label: string
          decant_sizes: number[]
          discount_percent: number
          ends_at: string
          headline: string
          id: string
          name: string
          product_ids: string[]
          stackable: boolean
          starts_at: string
        }[]
      }
      public_ready_to_deliver_ids: { Args: never; Returns: string[] }
      public_sale_modes: {
        Args: never
        Returns: {
          decant_available: boolean
          full_bottle_available: boolean
          product_id: string
          sale_mode: string
        }[]
      }
      recompute_all_pricing: { Args: never; Returns: undefined }
      recompute_product_pricing: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      search_catalog: {
        Args: {
          p_accords?: string[]
          p_availability?: string
          p_brand?: string
          p_decant?: boolean
          p_decant_ml?: number
          p_gender?: string
          p_limit?: number
          p_offset?: number
          p_only_available?: boolean
          p_price_max?: number
          p_price_min?: number
          p_q?: string
          p_sort?: string
          p_type?: string
        }
        Returns: {
          accords: string[]
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          is_new: boolean
          is_pinned: boolean
          product_type: string
          rank: number
          retail_price: number
          slug: string
          sold: number
          stock_quantity: number
          total: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      search_catalog_old: {
        Args: {
          p_accords?: string[]
          p_availability?: string
          p_brand?: string
          p_decant?: boolean
          p_decant_ml?: number
          p_gender?: string
          p_limit?: number
          p_offset?: number
          p_only_available?: boolean
          p_price_max?: number
          p_price_min?: number
          p_q?: string
          p_sort?: string
          p_type?: string
        }
        Returns: {
          accords: string[]
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          is_new: boolean
          is_pinned: boolean
          product_type: string
          rank: number
          retail_price: number
          slug: string
          sold: number
          stock_quantity: number
          total: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      search_intent: {
        Args: { p_q: string }
        Returns: {
          brand: string
          canonical_name: string
          concentration: string
          confidence: number
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          image_url: string
          in_stock: boolean
          intent: string
          line_label: string
          product_id: string
          product_type: string
          retail_price: number
          slug: string
          stock_quantity: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      set_availability_override: {
        Args: {
          p_action_id?: string
          p_override: string
          p_product_id: string
          p_reason?: string
        }
        Returns: Json
      }
      store_product_cost: { Args: { p_product_id: string }; Returns: number }
      store_sale_apply_stock: {
        Args: { p_bottles: number; p_ml: number; p_product_id: string }
        Returns: undefined
      }
      store_sale_cancel: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      store_sale_commit: { Args: { p_payload: Json }; Returns: Json }
      store_sale_delete: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      store_sale_detail: { Args: { p_id: string }; Returns: Json }
      store_sale_list: { Args: { p_from: string; p_to: string }; Returns: Json }
      store_sale_update: { Args: { p_payload: Json }; Returns: Json }
      store_stock_clear_all: { Args: { p_confirmation: string }; Returns: Json }
      store_stock_set_tracked: {
        Args: { p_product_id: string; p_tracked: boolean }
        Returns: undefined
      }
      supplier_offer_public: {
        Args: { p_decision: string; p_mode: string }
        Returns: boolean
      }
      top_sold_products: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          period_days: number
          product_type: string
          retail_price: number
          slug: string
          sold: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      top_viewed_products: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          brand: string
          canonical_name: string
          concentration: string
          decant_available: boolean
          decant_price_10ml: number
          decant_price_2ml: number
          decant_price_5ml: number
          gender_norm: string
          id: string
          image_url: string
          in_stock: boolean
          product_type: string
          retail_price: number
          slug: string
          sold: number
          views: number
          volume_ml: number
          wholesale_price: number
        }[]
      }
      voice_alias_learn: {
        Args: { p_phonetic: string; p_product_id: string; p_transcript: string }
        Returns: undefined
      }
      waiting_count: { Args: { p_product_id: string }; Returns: number }
    }
    Enums: {
      app_role: "owner" | "admin" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "client"],
    },
  },
} as const
