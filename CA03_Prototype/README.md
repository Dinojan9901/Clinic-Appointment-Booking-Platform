# MediConnect – CA03 Prototype

A functional prototype of **MediConnect**, the microservices-based **clinic appointment
booking platform** designed in CA01. Patients find a doctor and clinic, hold a slot, pay for it,
and attend the clinic in person; the doctor records the visit and issues a **digitally signed
e-prescription**; administrators verify doctors, manage clinics and users, and monitor the
platform.

The prototype implements the CA01 architecture: an **API Gateway**, six independent
**microservices** (including the **Payment Service** from the CA01 diagram), **database-per-service**
(MongoDB), an **event-driven** backbone (RabbitMQ) with a **transactional outbox**, a
**choreographed Saga** for booking + payment, a **Redis** cache, and **Docker Compose**
orchestration with horizontal scaling. Everything used is free and open source.

---

## 1. Architecture at a glance

```
 Browser ──► Frontend (React SPA, nginx) :3000 ──/api──► API Gateway :8090
                                                    JWT · routing · rate limit (Redis) · admin guard
      ┌────────────┬──────────────┬──────────────┬──────────────┬──────────────┬─────────────┐
      ▼            ▼              ▼              ▼              ▼              ▼             │
   Auth       Appointment      Records       Payment       Notification     Admin           │
  auth_db    appointment_db   records_db    payment_db    notification_db  admin_db         │
     │        │   ▲  Redis        │  ▲ sync      │              ▲              ▲             │
     │        │   │  cache        │  └─complete──┤ sync lookup  │ SMTP ─► Mailpit :8025      │
     └────────┴───┴───────────────┴──────────────┴──────────────┴──────────────┘
                        RabbitMQ topic exchange "mediconnect.events"  (UI :15672)
```

- **Synchronous (REST):** browser → gateway → services; Records → Appointment (complete the
  visit); Payment → Appointment (amount + hold check); Auth → Appointment (clinic lookup).
- **Asynchronous (events):** every state change publishes a domain event through its service's
  **outbox**; consumers are idempotent and retry through a per-queue retry/dead-letter queue.

| Event | Published by | Consumed by |
|-------|--------------|-------------|
| `user.registered`, `user.status_changed` | Auth | Appointment (suspend/restore doctor), Admin |
| `doctor.registered` / `.approved` / `.rejected` | Auth | Appointment (doctor profile), Notification, Admin |
| `appointment.created` (slot held) | Appointment | Notification, Admin |
| `payment.succeeded` / `payment.failed` | Payment | Appointment (Saga), Notification, Admin |
| `appointment.booked` | Appointment | Records (create record), Notification (+reminder), Admin |
| `appointment.rescheduled` / `.cancelled` / `.expired` | Appointment | Records, Notification, Payment (refund), Admin |
| `appointment.payment_rejected` | Appointment | Payment (refund – compensation) |
| `payment.refunded`, `record.completed`, `ehr.accessed`, `review.submitted` | Payment / Records / Appointment | Notification, Admin |

See [`docs/architecture-mapping.md`](docs/architecture-mapping.md) for the mapping to the CA01
diagrams and requirements.

---

## 2. Services

| Component | Port | Database | Responsibility |
|-----------|------|----------|----------------|
| Frontend (React + nginx) | 3000 | – | Patient, doctor and admin web UI; public prescription verification page |
| API Gateway | 8090 → 8080 | – | Single entry point: JWT, routing, Redis-backed rate limit, admin guard |
| Auth Service | 4001* | `auth_db` | Register/login, JWT, doctor sign-up + admin verification, user enable/disable |
| Appointment Service | 4002* | `appointment_db` | Clinics, doctor profiles & slots, booking holds, reschedule, cancel, reviews, Redis cache |
| Records Service | 4003* | `records_db` | Consultation records, Ed25519-signed e-prescriptions (PDF + QR), patient history (EHR) |
| Notification Service | 4004* | `notification_db` | In-app notifications, email via SMTP (Mailpit), appointment reminders |
| Payment Service | 4005* | `payment_db` | Checkout with a simulated provider, receipts (PDF), refunds |
| Admin Service | 4006* | `admin_db` | Audit/activity log from all events, platform statistics, service health |
| MongoDB 4.4 / RabbitMQ / Redis | internal | – | Databases, event bus (UI :15672), cache |
| Mailpit | 8025 | – | Demo email inbox (all outgoing emails land here) |

`*` internal to the Docker network – reachable **only through the gateway**.
Shared code (`common/`) holds the messaging layer (outbox relay, consumer retries) and service
bootstrap helpers; each service still builds and deploys independently.

---

## 3. Running

**Prerequisite:** Docker Desktop.

```bash
cd CA03_Prototype
docker compose down -v            # start from a clean database
docker compose up --build -d
node tests/wait-ready.js          # optional: waits until every service is healthy
```

