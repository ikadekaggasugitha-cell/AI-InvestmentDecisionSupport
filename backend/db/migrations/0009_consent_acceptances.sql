-- Gate 2 consent, recorded server-side.
--
-- Why: `docs/legal-and-consent.md` §5 promises an audit log. It had a modal and a
-- localStorage marker and no table, so the system could not prove to anyone that a
-- given person accepted the terms at a given time. Local storage made this worse
-- than nothing in one specific way — it is per browser, so clearing site data
-- erased the only record, and the same acceptance silently applied to a second
-- account in that browser until it was made per-account.
--
-- `version` is the text version of the consent that was accepted. It is NOT a
-- status or a current flag: it records what the person was shown, so an acceptance
-- of the previous wording stays readable after the wording changes. Without it a
-- later claim of "they agreed to this" could not be checked against what was
-- actually on screen.
--
-- One row per acceptance, never updated. An update would destroy the earlier
-- record, and the point of an audit log is the earlier record.

BEGIN;

CREATE TABLE IF NOT EXISTS consent_acceptances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version     VARCHAR(32) NOT NULL,   -- text version accepted, e.g. '0.2.0-draft'
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The read path is "what has this account accepted, most recent first", which is
-- why the index leads with user_id rather than accepted_at.
CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_acceptances (user_id, accepted_at DESC);

COMMIT;