# MediConnect – CA03 Prototype

A functional prototype of **MediConnect**, the microservices-based **clinic appointment
booking platform** designed in CA01. Patients use a web app to find a doctor/clinic, book an
appointment slot in advance, and later attend the clinic in person; the doctor records the
visit and issues a digital prescription.

The prototype implements the CA01 architecture: an **API Gateway**, four independent
**microservices**, **database-per-service** (MongoDB), and an **event-driven** backbone
(RabbitMQ), all orchestrated with **Docker Compose**.

---

## 1. Architecture at a glance

```
                 ┌──────────────┐
   Browser  ───► │  Frontend    │  (React SPA, nginx)   http://localhost:3000
                 └──────┬───────┘
                        │  /api/*  (same-origin proxy)
                 ┌──────▼───────┐
                 │ API Gateway  │  JWT auth, routing, rate limiting   :8080
                 └──┬───┬───┬───┬┘
        REST (sync) │   │   │   │
        ┌───────────┘   │   │   └──────────────┐
        ▼               ▼   ▼                  ▼
   ┌─────────┐   ┌────────────┐   ┌───────────┐   ┌──────────────┐
   │  Auth   │   │Appointment │   │  Records  │   │ Notification │
   │ Service │   │  Service   │   │  Service  │   │   Service    │
   └────┬────┘   └─────┬──────┘   └─────┬─────┘   └──────┬───────┘
        │              │  publishes     │ consumes       │ consumes
     auth_db      appointment_db   records_db       notification_db
        │              │   ┌────────────┴────────────────┘
        │              └──►│   RabbitMQ  (appointment.booked / .cancelled)
        │       (outbox)   └─────────────────────────────
   (each service owns its own MongoDB database = database-per-service)
```

- **Synchronous** communication: Browser → Gateway → services (REST). Also
  Records Service → Appointment Service (marks the appointment *completed* when a doctor
  completes the consultation record).
- **Asynchronous** communication: Appointment Service **publishes** `appointment.booked` and
  `appointment.cancelled` through a **transactional outbox**; the Records and Notification
  services **consume** them independently (fan-out) with idempotent handlers.

See [`docs/architecture-mapping.md`](docs/architecture-mapping.md) for a component-by-component
mapping back to the CA01 diagrams.

---

## 2. Services

| Component            | Tech                | Port  | Database          | Responsibility |
|---------------------|---------------------|-------|-------------------|----------------|
| Frontend            | React (SPA) + nginx | 3000  | –                 | User interface |
| API Gateway         | Node.js / Express   | 8090† | –                 | Entry point, JWT, routing, rate limit |
| Auth Service        | Node.js / Express   | 4001* | `auth_db`         | Register, login, JWT, roles |
| Appointment Service | Node.js / Express   | 4002* | `appointment_db`  | Doctor search, booking, publishes events |
| Records Service     | Node.js / Express   | 4003* | `records_db`      | Consultation notes, e-prescriptions |
| Notification Service| Node.js / Express   | 4004* | `notification_db` | Booking confirmations (mock email/SMS) |
| MongoDB             | mongo:4.4           | 27017* | –                | One database per service |
| RabbitMQ            | rabbitmq:3-mgmt     | 5672* / 15672 | –         | Event bus |

`*` Internal to the Docker network only – the services are reachable **only through the
gateway**, which mirrors the CA01 design (single public entry point).
`†` Host port 8090 maps to the gateway's container port 8080 (the frontend reaches it
internally, so you rarely need it). MongoDB is 4.4 because 5.0+ needs a CPU with AVX.

---

## 3. Running the prototype (deployment demonstration)

**Prerequisite:** Docker Desktop (with Docker Compose).

```bash
cd CA03_Prototype
docker compose up --build
```

First start takes a couple of minutes (image builds + MongoDB/RabbitMQ health checks). When
you see the services log `listening on port ...`, open:

- **Web app:** http://localhost:3000
- **RabbitMQ management UI:** http://localhost:15672  (user `guest`, password `guest`) –
  useful to *show the event queues live* during the demo.