| URL | What |
|-----|------|
| http://localhost:3000 | Web app |
| http://localhost:8025 | Mailpit – emails sent by the platform |
| http://localhost:15672 | RabbitMQ management (`guest` / `guest`) |

**Demo accounts:** admin `admin@mediconnect.lk` / `admin123`; doctors
`anushka.perera@`, `suresh.kumar@`, `fathima.nazeer@`, `rajitha.silva@` + `mediconnect.lk`
/ `doctor123`. Patients register themselves. Seeded doctors always have free slots for the
next 5 days.

**Settings** (environment variables when starting compose):
`HOLD_MINUTES` (default 10) – how long an unpaid booking holds the slot;
`REMINDER_LEAD_HOURS` (default 24) – when reminders are sent before the visit.

**Scaling demo:** `docker compose up -d --scale appointment-service=3` – the gateway spreads
requests across the replicas (see the `X-Served-By` response header and the Admin → Dashboard
health table). Rate limits and the cache are shared in Redis, so they stay correct.

> The React SPA loads React/Babel from a CDN, so the browser needs internet access.

---

## 4. Demo walkthrough

1. **Patient:** register → *Find a Doctor* (filter by speciality, location or clinic) → click a
   slot. The slot is **held** (`pending_payment`) and the checkout opens.
2. **Pay** with test card `4000 0000 0000 0002` → *declined*, slot still held. Pay with
   `4242 4242 4242 4242` → approved; a few seconds later the booking becomes **booked + paid**
   (the Saga completes via events). Download the **receipt** under *Payments*.
3. **Notifications** / **Mailpit** show the hold, decline, confirmation and reminder emails.
4. **Doctor** (incognito, e.g. Anushka): *Appointments* shows the visit; *Consultation Records*
   has the auto-created record → add notes + several medications → **Complete & sign**. Use
   **Patient history** to see the patient's earlier visits (audited).
5. **Patient:** *My Records* → **Download prescription (PDF)** → open the **Verify** link
   (or scan the QR code) → "Valid prescription – signature verified".
6. **Patient:** *My Appointments* → **Rate your visit**; book another slot and **Reschedule** or
   **Cancel** it (cancel after payment → automatic **refund**).
7. **Doctor onboarding:** *Join as doctor* → login is blocked until **Admin → Doctor
   Verification → Verify & approve** → the doctor logs in, publishes slots in **My Schedule**
   and immediately appears in patient search.
8. **Admin:** *Dashboard* (stats + live service health), *Users* (disable/enable), *Clinics*
   (add/edit), *Payments* (totals, receipts), *Activity Log* (every domain event).

**Resilience demos:**
- `docker compose stop rabbitmq` → bookings and payments still work; events wait in the
  outboxes → `docker compose start rabbitmq` → confirmations, records and emails catch up.
- `docker compose stop appointment-service` → completing a record **fails closed** (503).
- Start with `HOLD_MINUTES=1` and leave a booking unpaid → it **expires** and the slot is freed.

---

## 5. API (all through the gateway, prefix `/api`)

| Method | Path | Who |
|--------|------|-----|
| POST | `/auth/register`, `/auth/register-doctor`, `/auth/login` | public |
| GET | `/auth/me` | any user |
| GET | `/auth/users?role=&q=` · PATCH `/auth/users/:id/status` | admin |
| GET | `/auth/doctors?status=` · POST `/auth/doctors/:id/approve` · `/reject` | admin |
| GET | `/clinics` (public) · POST `/clinics` · PUT `/clinics/:id` | admin for writes |
| GET | `/doctors?speciality=&location=&clinicId=` · `/doctors/:id` · `/doctors/:id/reviews` | any user |
| GET | `/doctors/me` · POST `/doctors/me/slots` · DELETE `/doctors/me/slots/:slot` | doctor |
| GET | `/doctors/all` · `/appointments/all` | admin |
| POST | `/appointments` (hold) · `/appointments/:id/cancel` · `/reschedule` · `/review` | patient |
| GET | `/appointments/mine` · `/appointments/doctor` · `/appointments/:id` | owner / assigned doctor / admin |
| POST | `/appointments/:id/complete` | assigned doctor (called by Records) |
| POST | `/payments` (header `Idempotency-Key` optional) | patient |
| GET | `/payments/mine` · `/payments/:id/receipt` (PDF) · `/payments` (admin) | owner / admin |
| GET | `/records/mine` · `/records/doctor` · `/records/patient/:patientId` · `/records/:id/prescription` | patient / doctor |
| PUT | `/records/:id` (complete + sign) | assigned doctor |
| GET | `/prescriptions/verify/:code` · `/prescriptions/public-key` | public |
| GET | `/notifications/mine` · POST `/notifications/mine/read` | any user |
| GET | `/admin/stats` · `/admin/activity` · `/admin/health` | admin |

---

## 6. Requirement coverage

