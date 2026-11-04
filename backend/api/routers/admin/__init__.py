"""
The admin surface: one router, ten domains.

Why a script and an endpoint both exist: `db/promote_admin.py` creates the first
administrator because a brand-new install has nobody to promote. Once one exists,
promoting and demoting is a routine action and belongs behind the API rather than
in a shell on someone's laptop — an operator should not need database access to
close an account that is being abused.

The endpoints split by what they administer; the composite keeps the single
`/v1/admin` prefix and the old import path (`from api.routers import admin`).

The tenth domain, `smtp`, is deliberately not folded into `integrations`. The
panel next door is a status read that returns no text but a site name, and an
editor has to return the host and username it is showing. Two doors, two guards.
"""

from fastapi import APIRouter

from api.routers.admin import (
    accounts,
    analytics,
    bank_accounts,
    contact,
    integrations,
    payment_channels,
    pricing,
    smtp,
    subscriptions,
    transactions,
)

router = APIRouter(prefix="/v1/admin", tags=["admin"])
router.include_router(accounts.router)
router.include_router(subscriptions.router)
router.include_router(pricing.router)
router.include_router(bank_accounts.router)
router.include_router(payment_channels.router)
router.include_router(contact.router)
router.include_router(smtp.router)
router.include_router(analytics.router)
router.include_router(integrations.router)
router.include_router(transactions.router)