Stop with `Ctrl+C`, then `docker compose down` (add `-v` to also wipe the database volume).

> The React SPA loads React from a CDN, so the browser needs internet access the first time
> the page loads. Everything else runs fully locally in containers.

---

## 4. Demo walkthrough (suggested for the presentation)

1. **Register a patient** → log in. (Auth Service, JWT issued. Self-registration always
   creates a *patient* – nobody can make themselves a doctor.)
2. **Find a Doctor** → search by speciality/location → **Book** a slot with
   **Dr. Anushka Perera** (Cardiology, Colombo).
   - The Appointment Service reserves the slot atomically, records a *paid* (simulated)
     payment, and saves an `appointment.booked` event in its **outbox** in the same write; the
     outbox relay then publishes it to RabbitMQ.
   - In the RabbitMQ UI you can watch the message flow to two queues.
3. **My Appointments** → the booking appears as `booked` + `paid`.
4. **Notifications** → a confirmation appears (created asynchronously by the Notification
   Service from the event).
5. In another browser/incognito, **log in as the doctor** using a seeded clinic account:

   | Doctor | Email | Password |
   |--------|-------|----------|
   | Dr. Anushka Perera | `anushka.perera@mediconnect.lk` | `doctor123` |
   | Dr. Suresh Kumar | `suresh.kumar@mediconnect.lk` | `doctor123` |
   | Dr. Fathima Nazeer | `fathima.nazeer@mediconnect.lk` | `doctor123` |
   | Dr. Rajitha Silva | `rajitha.silva@mediconnect.lk` | `doctor123` |

   Each doctor sees **only their own** appointments and records.
6. **Consultation Records** → the record for the booking is already there (auto-created by the
   Records Service from the same event). Add notes + a prescription → **Complete record**.
   - The Records Service makes a **synchronous REST call** to the Appointment Service, which
     atomically moves the appointment `booked → completed` before the record is saved (it
     *fails closed* if that service is down).
7. Back as the **patient → My Records** → the prescription is now visible; in **My
   Appointments** the visit shows *completed* and can no longer be cancelled.
8. *(Optional)* Book another slot, then **Cancel** it → a cancellation notification appears
   and the doctor's pending record shows *cancelled* (`appointment.cancelled` event).

This one flow demonstrates: layered services, sync + async communication, database-per-service,
JWT security with role/ownership checks, and the full booking lifecycle.

**Resilience demo (outbox):** `docker compose stop rabbitmq` → book an appointment (it still
succeeds; the event waits in the outbox) → `docker compose start rabbitmq` → once the broker
is up (slow on this machine), the notification and record appear. No event is lost.

---

## 5. Key API endpoints (all via the gateway, prefix `/api`)

| Method | Path | Auth | Service |
|--------|------|------|---------|
| POST | `/api/auth/register` | – | Auth |
| POST | `/api/auth/login` | – | Auth |
| GET  | `/api/auth/me` | JWT | Auth |
| GET  | `/api/doctors?speciality=&location=` | JWT | Appointment |
| POST | `/api/appointments` | JWT (patient) | Appointment |
| GET  | `/api/appointments/mine` | JWT | Appointment |
| GET  | `/api/appointments/:id` | JWT (owning patient or assigned doctor) | Appointment |
| POST | `/api/appointments/:id/complete` | JWT (assigned doctor; called by Records Service) | Appointment |
| POST | `/api/appointments/:id/cancel` | JWT (owning patient) | Appointment |
| GET  | `/api/appointments/doctor` | JWT (doctor – own appointments) | Appointment |
| GET  | `/api/records/mine` | JWT | Records |
| GET  | `/api/records/doctor` | JWT (doctor – own patients) | Records |
| PUT  | `/api/records/:id` | JWT (assigned doctor) | Records |
| GET  | `/api/notifications/mine` | JWT | Notification |

---

## 6. CA03 requirement checklist

