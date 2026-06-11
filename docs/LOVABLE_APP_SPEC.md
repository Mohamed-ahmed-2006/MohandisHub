# MohandisHub — Full App Specification for Rebuild (e.g. Lovable)

**Use this document as the single source of truth to build MohandisHub from scratch.** Implement every section so the resulting app matches this specification end-to-end (frontend, backend, database, auth, payments, chat, admin, and i18n).

---

## 1. Product Overview

- **Name:** MohandisHub
- **Tagline:** Egypt-first engineering services marketplace connecting customers, experts, and businesses.
- **One-line description:** MohandisHub connects people who need engineering support with trusted professionals and structured service providers, with real-time chat and wallet-ledger workflows built into the foundation.
- **Primary market:** Egypt (Egyptian cities/areas for filters; EGP as default currency).
- **Core value:** Customers post “needs”; experts place bids; businesses offer structured service catalog; all with in-app chat and wallet-based payments.

---

## 2. User Roles and Personas

| Role         | Who they are                          | Main actions                                                                               |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Customer** | Someone who needs engineering help    | Request help (post “needs”), get consultations, fixes, site visits; award bids to experts. |
| **Expert**   | Freelance engineer                    | Identity/academic verification (KYC); offer services; bid on customer needs.               |
| **Business** | Company offering engineering services | Company profile; business verification; structured service catalog.                        |
| **Admin**    | Platform operator                     | Verification review, user/plan/transaction/service/category management.                    |

Users have a single **primary role** (customer | expert | business); admin is a separate flag (`is_admin`). Experts and businesses require **verification** (KYC/KYB) before full access.

---

## 3. Tech Stack (Target)

- **Frontend:** Next.js (App Router), React, TypeScript.
- **Styling:** Tailwind CSS; theme via CSS variables (light/dark).
- **Fonts:** Manrope (primary), Sora (headings).
- **State:** React context for auth; no global store required.
- **API client:** Fetch with `credentials: 'include'`, Bearer token in `Authorization` header; base URL configurable (same-origin rewrites or `NEXT_PUBLIC_API_URL`).
- **Backend:** Node.js (Express or equivalent), TypeScript.
- **Database:** PostgreSQL.
- **Auth:** JWT access token (Bearer) + httpOnly refresh cookie (e.g. `rid`, path `/api/auth`); bcrypt passwords; token rotation on refresh.
- **Validation:** Zod (or equivalent) on API; shared types for request/response.
- **Payments:** Stripe (card) and Cryptomus (crypto) for wallet deposits; webhooks with raw body for Stripe/Cryptomus.
- **Real-time:** Socket.io (or equivalent) for chat.
- **Email/SMS:** Configurable providers (e.g. Brevo/SendGrid for email, Twilio for SMS); OTP and password reset.
- **KYC/Verification:** Optional third-party (e.g. Didit/Idenfy) or manual admin review.
- **File upload:** Multipart; JPEG/PNG/WebP/PDF; max 10 MB; store URLs in DB.

---

## 4. Internationalization (i18n)

- **Locales:** English (`en`), Arabic (`ar`).
- **Routing:** All app routes prefixed with `[locale]` (e.g. `/en`, `/ar`).
- **RTL:** Use `dir="rtl"` and RTL-aware layout for `ar`.
- **Locale resolution:** Cookie (e.g. `mohandishub-language`) or Accept-Language; default `en`.
- **Copy:** All user-facing strings in dictionaries (e.g. `dictionaries/en.ts`, `dictionaries/ar.ts`) with keys for: common, theme, language, home, nav, login, onboarding (role, customer, expert, business), appHome, wallet, plan, needs, profile, auth, admin, etc.
- **Links:** All internal links must include locale (e.g. `buildLocalePath(locale, '/app')` → `/en/app` or `/ar/app`).

---

## 5. Routes and Pages

### 5.1 Public (per locale)

