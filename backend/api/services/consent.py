"""
Gate 2 consent, recorded server-side.

The modal in `src/app/components/ConsentGate.tsx` writes a localStorage marker, and
that marker is still what the browser consults. This module is the other half: the
same acceptance, in the database, where it survives the browser being cleared and
where it can be produced to anyone who has to be told who accepted what and when.

The split is deliberate and worth stating, because "why are there two?" is the
obvious question:

  * localStorage answers "should this browser show the modal again?" — fast, offline,
    and correct for the question.
  * This answers "can we evidence that this person accepted version X on this date?"
    — which localStorage can never do, because it is one browser's memory and a user
    can erase it.

Neither replaces the other. Reading only the database would show the modal on every
load while offline; reading only localStorage would make the legal document's audit
log a fiction.

Not part of Fase 1's original scope — `docs/status.md` lists the server-side audit log
as the outstanding half of Gate 2. This is that half.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException, status

from api.core.db import get_pool

logger = logging.getLogger(__name__)

# The wording the modal currently shows. Bump this when the text changes, and the
# old rows stay readable as a record of what was accepted at the time.
#
# It tracks `docs/legal-and-consent.md`'s document version, which is deliberately
# still a draft: an acceptance of a draft is a real event, it is just not a
# commitment, and recording it as one would overstate the document's status.
CURRENT_CONSENT_VERSION = "0.2.0-draft"


@dataclass(frozen=True)
class Acceptance:
    version: str
    accepted_at: datetime


async def record_acceptance(
    user_id: uuid.UUID, version: str = CURRENT_CONSENT_VERSION
) -> Acceptance:
    """Record that `user_id` accepted `version`. Returns the stored row.

    One row per acceptance, appended and never updated: an update would erase the
    earlier record, and the earlier record is the part that has evidentiary value.

    The account is always read from the authenticated caller, never from the request
    body. A body that could name another account would turn "record my consent" into
    "write a consent record against somebody I do not own".

    Raises:
        HTTPException 503 — the database is unreachable. Failing closed here is a
            judgement call, and it is the conservative one: the alternative is
            showing the modal as accepted to someone whose acceptance was lost, which
            is worse than asking twice.
    """
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            INSERT INTO consent_acceptances (user_id, version)
            VALUES ($1, $2)
            RETURNING version, accepted_at
            """,
            str(user_id),
            version,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("consent: cannot record acceptance for %s — %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot record your consent right now.",
        ) from exc

    logger.info("consent: recorded version=%s for %s", version, user_id)
    return Acceptance(version=row["version"], accepted_at=row["accepted_at"])


async def latest_acceptance(user_id: uuid.UUID) -> Acceptance | None:
    """The most recent acceptance, or None if there has never been one.

    None and a row are different answers and the difference is the whole point: None
    means "we cannot show you have accepted anything", which is what a fresh account
    and a failed write both look like from the outside.
    """
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            SELECT version, accepted_at
            FROM consent_acceptances
            WHERE user_id = $1
            ORDER BY accepted_at DESC
            LIMIT 1
            """,
            str(user_id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("consent: cannot read acceptances for %s — %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot read your consent history right now.",
        ) from exc

    if row is None:
        return None
    return Acceptance(version=row["version"], accepted_at=row["accepted_at"])


async def has_current_acceptance(user_id: uuid.UUID) -> bool:
    """True when this account has accepted the wording that is current now.

    Checking the version and not merely the existence is what makes a consent gate
    meaningful: if the text changes, the people who accepted the old text have not
    accepted the new one, and treating them as though they had would make the whole
    record decorative.
    """
    latest = await latest_acceptance(user_id)
    return latest is not None and latest.version == CURRENT_CONSENT_VERSION