| Requirement | Where it is demonstrated |
|-------------|--------------------------|
| Simple User Interface | React SPA (`frontend/`) |
| Business Logic Layer | `controller.js` in each service |
| Data Storage Layer | MongoDB models (`model.js` / `models.js`), one DB per service |
| ≥ 3 major functionalities | (1) auth, (2) doctor search + booking, (3) consultation record + e-prescription, (+ notifications) |
| Error handling | Validation + try/catch + central error middleware in every service and the gateway |
| Basic security | JWT auth, bcrypt password hashing, role + ownership checks, no self-service doctor accounts, spoof-proof identity headers, gateway rate limiting |
| Deployment demonstration | `docker compose up` brings up all services + infra |
| Communication between components | REST via gateway (sync), Records→Appointment (sync, identity propagated), RabbitMQ events via transactional outbox (async) |
| Architecture implementation | API Gateway + microservices + database-per-service + event bus (matches CA01) |

---

## 7. Notes & simplifications (prototype scope)

- **Payment** is simulated (always succeeds) – a real gateway integration is out of scope.
- **Doctor accounts** are seeded (no admin onboarding UI). A doctor's login is linked to their
  profile by **email**, which travels in the JWT and the `appointment.*` events.
- If you ran an older version, start clean with `docker compose down -v` – older appointments
  and records carry no doctor email, so they won't appear in any doctor's view.
- MongoDB is used for every service (one logical database each) to keep the stack simple;
  the CA01 design also lists PostgreSQL for transactional data.
- Focus, per the module guidance, is on demonstrating the **architecture** rather than a
  production-grade implementation.

---

## 8. Key design decisions (consistency, reliability, security)

| Problem | Decision | Where |
|---------|----------|-------|
| Services trust `x-user-*` identity headers – a client could forge them | The gateway **strips** all `x-user-*` headers from every incoming request and only re-adds them from a verified JWT. `/api/auth/me` now requires a JWT. | `api-gateway/src/index.js` |
| Publishing straight to RabbitMQ after the DB write loses the event if the broker is down (dual-write problem) | **Transactional outbox**: the event is stored inside the appointment document in the *same atomic write*; a relay publishes it on a confirm channel and removes it only after the broker acks. Delivery is at-least-once, so consumers are **idempotent** (upsert by `appointmentId`; unique `eventId` on notifications). | `appointment-service/src/events.js`, `models.js` |
| Read-check-write on slots lets two concurrent bookings take the same slot | **Atomic conditional update** – `findOneAndUpdate({ availableSlots: slot }, { $pull })` – reserves the slot in one operation; a failed appointment save gives the slot back (compensation). | `appointment-service/src/controller.js` |
| Cancellation was invisible to the other services | Cancel emits **`appointment.cancelled`** (via the outbox); Records marks the pending record cancelled, Notification sends a cancellation notice. The cancel is a conditional update, so a double-click cannot cancel twice. | appointment / records / notification `events.js` |
| Anyone could self-register as doctor/admin; any user could read any appointment; doctors saw every record | Self-registration creates **patients only**; doctor accounts are provisioned (seeded). **Ownership checks**: an appointment is readable only by its patient or assigned doctor; doctors see and complete only their own patients' records. | auth `controller.js`/`seed.js`, appointment + records `controller.js` |
| A patient could cancel *after* the visit (the appointment never became `completed`), releasing a slot that had been used | Completing a record now calls the Appointment Service, which performs an **atomic `booked → completed` transition** before the record is saved. Cancel also requires `booked`, so a concurrent cancel and completion cannot both succeed, and a completed appointment cannot be cancelled. The call is idempotent, so a retry after a partial failure is safe. | appointment + records `controller.js` |
| Records→Appointment validation *failed open* when the Appointment Service was down | It now **fails closed** (HTTP 503, 3 s timeout): for a clinical record, **consistency is chosen over availability** – the doctor retries rather than risk recording a cancelled visit. The caller's identity is propagated so the Appointment Service enforces its own authorisation. | `records-service/src/controller.js` |

**Why MongoDB single-document atomicity instead of transactions?** Multi-document transactions
need a replica set; keeping the outbox inside the aggregate (the appointment) gives the same
guarantee on a standalone MongoDB, which keeps the deployment simple.
