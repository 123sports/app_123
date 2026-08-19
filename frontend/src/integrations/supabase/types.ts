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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      blocked_slots: {
        Row: {
          block_date: string
          blocked_by: string
          created_at: string
          id: string
          professor_id: string | null
          reason: string | null
          start_hour: number
          updated_at: string
        }
        Insert: {
          block_date: string
          blocked_by: string
          created_at?: string
          id?: string
          professor_id?: string | null
          reason?: string | null
          start_hour: number
          updated_at?: string
        }
        Update: {
          block_date?: string
          blocked_by?: string
          created_at?: string
          id?: string
          professor_id?: string | null
          reason?: string | null
          start_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      booking_participants: {
        Row: {
          added_by: string | null
          booking_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          booking_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          amount_cents: number | null
          attended: boolean | null
          booking_date: string
          card_operator_id: string | null
          checkout_order_id: string | null
          confirmed_at: string | null
          created_at: string
          duration_hours: number
          hold_expires_at: string | null
          id: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          price_cents: number | null
          professor_id: string | null
          start_hour: number
          status: Database["public"]["Enums"]["booking_status"]
          type: Database["public"]["Enums"]["booking_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          attended?: boolean | null
          booking_date: string
          card_operator_id?: string | null
          checkout_order_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_hours?: number
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          price_cents?: number | null
          professor_id?: string | null
          start_hour: number
          status?: Database["public"]["Enums"]["booking_status"]
          type: Database["public"]["Enums"]["booking_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          attended?: boolean | null
          booking_date?: string
          card_operator_id?: string | null
          checkout_order_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_hours?: number
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          price_cents?: number | null
          professor_id?: string | null
          start_hour?: number
          status?: Database["public"]["Enums"]["booking_status"]
          type?: Database["public"]["Enums"]["booking_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_checkout_order_id_fkey"
            columns: ["checkout_order_id"]
            isOneToOne: false
            referencedRelation: "checkout_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      card_operators: {
        Row: {
          active: boolean
          created_at: string
          fee_percent: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          fee_percent?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          fee_percent?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      certificates: {
        Row: {
          average_score: number
          awarded_at: string
          code: string
          evaluations_count: number
          id: string
          level_id: string
          student_id: string
        }
        Insert: {
          average_score: number
          awarded_at?: string
          code?: string
          evaluations_count: number
          id?: string
          level_id: string
          student_id: string
        }
        Update: {
          average_score?: number
          awarded_at?: string
          code?: string
          evaluations_count?: number
          id?: string
          level_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "student_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_items: {
        Row: {
          checkout_order_id: string
          created_at: string
          description: string
          id: string
          item_type: string
          metadata: Json
          quantity: number
          reference_id: string | null
          total_amount_cents: number
          unit_amount_cents: number
        }
        Insert: {
          checkout_order_id: string
          created_at?: string
          description: string
          id?: string
          item_type: string
          metadata?: Json
          quantity?: number
          reference_id?: string | null
          total_amount_cents: number
          unit_amount_cents: number
        }
        Update: {
          checkout_order_id?: string
          created_at?: string
          description?: string
          id?: string
          item_type?: string
          metadata?: Json
          quantity?: number
          reference_id?: string | null
          total_amount_cents?: number
          unit_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "checkout_items_checkout_order_id_fkey"
            columns: ["checkout_order_id"]
            isOneToOne: false
            referencedRelation: "checkout_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_orders: {
        Row: {
          amount_cents: number
          cancelled_at: string | null
          created_at: string
          currency: string
          description: string
          expires_at: string | null
          id: string
          idempotency_key: string
          kind: string
          metadata: Json
          paid_at: string | null
          provider: string
          refunded_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          description: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          kind: string
          metadata?: Json
          paid_at?: string | null
          provider?: string
          refunded_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          description?: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          metadata?: Json
          paid_at?: string | null
          provider?: string
          refunded_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      class_contracts: {
        Row: {
          agreed_price_cents: number
          created_at: string
          document_hash: string
          ends_on: string
          id: string
          list_price_cents: number
          notes: string | null
          plan_id: string
          snapshot: Json
          starts_on: string
          status: Database["public"]["Enums"]["contract_status"]
          student_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          agreed_price_cents: number
          created_at?: string
          document_hash: string
          ends_on: string
          id?: string
          list_price_cents: number
          notes?: string | null
          plan_id: string
          snapshot?: Json
          starts_on: string
          status?: Database["public"]["Enums"]["contract_status"]
          student_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          agreed_price_cents?: number
          created_at?: string
          document_hash?: string
          ends_on?: string
          id?: string
          list_price_cents?: number
          notes?: string | null
          plan_id?: string
          snapshot?: Json
          starts_on?: string
          status?: Database["public"]["Enums"]["contract_status"]
          student_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_contracts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "class_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      class_plans: {
        Row: {
          active: boolean
          class_duration_min: number
          created_at: string
          description: string | null
          duration_months: number
          frequency_per_week: number
          id: string
          modality: string
          price_cents: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          class_duration_min?: number
          created_at?: string
          description?: string | null
          duration_months: number
          frequency_per_week: number
          id?: string
          modality?: string
          price_cents: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          class_duration_min?: number
          created_at?: string
          description?: string | null
          duration_months?: number
          frequency_per_week?: number
          id?: string
          modality?: string
          price_cents?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_applications: {
        Row: {
          city: string | null
          created_at: string
          cv_path: string | null
          email: string
          id: string
          message: string | null
          name: string
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          cv_path?: string | null
          email: string
          id?: string
          message?: string | null
          name: string
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          cv_path?: string | null
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_profiles: {
        Row: {
          active: boolean
          address: string | null
          cpf_cnpj: string | null
          created_at: string
          display_name: string
          email: string | null
          is_default: boolean
          phone: string | null
          updated_at: string
          user_id: string
          venue_address: string | null
          venue_name: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          is_default?: boolean
          phone?: string | null
          updated_at?: string
          user_id: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          is_default?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Relationships: []
      }
      contract_negotiations: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          note: string | null
          outcome: string | null
          price_cents: number
          proposed_by: Database["public"]["Enums"]["contract_signer"]
          proposer_id: string
          resolved_at: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          note?: string | null
          outcome?: string | null
          price_cents: number
          proposed_by: Database["public"]["Enums"]["contract_signer"]
          proposer_id: string
          resolved_at?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          note?: string | null
          outcome?: string | null
          price_cents?: number
          proposed_by?: Database["public"]["Enums"]["contract_signer"]
          proposer_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_negotiations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "class_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_settings: {
        Row: {
          cancel_window: string
          created_at: string
          day_due: string
          foro_city: string
          foro_state: string
          id: boolean
          late_fee_pct: number
          late_interest_pct: number
          payment_method: string
          reposition_window: string
          suspension_days: number
          updated_at: string
        }
        Insert: {
          cancel_window?: string
          created_at?: string
          day_due?: string
          foro_city?: string
          foro_state?: string
          id?: boolean
          late_fee_pct?: number
          late_interest_pct?: number
          payment_method?: string
          reposition_window?: string
          suspension_days?: number
          updated_at?: string
        }
        Update: {
          cancel_window?: string
          created_at?: string
          day_due?: string
          foro_city?: string
          foro_state?: string
          id?: boolean
          late_fee_pct?: number
          late_interest_pct?: number
          payment_method?: string
          reposition_window?: string
          suspension_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      contract_signatures: {
        Row: {
          accepted_at: string
          contract_id: string
          document_hash: string
          id: string
          ip: string | null
          signer_id: string
          signer_type: Database["public"]["Enums"]["contract_signer"]
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          contract_id: string
          document_hash: string
          id?: string
          ip?: string | null
          signer_id: string
          signer_type: Database["public"]["Enums"]["contract_signer"]
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          contract_id?: string
          document_hash?: string
          id?: string
          ip?: string | null
          signer_id?: string
          signer_type?: Database["public"]["Enums"]["contract_signer"]
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "class_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          active: boolean
          body_md: string
          created_at: string
          id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          body_md: string
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          active?: boolean
          body_md?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      costs: {
        Row: {
          amount_cents: number
          category: string | null
          created_at: string
          description: string
          id: string
          incurred_on: string
          recurrence: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          category?: string | null
          created_at?: string
          description: string
          id?: string
          incurred_on?: string
          recurrence?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          incurred_on?: string
          recurrence?: string
          updated_at?: string
        }
        Relationships: []
      }
      gamification_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          notes: string | null
          points: number
          ref_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          notes?: string | null
          points: number
          ref_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          notes?: string | null
          points?: number
          ref_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gamification_rules: {
        Row: {
          active: boolean
          created_at: string
          event_type: string
          id: string
          label: string
          points: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_type: string
          id?: string
          label: string
          points?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_type?: string
          id?: string
          label?: string
          points?: number
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          city: string | null
          created_at: string
          handled_by: string | null
          id: string
          message: string | null
          name: string
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          handled_by?: string | null
          id?: string
          message?: string | null
          name: string
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          handled_by?: string | null
          id?: string
          message?: string | null
          name?: string
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_items: {
        Row: {
          active: boolean
          category: string | null
          condition: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          image_path: string | null
          price_cents: number
          stock_quantity: number | null
          title: string
          track_stock: boolean
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          condition?: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          image_path?: string | null
          price_cents?: number
          stock_quantity?: number | null
          title: string
          track_stock?: boolean
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          category?: string | null
          condition?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          image_path?: string | null
          price_cents?: number
          stock_quantity?: number | null
          title?: string
          track_stock?: boolean
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      match_draws: {
        Row: {
          created_at: string
          drawn_by: string | null
          id: string
          source_id: string
          source_type: string
          teams: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          drawn_by?: string | null
          id?: string
          source_id: string
          source_type: string
          teams: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          drawn_by?: string | null
          id?: string
          source_id?: string
          source_type?: string
          teams?: Json
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read: boolean
          related_booking_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read?: boolean
          related_booking_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read?: boolean
          related_booking_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      open_match_participants: {
        Row: {
          created_at: string
          id: string
          match_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "open_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      open_matches: {
        Row: {
          admin_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancelled_reason: string | null
          created_at: string
          creator_id: string
          duration_hours: number
          id: string
          match_date: string
          max_players: number
          notes: string | null
          skill_level: string | null
          start_hour: number
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          creator_id: string
          duration_hours?: number
          id?: string
          match_date: string
          max_players?: number
          notes?: string | null
          skill_level?: string | null
          start_hour: number
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          creator_id?: string
          duration_hours?: number
          id?: string
          match_date?: string
          max_players?: number
          notes?: string | null
          skill_level?: string | null
          start_hour?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_attempts: {
        Row: {
          amount_cents: number
          checkout_order_id: string
          created_at: string
          expires_at: string | null
          id: string
          paid_at: string | null
          payment_method: string
          provider: string
          provider_order_id: string | null
          provider_payload: Json
          provider_payment_id: string | null
          qr_code: string | null
          qr_code_base64: string | null
          status: string
          ticket_url: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          checkout_order_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method: string
          provider: string
          provider_order_id?: string | null
          provider_payload?: Json
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          status?: string
          ticket_url?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          checkout_order_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string
          provider?: string
          provider_order_id?: string | null
          provider_payload?: Json
          provider_payment_id?: string | null
          qr_code?: string | null
          qr_code_base64?: string | null
          status?: string
          ticket_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_checkout_order_id_fkey"
            columns: ["checkout_order_id"]
            isOneToOne: false
            referencedRelation: "checkout_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          payment_attempt_id: string | null
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          signature_valid: boolean
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          payment_attempt_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_event_id: string
          signature_valid?: boolean
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          payment_attempt_id?: string | null
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_terms: {
        Row: {
          active: boolean
          content: string
          created_at: string
          id: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          active?: boolean
          content: string
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          active?: boolean
          content?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      pricing: {
        Row: {
          active: boolean
          booking_type: Database["public"]["Enums"]["booking_type"]
          created_at: string
          id: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          booking_type: Database["public"]["Enums"]["booking_type"]
          created_at?: string
          id?: string
          price_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          booking_type?: Database["public"]["Enums"]["booking_type"]
          created_at?: string
          id?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      professor_feedback: {
        Row: {
          approved_admin: boolean
          approved_professor: boolean
          comment: string | null
          created_at: string
          featured: boolean
          id: string
          is_anonymous: boolean
          professor_id: string
          public_consent: boolean
          rating: number
          student_id: string | null
          updated_at: string
        }
        Insert: {
          approved_admin?: boolean
          approved_professor?: boolean
          comment?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          is_anonymous?: boolean
          professor_id: string
          public_consent?: boolean
          rating: number
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_admin?: boolean
          approved_professor?: boolean
          comment?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          is_anonymous?: boolean
          professor_id?: string
          public_consent?: boolean
          rating?: number
          student_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aces: number
          address: string | null
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          blood_type: string | null
          cpf: string | null
          created_at: string
          dominant_hand: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string | null
          games_won: number
          guardian_cpf: string | null
          guardian_email: string | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          medical_notes: string | null
          phone: string | null
          referral_code: string | null
          referred_by: string | null
          skill_level: string | null
          updated_at: string
          years_playing: number | null
        }
        Insert: {
          aces?: number
          address?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          blood_type?: string | null
          cpf?: string | null
          created_at?: string
          dominant_hand?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string | null
          games_won?: number
          guardian_cpf?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id: string
          medical_notes?: string | null
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          skill_level?: string | null
          updated_at?: string
          years_playing?: number | null
        }
        Update: {
          aces?: number
          address?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          blood_type?: string | null
          cpf?: string | null
          created_at?: string
          dominant_hand?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string | null
          games_won?: number
          guardian_cpf?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          medical_notes?: string | null
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          skill_level?: string | null
          updated_at?: string
          years_playing?: number | null
        }
        Relationships: []
      }
      referral_rewards: {
        Row: {
          active: boolean
          created_at: string
          discount_percent: number
          id: string
          label: string
          min_referrals: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          discount_percent: number
          id?: string
          label: string
          min_referrals: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          discount_percent?: number
          id?: string
          label?: string
          min_referrals?: number
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_evaluations: {
        Row: {
          booking_id: string | null
          created_at: string
          evaluation_date: string
          highlights: string | null
          id: string
          improvements: string | null
          overall_score: number | null
          professor_id: string
          score_backhand: number
          score_fitness: number
          score_forehand: number
          score_mental: number
          score_serve: number
          score_volley: number
          student_id: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          evaluation_date?: string
          highlights?: string | null
          id?: string
          improvements?: string | null
          overall_score?: number | null
          professor_id: string
          score_backhand?: number
          score_fitness?: number
          score_forehand?: number
          score_mental?: number
          score_serve?: number
          score_volley?: number
          student_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          evaluation_date?: string
          highlights?: string | null
          id?: string
          improvements?: string | null
          overall_score?: number | null
          professor_id?: string
          score_backhand?: number
          score_fitness?: number
          score_forehand?: number
          score_mental?: number
          score_serve?: number
          score_volley?: number
          student_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_levels: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          min_score: number
          name: string
          rank_order: number
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          min_score: number
          name: string
          rank_order: number
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          min_score?: number
          name?: string
          rank_order?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
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
      user_terms_acceptance: {
        Row: {
          accepted_at: string
          id: string
          terms_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          terms_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          terms_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_terms_acceptance_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "platform_terms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bookings_occupancy: {
        Row: {
          booking_date: string | null
          checkout_order_id: string | null
          hold_expires_at: string | null
          id: string | null
          payment_status: string | null
          professor_id: string | null
          start_hour: number | null
          status: Database["public"]["Enums"]["booking_status"] | null
          type: Database["public"]["Enums"]["booking_type"] | null
          user_id: string | null
        }
        Insert: {
          booking_date?: string | null
          checkout_order_id?: never
          hold_expires_at?: never
          id?: never
          payment_status?: never
          professor_id?: never
          start_hour?: number | null
          status?: Database["public"]["Enums"]["booking_status"] | null
          type?: Database["public"]["Enums"]["booking_type"] | null
          user_id?: never
        }
        Update: {
          booking_date?: string | null
          checkout_order_id?: never
          hold_expires_at?: never
          id?: never
          payment_status?: never
          professor_id?: never
          start_hour?: number | null
          status?: Database["public"]["Enums"]["booking_status"] | null
          type?: Database["public"]["Enums"]["booking_type"] | null
          user_id?: never
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          aces: number | null
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          dominant_hand: string | null
          full_name: string | null
          games_won: number | null
          id: string | null
          skill_level: string | null
          years_playing: number | null
        }
        Insert: {
          aces?: number | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          dominant_hand?: string | null
          full_name?: string | null
          games_won?: number | null
          id?: string | null
          skill_level?: string | null
          years_playing?: number | null
        }
        Update: {
          aces?: number | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          dominant_hand?: string | null
          full_name?: string | null
          games_won?: number | null
          id?: string | null
          skill_level?: string | null
          years_playing?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_staff_invite: {
        Args: { _token: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      approve_local_booking_checkout: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: undefined
      }
      cancel_booking_checkout: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: undefined
      }
      cleanup_expired_booking_holds: { Args: never; Returns: number }
      create_booking_checkout_hold: {
        Args: {
          p_booking_date: string
          p_booking_type: Database["public"]["Enums"]["booking_type"]
          p_hours: number[]
          p_professor_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      generate_referral_code: { Args: never; Returns: string }
      get_default_coach_profile: {
        Args: never
        Returns: {
          active: boolean
          display_name: string
          is_default: boolean
          venue_address: string
          venue_name: string
        }[]
      }
      get_my_referred_people: {
        Args: never
        Returns: {
          created_at: string
          full_name: string
          id: string
        }[]
      }
      get_players_stats: {
        Args: { _user_ids: string[] }
        Returns: {
          certificates_count: number
          level_color: string
          level_name: string
          level_slug: string
          matches_played: number
          user_id: string
        }[]
      }
      get_referral_status: {
        Args: { _user_id: string }
        Returns: {
          current_discount: number
          next_tier_at: number
          next_tier_discount: number
          total_referrals: number
        }[]
      }
      get_staff_invite_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          expires_at: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }[]
      }
      get_student_for_professor: {
        Args: { _student_id: string }
        Returns: Json
      }
      get_student_level: {
        Args: { _student_id: string }
        Returns: {
          avg_score: number
          color: string
          evals: number
          level_id: string
          name: string
          slug: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_booking_owner: {
        Args: { _booking_id: string; _user_id: string }
        Returns: boolean
      }
      is_booking_participant: {
        Args: { _booking_id: string; _user_id: string }
        Returns: boolean
      }
      is_master_admin: { Args: { _user_id: string }; Returns: boolean }
      is_open_match_creator: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      is_open_match_participant: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      list_active_professors: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          id: string
        }[]
      }
      list_students_for_staff: {
        Args: never
        Returns: {
          attended: number
          birth_date: string
          bookings: number
          full_name: string
          id: string
          missed: number
          phone: string
          skill_level: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "professor" | "aluno"
      booking_status: "pendente" | "confirmada" | "cancelada" | "concluida"
      booking_type:
        | "quadra_livre"
        | "aula_individual"
        | "aula_dupla"
        | "aula_trio"
        | "aula_quarteto"
        | "teste"
      contract_signer: "aluno" | "admin"
      contract_status:
        | "rascunho"
        | "proposta_aluno"
        | "proposta_admin"
        | "aguardando_aluno"
        | "aguardando_admin"
        | "vigente"
        | "recusado"
        | "encerrado"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "professor", "aluno"],
      booking_status: ["pendente", "confirmada", "cancelada", "concluida"],
      booking_type: [
        "quadra_livre",
        "aula_individual",
        "aula_dupla",
        "aula_trio",
        "aula_quarteto",
        "teste",
      ],
      contract_signer: ["aluno", "admin"],
      contract_status: [
        "rascunho",
        "proposta_aluno",
        "proposta_admin",
        "aguardando_aluno",
        "aguardando_admin",
        "vigente",
        "recusado",
        "encerrado",
      ],
    },
  },
} as const
