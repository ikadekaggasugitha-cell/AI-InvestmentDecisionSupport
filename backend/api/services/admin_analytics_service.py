"""
The operator's overview: what the money did, and how many people hold access.

Every number here is one aggregate over a column that already exists. That is the
whole design. A dashboard is the easiest place in this product to invent a fact,
because a figure on a screen looks like a measurement even when nothing was
measured — so each field below names the column it comes from and the predicate
that selects it, and nothing is smoothed, projected, or annualised beyond the one
figure that says so on its own label.

Two decisions that are not obvious from the SQL:

  * **Revenue is dated by `approved_at`, on `settlement` rows only.** A declared
    transfer that nobody has judged is not revenue, and an `expire`d one is still
    money someone sent but has not become access yet. `approved_at` is written by
    both paths that settle a row — the operator's approve and the gateway's
    callback — so it is the one timestamp comparable across them.
  * **"Today" is a WIB calendar day, not a UTC one.** `approved_at` is a
    timestamptz, and comparing it to a UTC midnight would let the figure change
    meaning at 23:00 Jakarta time without anything happening. The product already
    runs its beat schedule and its public clock in Asia/Jakarta; a money number
    on a Jakarta business's console is measured on the same day.

Raw SQL, per ADR-0001.
"""

import logging
from dataclasses import dataclass

from api.core.db import get_pool
from api.services.payment_service.core import PLAN_DAYS

logger = logging.getLogger(__name__)


def _plan_days_sql() -> str:
    """The MRR denominators, built from `PLAN_DAYS` rather than retyped.

    This is the one place where a payment's period is turned into a monthly
    figure, and it has to use the same numbers the approval path uses to grant
    that period. Typed-out literals here would be a second copy that could go
    quietly wrong: the revenue total would still look right while the run-rate
    beside it drifted.

    The `ELSE` is unreachable through the schema (`plan` carries a CHECK over the
    same three names) and is 30.0 rather than NULL so that a row the constraint
    somehow let through is counted at the default period instead of vanishing
    from the sum.
    """
    whens = " ".join(f"WHEN '{name}' THEN {days}.0" for name, days in PLAN_DAYS.items())
    return f"CASE t.plan {whens} ELSE 30.0 END"


_PLAN_DAYS_SQL = _plan_days_sql()

_OVERVIEW_SQL = f"""
    SELECT
      -- Rupiah settled on the current WIB calendar day.
      COALESCE(
        SUM(t.amount) FILTER (
          WHERE t.status = 'settlement'
            AND t.approved_at IS NOT NULL
            AND (t.approved_at AT TIME ZONE 'Asia/Jakarta')::date
                = (now()      AT TIME ZONE 'Asia/Jakarta')::date
        ), 0
      )::bigint                                          AS revenue_today,

      -- And over a rolling thirty days, not thirty WIB midnights: the window is
      -- labelled "30 hari terakhir" on screen, which is what this is.
      COALESCE(
        SUM(t.amount) FILTER (
          WHERE t.status = 'settlement'
            AND t.approved_at >= now() - interval '30 days'
        ), 0
      )::bigint                                          AS revenue_last_30_days,

      COALESCE(
        SUM(t.amount) FILTER (WHERE t.status = 'settlement'), 0
      )::bigint                                          AS revenue_total,

      -- A run-rate, not money received: each settled payment is normalised to
      -- what it would carry over a thirty-day month, using the product's own
      -- period lengths. The screen prints the formula beside the number, because
      -- a figure labelled MRR invites a reader to treat it as a balance.
      COALESCE(
        ROUND(
          SUM(
            t.amount * 30.0 / {_PLAN_DAYS_SQL}
          ) FILTER (
            WHERE t.status = 'settlement'
              AND t.approved_at >= now() - interval '30 days'
          ),
          0
        ), 0
      )::bigint                                          AS mrr_run_rate,

      COUNT(*) FILTER (
        WHERE t.status = 'settlement'
          AND t.approved_at >= now() - interval '30 days'
      )                                                  AS settled_last_30_days,

      COUNT(*) FILTER (WHERE t.status = 'pending')      AS pending_queue,

      -- Reported apart from `pending` on purpose. The queue's own endpoint says
      -- an expired row is still money and stays approvable; folding the two
      -- counts together would tell an operator the backlog had been resolved.
      COUNT(*) FILTER (WHERE t.status = 'expire')       AS expired_queue,

      (SELECT COUNT(DISTINCT s.user_id)
         FROM subscriptions s
        WHERE s.expires_at > now())                      AS active_subscribers,

      -- Accounts that once held a period and now hold none still running. This
      -- is deliberately the same predicate `suspend_lapsed_accounts` in
      -- account_service.py uses to decide which accounts to suspend: two answers
      -- to "who has lapsed" would drift, and one of them would be wrong.
      (SELECT COUNT(*)
         FROM (
               SELECT x.user_id
                 FROM subscriptions x
                GROUP BY x.user_id
               HAVING max(x.expires_at) <= now()
              ) lapsed)                                  AS churned_subscribers
      FROM transactions t
"""


@dataclass(frozen=True)
class AdminOverview:
    """The console's figures, all of them counts or sums over real columns.

    Money is whole rupiah: `amount` is NUMERIC(14,2) but every value in it comes
    from `system_settings.pricing`, which is whole rupiah, so the casts in the
    query lose nothing. It is cast rather than trusted because the database, not
    this code, decides the column's type.
    """

    revenue_today: int
    revenue_last_30_days: int
    revenue_total: int
    mrr_run_rate: int
    settled_last_30_days: int
    pending_queue: int
    expired_queue: int
    active_subscribers: int
    churned_subscribers: int


class OverviewUnavailable(RuntimeError):
    """The aggregates could not be read.

    Not the same as "everything is zero": an install with no payments answers with
    zeros, which is a real state, while a database that would not answer has to
    say so rather than show an operator a flat line and let them conclude the
    business is quiet.
    """


async def read_overview() -> AdminOverview:
    """One statement, nine figures. Never a substituted number."""
    pool = await get_pool()
    try:
        row = await pool.fetchrow(_OVERVIEW_SQL)
    except Exception as exc:  # noqa: BLE001
        raise OverviewUnavailable(f"the overview query failed: {exc}") from exc
    if row is None:  # pragma: no cover - an aggregate always returns one row
        raise OverviewUnavailable("the overview query returned no row")
    return AdminOverview(
        revenue_today=int(row["revenue_today"]),
        revenue_last_30_days=int(row["revenue_last_30_days"]),
        revenue_total=int(row["revenue_total"]),
        mrr_run_rate=int(row["mrr_run_rate"]),
        settled_last_30_days=int(row["settled_last_30_days"]),
        pending_queue=int(row["pending_queue"]),
        expired_queue=int(row["expired_queue"]),
        active_subscribers=int(row["active_subscribers"]),
        churned_subscribers=int(row["churned_subscribers"]),
    )
