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
        │              └──►│   RabbitMQ  (event: appointment.booked)
        │                  └─────────────────────────────
   (each service owns its own MongoDB database = database-per-service)
```

- **Synchronous** communication: Browser → Gateway → services (REST). Also
  Records Service → Appointment Service (validates the appointment when a doctor completes a
  record).
- **Asynchronous** communication: Appointment Service stores `appointment.booked` and
  `appointment.cancelled` in a MongoDB outbox, then publishes them to RabbitMQ; Records and
  Notification consume the events independently (fan-out).

See [`docs/architecture-mapping.md`](docs/architecture-mapping.md) for a component-by-component
mapping back to the CA01 diagrams.

---

## 2. Services

| Component            | Tech                | Port  | Database          | Responsibility |
|---------------------|---------------------|-------|-------------------|----------------|
| Frontend            | React (SPA) + nginx | 3000  | –                 | User interface |
| API Gateway         | Node.js / Express   | 8080  | –                 | Entry point, JWT, routing, rate limit |
| Auth Service        | Node.js / Express   | 4001* | `auth_db`         | Register, login, JWT, roles |
| Appointment Service | Node.js / Express   | 4002* | `appointment_db`  | Doctor search, booking, publishes events |
| Records Service     | Node.js / Express   | 4003* | `records_db`      | Consultation notes, e-prescriptions |
| Notification Service| Node.js / Express   | 4004* | `notification_db` | Booking confirmations (mock email/SMS) |
| MongoDB             | mongo:7             | 27017 | –                 | One database per service |
| RabbitMQ            | rabbitmq:3-mgmt     | 5672 / 15672 | –          | Event bus |

`*` Service ports are internal to the Docker network only – they are reachable **only through
the gateway**, which mirrors the CA01 design (single public entry point).

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

1. **Register a patient** → log in. (Auth Service, JWT issued.)
2. **Find a Doctor** → search by speciality/location → **Book** a slot.
   - The Appointment Service reserves the slot, records a *paid* (simulated) payment, and
     **publishes** `appointment.booked`.
   - In the RabbitMQ UI you can watch the message flow to two queues.
3. **My Appointments** → the booking appears as `booked` + `paid`.
4. **Notifications** → a confirmation appears (created asynchronously by the Notification
   Service from the event).
5. Open another browser/incognito and **log in with a provisioned doctor account**.
6. **Consultation Records** → the record for the booking is already there (auto-created by the
   Records Service from the same event). Add consultation notes and an optional prescription →
   **Complete record**.
   - The Records Service asks the Appointment Service to complete the active appointment before
     saving the record. If the Appointment Service is unavailable, the record remains pending.
7. Back as the **patient → My Records** → the prescription is now visible.

This one flow demonstrates: layered services, sync + async communication, database-per-service,
JWT security, and the full booking lifecycle.

---

## 5. Key API endpoints (all via the gateway, prefix `/api`)

| Method | Path | Auth | Service |
|--------|------|------|---------|
| POST | `/api/auth/register` | – | Auth |
| POST | `/api/auth/login` | – | Auth |
| GET  | `/api/doctors?speciality=&location=` | JWT | Appointment |
| POST | `/api/appointments` | JWT (patient) | Appointment |
| GET  | `/api/appointments/mine` | JWT | Appointment |
| POST | `/api/appointments/:id/cancel` | JWT (patient) | Appointment |
| POST | `/api/appointments/:id/complete` | JWT (doctor) | Appointment |
| GET  | `/api/appointments/doctor` | JWT (doctor) | Appointment |
| GET  | `/api/records/mine` | JWT | Records |
| GET  | `/api/records/doctor` | JWT (doctor) | Records |
| PUT  | `/api/records/:id` | JWT (doctor) | Records |
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
| Basic security | JWT auth, bcrypt password hashing, role-based access, gateway rate limiting |
| Deployment demonstration | `docker compose up` brings up all services + infra |
| Communication between components | REST via gateway (sync), Records→Appointment (sync), RabbitMQ events (async) |
| Architecture implementation | API Gateway + microservices + database-per-service + event bus (matches CA01) |

---

## 7. Notes & simplifications (prototype scope)

- **Payment** is simulated (always succeeds) – a real gateway integration is out of scope.
- The **doctor view** is scoped to the authenticated doctor's appointments and consultation
  records. Public self-registration always creates a patient account; doctor accounts are
  provisioned separately.
- MongoDB is used for every service (one logical database each) to keep the stack simple;
  the CA01 design also lists PostgreSQL for transactional data.
- Focus, per the module guidance, is on demonstrating the **architecture** rather than a
  production-grade implementation.

## 8. Event recovery and record rules

- A booking or cancellation is acknowledged only after its event is persisted in the
  Appointment Service outbox. The publisher retries RabbitMQ connections and deletes an outbox
  entry only after RabbitMQ confirms delivery.
- The Records and Notification consumers reconnect after broker outages. Their writes are
  idempotent, so redelivered events do not create duplicate records or notifications.
- Cancellation returns the slot to availability and emits an event that cancels the pending
  record and creates a patient notification.
- A doctor must enter consultation notes before completing a record. Completion also marks the
  appointment completed, preventing a later cancellation.