**CA03 brief**

| Requirement | Where |
|-------------|-------|
| Simple User Interface | `frontend/` – patient, doctor and admin portals |
| Business Logic Layer | controller files in every service (`appointments.js`, `controller.js`, …) |
| Data Storage Layer | Mongoose models, one database per service |
| ≥ 3 major functionalities | auth & doctor verification, search & booking, payment, records & e-prescriptions, reviews, admin |
| Error handling | validation + central error middleware everywhere; retries, dead-letter queues, fail-closed sync calls |
| Basic security | JWT, bcrypt, RBAC + ownership checks, spoof-proof identity headers, admin guard, rate limiting, signed prescriptions, audit log |
| Deployment demonstration | `docker compose up` (12 containers), `--scale`, GitHub Actions CI |
| Communication between components | REST via gateway + service-to-service REST + RabbitMQ events |

**CA01 functional requirements**

| FR | Implemented as |
|----|----------------|
| FR-01 Registration & auth | patient sign-up, doctor sign-up with licence → admin verification, admin account, JWT |
| FR-02 Doctor & clinic search | speciality / location / clinic filters, availability, ratings (Redis-cached) |
| FR-03 Book, reschedule, cancel | slot hold → payment → booking; reschedule; cancel with refund |
| FR-04 Consultation record | auto-created by event, completed by the doctor after the visit |
| FR-05 E-prescription | Ed25519 digital signature, PDF with QR, public verification for pharmacies |
| FR-06 EHR | patient history across visits; doctors see it only for their patients; access audited |
| FR-07 Payment | separate Payment Service, simulated provider, receipts, refunds, idempotency keys |
| FR-08 Notifications | in-app + email (Mailpit), confirmations, refunds, reminders |
| FR-09 Rating & feedback | 1–5 stars + comment after a completed visit, doctor average |
| FR-10 Administration | doctor verification, users, clinics, payments, activity/audit log, service health |

---

## 7. Key design decisions

| Problem | Decision |
|---------|----------|
| Booking + payment span two services and databases | **Choreographed Saga**: Appointment holds the slot (`pending_payment`) → Payment charges → `payment.succeeded` confirms the booking. Compensations: an unpaid hold **expires** and frees the slot; a payment that arrives after the hold ended triggers `appointment.payment_rejected` → **refund**; cancelling a paid booking → **refund**. |
| Writing to the DB and publishing an event can't be atomic (dual-write) | **Transactional outbox** inside each aggregate document (single-document atomicity, no replica set needed), relayed with RabbitMQ publisher confirms. |
| Redelivered events and network retries | **Idempotent consumers** (upserts, unique event keys) and **Idempotency-Key** on payments; one active payment per appointment enforced by a partial unique index. |
| Failing messages must not be lost or loop forever | Per-queue **retry queue** (TTL, dead-letters back to the same queue only), max 5 attempts, then a `.dead` parking queue. |
| Two patients booking the same slot | Atomic conditional update (`$pull` on the free slot) – exactly one wins. |
| Identity headers could be forged | Gateway strips client `x-user-*` headers; only a verified JWT sets them; `/api/admin` additionally requires the admin role. |
| Anyone could claim to be a doctor | Doctors self-register as **pending**; an admin verifies the licence; profiles become searchable only on `doctor.approved`. |
| Prescriptions must be trustworthy outside the system | **Ed25519 digital signature** over the prescription; anyone (a pharmacy) can verify it with the public key. |
| Medical history is sensitive | Only a treating doctor can open a patient's history, and every access emits `ehr.accessed` into the audit log. |
| Search is the busiest read path | **Redis cache-aside** with version-based invalidation (all replicas see changes at once). |
| Completing a record when the Appointment Service is down | **Fails closed** (503): consistency over availability for clinical data. |
| Horizontal scaling | Stateless services, no fixed container names, shared state in MongoDB/Redis, no keep-alive pinning at the gateway. |

---

## 8. Testing

- **Automated end-to-end test** (≈70 checks across every feature, through the gateway):
  `node tests/e2e.js` with the stack running (Node 18+). Add `EXPIRY_TEST=1` when the stack runs
  with `HOLD_MINUTES=1` to include hold expiry.
- **GitHub Actions** (`.github/workflows/ci.yml`): on every push it syntax-checks the code,
  builds all images, starts the stack with **2 appointment-service replicas**, waits for health
  and runs the end-to-end test – so the system is verified on a clean machine.

## 9. Notes & simplifications

- **Payments are simulated** (no money moves, no card data stored – only brand + last 4).
- **Email** goes to Mailpit, a local test inbox; **SMS** is logged by the Notification Service.
- MongoDB is used for every service (CA01 also lists PostgreSQL for transactional data); the
  outbox keeps state + event atomic without multi-document transactions.
- CA01 targets Kubernetes; Docker Compose with `--scale` demonstrates the same deployment ideas
  locally.
