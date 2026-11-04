-- Migration 0016 — which destination a declared transfer says it went to.
--
-- Why: the payment screen now lists the accounts this install publishes and the
-- payer picks one of them. Until this column, "I transferred to BCA" and "I
-- transferred to BNI" were the same row to the operator matching money, because
-- the payer's choice had nowhere to go except the free-text note. An operator
-- reconciling two pending declarations of the same amount for the same plan had
-- nothing to tell them apart.
--
-- What is stored is a snapshot, not a reference: `CIMB Niaga 5012345678901 a.n.
-- PT AIDSS`, composed by the server from the destination list as it stood at the
-- moment of declaration. A reference would resolve through today's list when the
-- queue read it, and an account the operator later edits, hides, or retires would
-- silently rewrite what the payer claimed. The row has to keep saying the thing
-- that was true when the money moved.
--
-- It is nullable and stays nullable. Rows written before this migration exist,
-- and a gateway settlement has no destination because the gateway chose the
-- method, not the payer. Nothing is backfilled: an old row's silence is the
-- truthful answer about what was recorded then.
--
-- The length bound is generous because the value is composed from fields the
-- destination form already bounds (bank name, digits-only number, holder name),
-- and a ceiling exists so a row cannot outgrow the queue's rendering of it — not
-- because any real destination is anywhere near this long.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS destination VARCHAR(240);

ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS ck_transactions_destination_length;

ALTER TABLE transactions
    ADD CONSTRAINT ck_transactions_destination_length
        CHECK (destination IS NULL OR char_length(destination) <= 240);
