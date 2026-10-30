"""
The admin surface: one router, five domains.

Why a script and an endpoint both exist: `db/promote_admin.py` creates the first
administrator because a brand-new install has nobody to promote. Once one exists,
promoting and demoting is a routine action and belongs behind the API rather than
in a shell on someone's laptop — an operator should not need database access to
close an account that is being abused.

The endpoints split by what they administer; the composite keeps the single
`/v1/admin` prefix and the old import path (`from api.routers import admin`).
"""

from fastapi import APIRouter

from api.routers.admin import accounts, bank_accounts, pricing, subscriptions, transactions

router = APIRouter(prefix="/v1/admin", tags=["admin"])
router.include_router(accounts.router)
router.include_router(subscriptions.router)
router.include_router(pricing.router)
router.include_router(bank_accounts.router)
router.include_router(transactions.router)

