-- CreateIndex
CREATE INDEX "webhook_events_payload_idx" ON "webhook_events" USING GIN ("payload" jsonb_path_ops);
