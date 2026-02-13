ALTER TABLE "public"."tasks"
ADD COLUMN IF NOT EXISTS "calendarPrivate" BOOLEAN NOT NULL DEFAULT false;