| Path                             | Description                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------ | ---------- |
| `/[locale]`                      | Home: hero (headline, description), “What you can do” features, “How it works” steps, Log in / Sign up.            |
| `/[locale]/auth`                 | Auth page: Login or Register based on query `mode=login                                                            | register`and optional`role=customer | expert | business`. |
| `/[locale]/login`                | Login page (can redirect to `/auth?mode=login`).                                                                   |
| `/[locale]/auth/forgot-password` | Forgot password: submit email, show success message.                                                               |
| `/[locale]/auth/reset-password`  | Reset password: token + new password (from email link).                                                            |
| `/[locale]/verify-email`         | Email verification: send OTP (email channel), verify code.                                                         |
| `/[locale]/onboarding/role`      | Role selection: three cards — Customer, Expert, Business; choose one → redirect to `/auth?mode=register&role=...`. |
| `/[locale]/onboarding/customer`  | Customer onboarding: verify email → then “Go to dashboard”.                                                        |
| `/[locale]/onboarding/expert`    | Expert onboarding: steps — Verify Email, Identity Verification (KYC), Profile Details, Upload Documents.           |
| `/[locale]/onboarding/business`  | Business onboarding: parallel to expert (business verification, profile, documents).                               |
| `/[locale]/terms`                | Terms of Service.                                                                                                  |
| `/[locale]/privacy`              | Privacy Policy.                                                                                                    |

### 5.2 App (authenticated; layout with sidebar + top bar)

All under `/[locale]/app/*`. Layout: collapsible sidebar, top bar with hamburger (mobile), app name, avatar menu (profile, logout). Sidebar links: Home, Settings, Chat, History, Plan, Admin (admin only).

