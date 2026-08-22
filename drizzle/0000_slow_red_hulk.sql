CREATE TABLE "resume_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"resume" jsonb NOT NULL,
	"job_description" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_stages" (
	"session_id" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "resume_stages_session_id_stage_pk" PRIMARY KEY("session_id","stage")
);
--> statement-breakpoint
ALTER TABLE "resume_stages" ADD CONSTRAINT "resume_stages_session_id_resume_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."resume_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_sessions_updated_at_idx" ON "resume_sessions" USING btree ("updated_at" DESC NULLS LAST);