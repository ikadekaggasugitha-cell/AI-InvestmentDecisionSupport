"""
The money flow: money declared, approved, denied, and left to age.

Every SQL statement that touches `transactions` lives in this package, for the
same reason account_service owns `users`: one writer per table is what makes
`transactions.subscription_id` a fact anyone can trust. The admin queue, the
declared transfer, and the expiry beat all come through these functions, and
the gateway phase joins them rather than adding a second file of UPDATEs.

The table records money flow only. Nothing here decides access: a settlement
does not open data, and a denial does not close it — `subscriptions.expires_at`
stays the only access decision (CONTEXT.md rule 1), and the Subscription itself
is written by `grant()` and nothing else.

Approval runs inside one database transaction, because the two things it does —
marking money received and minting the period it bought — must stand or fall
together. A crash in between would leave a settled payment whose access never
appeared: the exact state "kegagalan di tengah tidak meninggalkan `settlement`
tanpa Subscription" exists to forbid.

Implementation split:
  core.py     — plan slots, limits, the Transaction row shape, the errors
  manual.py   — the declared transfer and its adjudication
  gateway.py  — Midtrans checkout and the webhook that settles it

Patch the submodule that owns a name; this facade re-exports for import
compatibility only.
"""

from api.services.payment_service.core import (  # noqa: F401
    DenyRequiresReason,
    PLAN_DAYS,
    PLAN_NAMES,
    PAYMENT_METHODS,
    Transaction,
    TransactionNotApprovable,
    TransactionNotDeniable,
    ManualPaymentInvalid,
)
from api.services.payment_service.gateway import (  # noqa: F401
    GatewayCheckoutUnavailable,
    deny_gateway_transaction,
    expire_gateway_transaction,
    open_gateway_transaction,
    settle_gateway_transaction,
    transaction_by_invoice_code,
)
from api.services.payment_service.manual import (  # noqa: F401
    approve_transaction,
    deny_transaction,
    expire_pending,
    list_transactions_for_admin,
    list_transactions_for_user,
    manual_deadline,
    open_manual_transaction,
)
from api.services.subscription_service import (  # noqa: F401
    SubscriptionPeriod,
    TransactionNotFound,
    TransactionOwnershipError,
)
