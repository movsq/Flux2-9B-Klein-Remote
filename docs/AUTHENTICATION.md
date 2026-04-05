# Authentication & Access

[← Back to README](../README.md)

Users authenticate with **Google OAuth** (ID token flow — no server-side redirect needed).

---

## Account lifecycle

| State | Meaning |
|-------|---------|
| `pending` | Signed in with Google but not yet approved — cannot submit jobs |
| `active` | Approved; full access to job submission and vault |
| `suspended` | Access revoked by an admin |

New accounts start as `pending` **unless** the user supplies a `registration` invite code at sign-in, which immediately sets them to `active`.

---

## Per-user AI use quota

Each Google account has a **uses remaining** quota:

| Value | Meaning |
|-------|---------|
| `0` | No access — job submission blocked until an admin grants uses |
| *N* (positive integer) | User may submit *N* more jobs; decremented by 1 on each successful submission |
| `null` / Unlimited | No limit — user may submit freely |

New accounts always start with **0 uses**. An admin must grant uses before the first job can be submitted. Existing accounts (created before this feature) are migrated to **Unlimited** automatically.

---

## Invite codes

Admins generate two types of invite code from the Admin panel or via the REST API:

| Type | Effect |
|------|--------|
| `registration` | Activates a new Google account immediately on sign-in |
| `job_access` | Grants a non-Google session scoped to job submission only (no vault, no admin) |

Codes have the format `KLEIN-XXXX-XXXX` and can be configured with a use limit and expiry time.

---

## Access code login (guest mode)

Users can enter a `job_access` code instead of signing in with Google. The server issues a short-lived JWT with `type: "code_user"` that allows job submission. The phone WebSocket receives `code_status` messages whenever remaining uses change.

---

## Terms of Service

Google-authenticated users must accept the Terms of Service before they can submit jobs. The ToS is presented as a modal on first login and re-shown if the user attempts to generate without having accepted.

Acceptance is recorded server-side (`tos_accepted_at` timestamp in the `users` table).

The terms reference Czech Republic applicable law:

- **Contract formation:** § 1724 et seq. of Act No. 89/2012 Coll. (Czech Civil Code)
- **Data protection:** Regulation (EU) 2016/679 (GDPR) as supplemented by Act No. 110/2019 Coll.
- **Prohibited content:** Act No. 40/2009 Coll. (Czech Criminal Code), Regulation (EU) 2024/1689 (AI Act)
- **Governing law:** Czech Republic; disputes resolved by Czech courts
