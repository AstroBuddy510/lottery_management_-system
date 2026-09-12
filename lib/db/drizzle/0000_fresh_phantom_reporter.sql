CREATE TYPE "public"."payout_request_status" AS ENUM('pending', 'approved', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('offline', 'live', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('director', 'administrator', 'cashier', 'gross_entry', 'wins_entry', 'agent', 'writer');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('announcement', 'alert', 'reminder', 'payment_received', 'wins_summary', 'deficit_alert', 'debt_query', 'change_request', 'change_request_update');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('all', 'all_agents', 'agent', 'writer', 'system');--> statement-breakpoint
CREATE TYPE "public"."token_transaction_type" AS ENUM('purchase', 'bet_deduction', 'win_credit', 'refund', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('active', 'won', 'lost', 'cancelled', 'void');--> statement-breakpoint
CREATE TYPE "public"."postpaid_settlement_status" AS ENUM('open', 'calculated', 'settled', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_status" AS ENUM('open', 'reviewed', 'dismissed', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_type" AS ENUM('frequent_combination', 'high_stakes_writer', 'suspicious_pattern', 'velocity_alert');--> statement-breakpoint
CREATE TABLE "agency_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"allowances" numeric(12, 2) DEFAULT '0' NOT NULL,
	"bonuses" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_code" varchar(2) NOT NULL,
	"full_code" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"agency_name" varchar(100),
	"location" varchar(200),
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"outstanding_debt" numeric(12, 2) DEFAULT '0' NOT NULL,
	"debt_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_agent_code_unique" UNIQUE("agent_code"),
	CONSTRAINT "agents_full_code_unique" UNIQUE("full_code")
);
--> statement-breakpoint
CREATE TABLE "writers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"writer_code" varchar(6) NOT NULL,
	"full_code" varchar(16) NOT NULL,
	"full_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"pin_hash" text,
	"id_type" varchar(30),
	"id_number" varchar(50),
	"operation_model" varchar(10) DEFAULT 'postpaid' NOT NULL,
	"registration_source" varchar(20) DEFAULT 'agent' NOT NULL,
	"approval_status" varchar(20) DEFAULT 'approved' NOT NULL,
	"approved_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writers_full_code_unique" UNIQUE("full_code"),
	CONSTRAINT "writers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "bet_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" text,
	"numbers_required" integer NOT NULL,
	"payout_multiplier" numeric(10, 2) NOT NULL,
	"is_permutation" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "daily_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_id" uuid,
	"calc_date" date NOT NULL,
	"gross_sales" numeric(12, 2) NOT NULL,
	"commission_pct" numeric(5, 4) NOT NULL,
	"commission_amount" numeric(12, 2) NOT NULL,
	"net_gross" numeric(12, 2) NOT NULL,
	"wins_amount" numeric(12, 2) NOT NULL,
	"reserve_pct" numeric(5, 4) NOT NULL,
	"reserve_amount" numeric(12, 2) NOT NULL,
	"writer_balance" numeric(12, 2) NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(100) NOT NULL,
	"profile_picture" text,
	"position" varchar(100) NOT NULL,
	"salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"allowances" numeric(12, 2) DEFAULT '0' NOT NULL,
	"bonuses" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_debt_reductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"calc_date" date NOT NULL,
	"net_gross_amount" numeric(12, 2) NOT NULL,
	"reduction_amount" numeric(12, 2) NOT NULL,
	"debt_before" numeric(12, 2) NOT NULL,
	"debt_after" numeric(12, 2) NOT NULL,
	"surplus" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gross_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_id" uuid,
	"entry_date" date NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"booklets_count" integer DEFAULT 0 NOT NULL,
	"entered_by" uuid NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"admin_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wins_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_id" uuid,
	"entry_date" date NOT NULL,
	"wins_amount" numeric(12, 2) NOT NULL,
	"entered_by" uuid NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"oversight" boolean DEFAULT false NOT NULL,
	"status" varchar(50) DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"entry_type" varchar(5) NOT NULL,
	"entry_id" uuid NOT NULL,
	"writer_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"current_amount" numeric(12, 2) NOT NULL,
	"requested_amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending_admin' NOT NULL,
	"admin_note" text,
	"reviewed_by_admin" uuid,
	"admin_reviewed_at" timestamp with time zone,
	"director_note" text,
	"reviewed_by_director" uuid,
	"director_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"recurring_expense_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payee_name" text NOT NULL,
	"authorizing_officer" text,
	"receipt_image" text,
	"cashier_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_amount" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"winning_numbers" varchar(50) NOT NULL,
	"machine_numbers" varchar(50) NOT NULL,
	"total_tickets" integer DEFAULT 0 NOT NULL,
	"total_stakes" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_winners" integer DEFAULT 0 NOT NULL,
	"total_payouts" numeric(12, 2) DEFAULT '0' NOT NULL,
	"processed_by" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sms_notifications_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_results_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"game_result_id" uuid NOT NULL,
	"writer_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"payout_amount" numeric(12, 2) NOT NULL,
	"status" "payout_request_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"day_of_week" integer NOT NULL,
	"logo_url" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_number" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"logo_url" text,
	"go_live_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" "game_status" DEFAULT 'offline' NOT NULL,
	"created_by" uuid NOT NULL,
	"winning_numbers" varchar(50),
	"machine_numbers" varchar(50),
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"close_type" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_event_number_unique" UNIQUE("event_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"email" varchar(100),
	"pin_hash" text,
	"password_hash" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"profile_picture" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cashier_time_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" smallint,
	"window_open" time NOT NULL,
	"window_close" time NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_pct" numeric(5, 4) NOT NULL,
	"agent_commission_pct" numeric(5, 4) DEFAULT '0' NOT NULL,
	"writer_commission_pct" numeric(5, 4) DEFAULT '0' NOT NULL,
	"reserve_pct" numeric(5, 4) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_date" date NOT NULL,
	"folder_color" text DEFAULT '#10b981' NOT NULL,
	"folder_view_type" text DEFAULT 'large' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_type" varchar(50) NOT NULL,
	"ticket_amount" numeric(12, 2) NOT NULL,
	"sale_date" date NOT NULL,
	"image_url" text,
	"logged_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"cashier_id" uuid,
	"transaction_type" text DEFAULT 'pay_in' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"gross_amount" numeric(12, 2),
	"amount" numeric(12, 2) NOT NULL,
	"expense_items" jsonb,
	"payment_date" date NOT NULL,
	"receipt_number" text,
	"notes" text,
	"is_voided" boolean DEFAULT false NOT NULL,
	"voided_by" uuid,
	"voided_reason" text,
	"payment_method" text DEFAULT 'manual' NOT NULL,
	"paystack_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_receipt_number_unique" UNIQUE("receipt_number"),
	CONSTRAINT "payments_paystack_reference_unique" UNIQUE("paystack_reference")
);
--> statement-breakpoint
CREATE TABLE "reserve_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"allocation_date" date NOT NULL,
	"amount_drawn" numeric(12, 2) NOT NULL,
	"reason" text,
	"reserve_balance_after" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserve_fund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_date" date NOT NULL,
	"total_contributed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_allocated" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_fund_period_date_unique" UNIQUE("period_date")
);
--> statement-breakpoint
CREATE TABLE "agent_reserve_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"calc_date" date NOT NULL,
	"amount_due" numeric(12, 2) NOT NULL,
	"amount_paid" numeric(12, 2) NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "notification_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sent_by" uuid NOT NULL,
	"message_type" "message_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_type" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"agent_id" uuid,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"base_salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"allowances" numeric(12, 2) DEFAULT '0' NOT NULL,
	"bonuses" numeric(12, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_wallet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_funded" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_disbursed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"reference_id" uuid,
	"performed_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booklet_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"allocated_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"notes" text,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booklet_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"cost_per_booklet" numeric(12, 2) NOT NULL,
	"description" text,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "padlock_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"padlock_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"destination" varchar(255) NOT NULL,
	"condition_before" varchar(50) NOT NULL,
	"condition_after" varchar(50),
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "padlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" varchar(100) NOT NULL,
	"brand_name" varchar(100) DEFAULT '' NOT NULL,
	"lock_type" varchar(50) DEFAULT 'new' NOT NULL,
	"status" varchar(50) DEFAULT 'available' NOT NULL,
	"condition" varchar(50) DEFAULT 'good' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "padlocks_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "writer_token_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"transaction_type" "token_transaction_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"reference_id" uuid,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writer_token_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_purchased" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writer_token_wallets_writer_id_unique" UNIQUE("writer_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" varchar(30) NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"bet_type_id" uuid NOT NULL,
	"numbers" varchar(30) NOT NULL,
	"stake_amount" numeric(12, 2) NOT NULL,
	"potential_payout" numeric(12, 2) NOT NULL,
	"status" "ticket_status" DEFAULT 'active' NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"win_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"token_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "postpaid_daily_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writer_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"ledger_date" date NOT NULL,
	"total_stakes" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_winnings" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"settlement_status" "postpaid_settlement_status" DEFAULT 'open' NOT NULL,
	"settlement_method" varchar(20),
	"settlement_reference" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_type" "risk_flag_type" NOT NULL,
	"writer_id" uuid,
	"agent_id" uuid,
	"game_id" uuid,
	"numbers" varchar(30),
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"total_stake_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"severity" "risk_flag_severity" NOT NULL,
	"description" text NOT NULL,
	"status" "risk_flag_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_staff" ADD CONSTRAINT "agency_staff_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writers" ADD CONSTRAINT "writers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writers" ADD CONSTRAINT "writers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_types" ADD CONSTRAINT "bet_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_calculations" ADD CONSTRAINT "daily_calculations_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_calculations" ADD CONSTRAINT "daily_calculations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_debt_reductions" ADD CONSTRAINT "agent_debt_reductions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gross_entries" ADD CONSTRAINT "gross_entries_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gross_entries" ADD CONSTRAINT "gross_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gross_entries" ADD CONSTRAINT "gross_entries_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_entries" ADD CONSTRAINT "wins_entries_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_entries" ADD CONSTRAINT "wins_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins_entries" ADD CONSTRAINT "wins_entries_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_change_requests" ADD CONSTRAINT "entry_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_change_requests" ADD CONSTRAINT "entry_change_requests_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_change_requests" ADD CONSTRAINT "entry_change_requests_reviewed_by_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_change_requests" ADD CONSTRAINT "entry_change_requests_reviewed_by_director_users_id_fk" FOREIGN KEY ("reviewed_by_director") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_game_result_id_game_results_id_fk" FOREIGN KEY ("game_result_id") REFERENCES "public"."game_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_logs" ADD CONSTRAINT "sales_logs_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_logs" ADD CONSTRAINT "sales_logs_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_allocations" ADD CONSTRAINT "reserve_allocations_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reserve_receipts" ADD CONSTRAINT "agent_reserve_receipts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reserve_receipts" ADD CONSTRAINT "agent_reserve_receipts_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_wallet_transactions" ADD CONSTRAINT "salary_wallet_transactions_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booklet_allocations" ADD CONSTRAINT "booklet_allocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booklet_allocations" ADD CONSTRAINT "booklet_allocations_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booklet_batches" ADD CONSTRAINT "booklet_batches_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "padlock_assignments" ADD CONSTRAINT "padlock_assignments_padlock_id_padlocks_id_fk" FOREIGN KEY ("padlock_id") REFERENCES "public"."padlocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "padlock_assignments" ADD CONSTRAINT "padlock_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "padlock_assignments" ADD CONSTRAINT "padlock_assignments_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_token_transactions" ADD CONSTRAINT "writer_token_transactions_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_token_transactions" ADD CONSTRAINT "writer_token_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_token_wallets" ADD CONSTRAINT "writer_token_wallets_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bet_type_id_bet_types_id_fk" FOREIGN KEY ("bet_type_id") REFERENCES "public"."bet_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_token_transaction_id_writer_token_transactions_id_fk" FOREIGN KEY ("token_transaction_id") REFERENCES "public"."writer_token_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postpaid_daily_ledger" ADD CONSTRAINT "postpaid_daily_ledger_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postpaid_daily_ledger" ADD CONSTRAINT "postpaid_daily_ledger_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_writer_id_writers_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."writers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;