| Path                     | Description                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/[locale]/app`          | App home (role-based dashboard): Customer (post need, my needs, award bids); Expert (open needs, place bid, my bids); Business (catalog/services); Admin (link to admin). Show wallet balance and deposit (Stripe/Cryptomus) modal. |
| `/[locale]/app/settings` | Account settings.                                                                                                                                                                                                                   |
| `/[locale]/app/profile`  | Profile: account tab; expert/business profile tab; documents tab (identity, academic for expert).                                                                                                                                   |
| `/[locale]/app/browse`   | Browse services: search by category, city, area, provider type.                                                                                                                                                                     |
| `/[locale]/app/bookings` | Bookings and reservation lifecycle.                                                                                                                                                                                                 |
| `/[locale]/app/projects` | Projects.                                                                                                                                                                                                                           |
| `/[locale]/app/plan`     | My plan / subscribe to plan (wallet deduction).                                                                                                                                                                                     |
| `/[locale]/app/chat`     | Chat: list conversations, open conversation, send messages (real-time via Socket.io).                                                                                                                                               |
| `/[locale]/app/history`  | History (e.g. transactions / activity).                                                                                                                                                                                             |
| `/[locale]/app/admin`    | Admin panel (admin role only): dashboard stats, users, plans, transactions, services, categories, verification queue.                                                                                                               |

---

## 6. Authentication

### 6.1 Endpoints

- **POST /api/auth/register**  
  Body: `email`, `password`, `displayName`, `role` (customer | expert | business), `dateOfBirth` (YYYY-MM-DD), optional `phone`, `phoneCode`, `nationality`; if role is business: `companyName`. Optional: `acceptedTermsAt`, `termsVersion`.  
  Creates user + role-specific profile (customer_profiles / expert_profiles / business_profiles). Returns `{ user, accessToken, expiresIn }` and sets httpOnly refresh cookie.

- **POST /api/auth/login**  
  Body: `email`, `password`. Returns user + tokens; sets refresh cookie.

- **POST /api/auth/refresh**  
  No body; uses refresh cookie. Token rotation: issue new access + new refresh, set new cookie, return new tokens.

- **POST /api/auth/logout**  
  Revokes current refresh token; clears cookie.

- **GET /api/auth/me**  
  Requires Bearer token. Returns current user: `id`, `email`, `displayName`, `role`, `plan`, `emailVerified`, `verificationStatus`, etc.

- **POST /api/auth/forgot-password**  
  Body: `email`. Sends reset link (or token) via email.

- **POST /api/auth/reset-password**  
  Body: `token`, `password`. Invalidates reset token and revokes refresh tokens.

### 6.2 Auth user shape (from /api/auth/me)

`id`, `email`, `displayName`, `phone`, `phoneCode`, `nationality`, `avatarUrl`, `dateOfBirth`, `role`, `isAdmin`, `plan` (e.g. plan slug), `emailVerified`, `verificationStatus` (unverified | pending | under_review | verified | rejected), `createdAt`.

### 6.3 Guards

- All app routes require authenticated user.
- Some actions require `emailVerified === true`.
- Admin routes require `is_admin` (loaded from DB, not only from JWT).
- Expert/Business features can require `verificationStatus === 'verified'` where appropriate.

---

## 7. OTP and Email Verification

- **POST /api/otp/send**  
  Body: `channel: 'email' | 'phone'`. Sends OTP to user’s email or phone.

- **POST /api/otp/verify**  
  Body: `channel`, `code`. Verifies OTP; for email channel can set `email_verified_at`.

Used on verify-email page and for email-change flows.

---

## 8. Onboarding Flows

- **Customer:** Register → Verify email → Redirect to app home.
- **Expert:** Register → Verify email → KYC (identity + academic documents) → Profile details (title, headline, bio, specializations, years of experience, hourly rate, city, country, employer, job title, LinkedIn, portfolio, languages, education summary) → Upload documents (identity document, academic record).
- **Business:** Register → Verify email → Business verification + company profile (companyName, tradeLicenseNumber, taxId, commercialRegister, industry, companySize, website, contact, address, logo, social, etc.) → Documents as required.

Use same field names and validation as in “Profiles” and “Verification” sections below.

---

## 9. Needs and Bids (Customer ↔ Expert)

### 9.1 Needs (customer creates)

- **Create need:**  
  POST /api/needs  
  Body: `title` (3–300 chars), `description` (10–5000), optional `categoryId` (UUID), `budgetType` ('fixed' | 'hourly'), `budgetAmount` (1–1000000), `currency` (default EGP), optional `timelineDays` (1–365), optional `city`, `country`.  
  Status initially `open`.

- **List my needs:** GET /api/needs (customer’s needs).
- **List open needs:** GET /api/needs?status=open (for experts).
- **Get one need:** GET /api/needs/:id.
- **Update need:** PATCH /api/needs/:id (e.g. status open/closed, title, description).
- **Award bid:** POST /api/needs/:id/award — Body: `bidId` (UUID). Sets need status to `awarded`, sets `awarded_bid_id`, marks that bid as accepted (others can be rejected or left pending).

### 9.2 Bids (expert creates on a need)

- **Create bid:**  
  POST /api/needs/:needId/bids  
  Body: `amount` (1–1000000), `message` (5–3000 chars), optional `deliveryDays` (1–365).  
  One bid per (need_id, expert_id); status `pending`.

- **List bids for need:** GET /api/needs/:needId/bids.
- **List my bids:** GET /api/bids/my.

All needs/bids endpoints: authenticate + require email verified.

---

## 10. Services and Browse

- **Categories:** GET /api/services/categories — returns list with `nameEn`, `nameAr`, `slug`, etc. (bilingual).
- **Search:** GET /api/services/search — query params: categoryId, city, area, providerType (expert | business), query, page, limit.
- **Get service:** GET /api/services/:id.

Browse page at `/[locale]/app/browse`: filters (category, city, area, provider type), results list using above API.

---

## 11. Profiles

- **Expert profile:** GET /api/profiles/expert, PATCH /api/profiles/expert — fields as in ExpertProfile (title, headline, bio, specializations, yearsOfExperience, hourlyRate, city, country, employer, jobTitle, linkedinUrl, portfolioUrl, languages, educationSummary).
- **Business profile:** GET /api/profiles/business, PATCH /api/profiles/business — fields as in BusinessProfile (companyName, tradeLicenseNumber, taxId, commercialRegister, industry, companySize, website, companyEmail, companyPhone, address, logoUrl, city, country, description, owner*, social*, employeesCount, foundedYear).
- **Documents:**
  - Identity: POST/GET identity-documents (documentType, fullNameOnDoc, dateOfBirth, nationality, documentNumber, frontImageUrl, backImageUrl, selfieImageUrl).
  - Academic (expert): POST/GET academic-records (recordType, title, institution, fieldOfStudy, graduationYear, grade, certificateImageUrl, transcriptImageUrl).  
    Statuses: pending, under_review, approved, rejected.

---

## 12. Verification (KYC/KYB)

- **Initiate:** POST /api/verification/initiate (optional third-party provider).
- **Status:** GET /api/verification/status.
- **Webhook:** POST /api/verification/webhook (provider callbacks).
- **Admin:** GET /api/admin/verification/pending — list pending; review identity/academic/business (approve/reject with notes).  
  Verification status on user: unverified → pending → under_review → verified | rejected.

---

## 13. Wallet

- **Balance:** GET /api/wallet/me — returns wallet (balance, currency, isFrozen).
- **Transactions:** GET /api/wallet/me/transactions.
- **Deposit (Stripe):** POST /api/wallet/deposit/stripe (creates checkout session or link); confirm: POST /api/wallet/deposit/confirm-stripe.
- **Deposit (Crypto):** POST /api/wallet/deposit/crypto (e.g. Cryptomus); webhook: POST /api/wallet/cryptomus-webhook (raw body).
- **Stripe webhook:** POST /api/wallet/stripe-webhook (raw body).  
  On success, credit wallet and create transaction record.

---

## 14. Plans and Subscription

- **List plans:** GET /api/plans — active plans only; fields: id, slug, name, price, currency, billingCycle, durationDays, trialDays, maxServices, maxProjects, features (array), isActive, sortOrder.
- **Subscribe:** POST /api/plans/:planId/subscribe — authenticated; deduct from wallet; set user’s plan_id.

---

## 15. Chat

- **Status:** GET /api/chat.
- **Conversations:** GET /api/chat/conversations, POST /api/chat/conversations (create with other participant).
- **Messages:** GET /api/chat/conversations/:id/messages, POST /api/chat/conversations/:id/messages (body).
- **Real-time:** Socket.io (or equivalent): connect with auth; events for new message so UI updates live.  
  Conversations: two participants (participant_a, participant_b); messages: conversation_id, sender_id, body, created_at.

---

## 16. Upload

- **POST /api/upload** — multipart `file`; auth + email verified. Allowed: JPEG, PNG, WebP, PDF; max 10 MB. Returns `{ url, filename }` (e.g. `/uploads/...`).

---

## 17. Admin (all under requireRole('admin'))

- **Dashboard:** GET /api/admin/dashboard/stats.
- **Users:** CRUD; activate/deactivate; send/verify email.
- **Plans:** CRUD.
- **Transactions:** List, detail; adjust balance; reverse.
- **Services:** List, update, approve, reject.
- **Categories:** CRUD.
- **Verification:** Pending list; review identity/academic/business; get any user profile.

Admin must be loaded from DB (`is_admin`) not only from JWT.

---

## 18. API Conventions

- **Response envelope:** Success: `{ ok: true, data: T }`. Error: `{ ok: false, error: { code, message, details?, requestId? } }`.
- **Auth:** Bearer token in `Authorization` header; refresh via cookie.
- **CORS:** Allow configured frontend origin(s).
- **Validation:** Use Zod (or similar) on body/query; return 400 with validation details in `error.details`.

---

## 19. Database (PostgreSQL) — Main Tables

- **users** — id, email, password_hash, display_name, phone, phone_code, nationality, avatar_url, date_of_birth, primary_role (customer|expert|business), email_verified_at, is_active, is_admin, plan_id, accepted_terms_at, terms_version, last_login_at, created_at, updated_at. Minimum age 20 (constraint).
- **refresh_tokens** — id, user_id, token_hash, family_id, device_info, ip_address, expires_at, revoked_at.
- **customer_profiles**, **expert_profiles**, **business_profiles** — one per user by role; expert/business have verification_status, identity_verified, academic_verified / business_verified.
- **plans** — id, slug, name, price, currency, billing_cycle, duration_days, trial_days, max_services, max_projects, features (JSONB), is_active, sort_order.
- **identity_documents**, **academic_records** — for KYC/academic; status, reviewed_by, etc.
- **admin_reviews** — reviewer_id, target_user_id, review_type, target_table, target_record_id, decision, notes.
- **verification_requests** — provider, request_type (identity|business), status.
- **wallets** — user_id, balance, currency, is_frozen.
- **transactions** — wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata, created_by.
- **service_categories** — name_en, name_ar, slug, parent_id, sort_order, is_active.
- **services** — provider_id, category_id, title, description, price, price_type, status, tags, images, city, area, country, etc.
- **needs** — customer_id, title, description, category_id, budget_type, budget_amount, currency, timeline_days, city, country, status (open|closed|awarded), awarded_bid_id, created_at, updated_at.
- **bids** — need_id, expert_id, amount, currency, message, delivery_days, status (pending|accepted|rejected), created_at, updated_at; UNIQUE(need_id, expert_id).
- **conversations** — participant_a, participant_b, status (ongoing|closed), last_message_at.
- **messages** — conversation_id, sender_id, body, created_at.
- **password_reset_tokens**, **pending_email** (for reset and email change).

---

## 20. UI/UX Requirements

- **Theme:** CSS variables for light/dark (e.g. --background, --foreground, --muted, --accent/--primary orange, --card, --border, --success, --warning, --destructive, --focus-ring, --radius-sm/md/lg, --shadow-soft, --surface-elevated, --surface-panel). Toggle in header; persist in cookie/localStorage; no flash (theme script before paint).
- **Layout:** Root layout (fonts, ThemeProvider, AuthProvider); locale layout (lang, dir); app layout (sidebar + top bar + main content).
- **Components:** Reusable Card, Container, ButtonLink, Skeleton; forms with labels and validation messages; modals for wallet deposit (Stripe/Cryptomus).
- **Home page:** Hero (headline, description, Get started CTA); “What you can do” feature grid; “How it works” steps; footer; theme + language switchers.
- **App home:** Role-specific content; wallet balance + deposit CTA; Egyptian cities/areas in filters where relevant.
- **Copy:** Use dictionary keys everywhere; support both en and ar with RTL for ar.

---

## 21. Environment Variables

**API:**

- Required: `JWT_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars).
- Optional: `NODE_ENV`, `PORT` (default 4000), `DATABASE_URL`, `CORS_ORIGIN`, `CORS_EXTRA_ORIGINS`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`.
- JWT: `JWT_ACCESS_EXPIRES_IN` (default 900), `JWT_REFRESH_EXPIRES_IN_DAYS` (default 30).
- Verification: `VERIFICATION_PROVIDER` (didit | idenfy | manual); provider keys and webhooks if used.
- OTP: `OTP_EMAIL_PROVIDER` (console | brevo | sendgrid), `OTP_SMS_PROVIDER` (console | twilio); provider keys, `EMAIL_FROM`.
- Payments: Cryptomus (merchant id, api key, webhook key); Stripe (secret, webhook secret, publishable key).
- Validate env on startup (e.g. Zod).

**Web:**

- Optional: `NEXT_PUBLIC_API_URL` — leave empty to use same-origin rewrites to API.
- Server: `API_INTERNAL_URL` (e.g. http://localhost:4000) for rewrite target.

---

## 22. Business Rules Summary

- **Registration:** Email unique; bcrypt (cost 12); create user + role profile; issue access + refresh; set refresh cookie.
- **Login:** Check is_active; bcrypt compare; update last_login_at; return user + tokens; set cookie.
- **Refresh:** Validate refresh cookie; revoke current token; issue new access + new refresh (same family); set new cookie.
- **Verification:** Expert = identity + academic; Business = identity + business docs. Flow: unverified → pending → under_review → verified | rejected. Admin reviews with approve/reject + notes.
- **Needs/Bids:** Customer creates need (open) → experts bid (pending) → customer awards one bid (need → awarded, bid → accepted).
- **Wallet:** One wallet per user; deposits via Stripe/Cryptomus webhooks; plan subscription deducts balance; admin can adjust/reverse.
- **Plans:** User has plan_id; subscribe deducts from wallet.
- **Chat:** Conversations between two users; REST for list/send; real-time for delivery.
- **Admin:** Only users with is_admin in DB; all admin routes check DB, not only JWT.

---

## 23. Build Order Suggestion

1. Project setup (monorepo or single app): Next.js frontend, Node API, PostgreSQL, env validation.
2. DB migrations: users, refresh_tokens, role profiles, plans, wallet, transactions.
3. Auth: register, login, refresh, logout, me; JWT + refresh cookie; password reset.
4. i18n: locale routing, RTL, dictionaries (en/ar).
5. Public pages: home, auth, forgot/reset password, verify-email, onboarding (role + per-role steps).
6. App layout: sidebar, top bar, auth guard.
7. Needs and bids: create/list/update need; create/list bid; award bid.
8. Services: categories, search, browse page.
9. Profiles: expert/business GET/PATCH; identity and academic documents.
10. Verification: initiate, status, admin pending + review.
11. Wallet: balance, transactions, Stripe/Cryptomus deposit + webhooks.
12. Plans: list, subscribe.
13. Chat: REST + Socket.io.
14. Upload: multipart, validation, store URLs.
15. Admin: dashboard, users, plans, transactions, services, categories, verification.
16. Polish: theme toggle, all dictionary keys, error handling, loading states.

---

End of specification. Build the application from scratch to match this document so that all flows, roles, and features work as described.
