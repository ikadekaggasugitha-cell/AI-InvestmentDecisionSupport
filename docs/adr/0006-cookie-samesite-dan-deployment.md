# Session cookie: Lax, Secure in production, and no Domain

The session is a cookie, so its attributes decide where it travels and who can
read it. Four of them are set here and the reasoning is worth writing down,
because each one is a choice rather than a default.

**HttpOnly.** The token is unreadable by JavaScript, which is the entire reason it
left localStorage. A token in localStorage is readable by any cross-site script
that reaches the page, and readable means replayable.

**Secure, governed by SESSION_COOKIE_SECURE and required in production.** Not by
`APP_ENV`. A staging deployment over HTTPS needs Secure too, and a cookie that
quietly travels in the clear because the environment variable said "staging" is
worse than one that fails loudly. Production refuses to boot without it, which
is the same pattern as `AUTH_BYPASS` and `PAYWALL_ENABLED`.

**SameSite=Lax, which fixes the deployment shape.** Lax means the frontend and
the API must be same-site, so the question "is that a same registrable domain?"
decides the architecture: `app.example.com` and `api.example.com` are same-site
and Lax works; `app.example.com` and `api.other.com` are not. Same-origin is
subpaths of one host. So there are two supported deployments and one that is not:

- **One host, API under a prefix** (`example.com/api/v1/...`). Simplest, and the
  development setup already does this through the Vite proxy.
- **Two subdomains of one registrable domain.** Same-site, so Lax still applies.
  Needs `allow_credentials`, which the app already sets, and an explicit
  `cors_origins` rather than a wildcard.

The option that does not work is a genuinely cross-site API, which would require
`SameSite=None; Secure` and a cookie whose Domain spans both sites. It is not
configured because it widens what an XSS on any subdomain can reach, and there is
no deployment reason to pay for that.

**No Domain attribute.** Host-only, so a sibling subdomain cannot set or read the
cookie. That is the default and there is no reason to give it up.

## Consequences

- **The WebSocket needs a plan per deployment.** Same-site gets the cookie on the
  handshake automatically. Cross-site does not, so `/v1/auth/ws-ticket` issues a
  single-use ticket valid for thirty seconds and one connection. A long-lived
  token in a query string would land in proxy and access logs.
- **Deep links need a history fallback** on the dev server, or `/login` returns a
  404 page on refresh. The Vite proxy exists partly for this.
- **Changing a cookie attribute invalidates nothing by itself**, but changing
  `SESSION_COOKIE_SECURE` in production requires HTTPS to be serving or every
  login silently fails, with no error the user can act on.

## Referensi

- ADR-0004 for why the token is opaque and hashed rather than signed
- `backend/api/routers/auth.py` for where the cookie is set
- `backend/api/core/config.py` for the production boot check
- `backend/tests/test_auth.py::TestCookieAttributes` for what is asserted