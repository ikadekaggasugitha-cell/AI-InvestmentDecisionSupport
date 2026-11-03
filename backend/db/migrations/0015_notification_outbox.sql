-- Migration 0015 — the notification outbox.
--
-- Brings an existing database to the `notification_outbox` table added to
-- db/schema.sql. Fresh installs get it from schema.sql; this file is for the
-- installs that already exist, and it is written to be safe to re-run, like
-- every other file in this directory.
--
-- Why a table for messages at all: approve writes `settlement` and the period it
-- bought in one transaction, and a payer who is never told they now have access
-- has paid for something they cannot see. Sending from inside that transaction
-- would hold it open across a network round trip to an SMTP server — a slow
-- provider becomes a held lock and an exhausted pool. Sending after the commit
-- loses the message if the process dies in between, and loses it silently: the
-- operator would have no way to know a message was ever owed. A row written
-- beside the settlement makes the obligation survive the crash, so the failure
-- mode changes from "nobody knows" to "there is a pending row nobody drained".
--
-- The unique key on (source_id, event, channel) is the same idea as
-- uq_transactions_midtrans_transaction_id in 0010: a replay must not mint a
-- second one of something that is supposed to have happened once. A repeated
-- approve already answers with the Subscription it first created; without this
-- key it would also queue a second welcome mail.

CREATE TABLE IF NOT EXISTS notification_outbox (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event             VARCHAR(50) NOT NULL
                          CHECK (event IN ('payment_approved', 'payment_denied')),
    channel           VARCHAR(20) NOT NULL DEFAULT 'email'
                          CHECK (channel IN ('email')),
    recipient         TEXT NOT NULL,
    subject           TEXT NOT NULL,
    body_text         TEXT NOT NULL,
    source_id         UUID,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent', 'failed')),
    attempts          INT NOT NULL DEFAULT 0,
    last_error        TEXT,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at           TIMESTAMPTZ,
    CONSTRAINT uq_notification_outbox_source UNIQUE (source_id, event, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
    ON notification_outbox (next_attempt_at)
    WHERE status = 'pending';
