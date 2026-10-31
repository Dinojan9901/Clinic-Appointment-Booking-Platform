# Mapping the Prototype to the CA01 Architecture

This document links each part of the running prototype to the architecture, diagrams and
requirements of the CA01 report, so the demonstration can be tied directly back to the design.

## 1. Architectural style

| CA01 decision | Prototype realisation |
|---------------|-----------------------|
| Microservices architecture | 6 independent Express services, each its own image/container, independently scalable |
| API Gateway as single entry point | `api-gateway/` – JWT, routing, Redis-backed rate limiting, admin guard |
| Database-per-service | `auth_db`, `appointment_db`, `records_db`, `notification_db`, `payment_db`, `admin_db` |
| Event-driven backbone | RabbitMQ topic exchange `mediconnect.events`; every service publishes through a transactional outbox (`common/messaging.js`) |
| Layered organisation inside each service | routes (controller) → business logic → Mongoose models (repository) → messaging |

## 2. CA01 diagram → prototype

### Context diagram
| CA01 actor / system | Prototype |
|---------------------|-----------|
| Patient | self-registers; searches, holds, pays, reschedules, cancels, rates, downloads prescriptions |
| Doctor | self-registers (pending) → verified by admin; manages slots, records visits, signs prescriptions |
| Administrator | seeded admin; verifies doctors, manages users and clinics, monitors activity and health |
| Payment Provider | simulated provider inside the Payment Service (`provider.js`, test cards) |
| Email/SMS Provider | SMTP to **Mailpit** (real emails, local inbox); SMS logged |
| Pharmacy / Lab systems | public prescription verification API + QR code on the PDF (NFR-09 interoperability) |

### Architecture diagram (microservices)
| CA01 element | Prototype |
|--------------|-----------|
| Web App (React SPA) | `frontend/` (index.html + `js/*.js`) served by nginx |
| API Gateway / Load Balancer | `api-gateway/src/index.js` (round-robins across scaled replicas) |
| Auth Service | `services/auth-service/` |
| Appointment Service | `services/appointment-service/` |
| Consultation Service + Prescription/EHR | `services/records-service/` |
| Payment Service + Pay DB | `services/payment-service/` + `payment_db` |
| Notification Service | `services/notification-service/` |
| Message Broker | `rabbitmq` container + `common/messaging.js` |
| Auth / Appt / EHR / Pay DBs | `mongodb` container, one database per service |
| (monitoring – FR-10 / NFR-07) | `services/admin-service/` – audit log + stats + health |

### Component diagram (layered service)
```
routes.js                         -> REST Controller (API endpoints)
appointments.js / controller.js   -> Business Logic (scheduling, validation, Saga steps)
models.js / model.js              -> Repository / Data Access (Mongoose)
events.js + common/messaging.js   -> Event Publisher (outbox relay) / Consumer (retry, DLQ)
cache.js                          -> Redis cache (Appointment Service)
```

### Deployment diagram
CA01 shows containers on Kubernetes with replicas. The prototype uses **Docker Compose**:
12 containers (6 services, gateway, frontend, MongoDB, RabbitMQ, Redis, Mailpit); stateless
services can be replicated with `docker compose up --scale appointment-service=3`, and GitHub
Actions builds and tests the whole deployment on every push (CI/CD row of the CA01 stack).

### Class diagram
| CA01 entity | Prototype model |
|-------------|-----------------|
| User / Patient / Doctor | `auth-service/model.js` (`role`, `doctorStatus`, `doctorProfile`) + doctor profile in `appointment-service/models.js` |
| Clinic | `appointment-service/models.js` (Clinic) |
| Appointment | `appointment-service/models.js` (Appointment, with status lifecycle) |
| Consultation, Prescription (`signedBy`) | `records-service/model.js` (Record, prescription[], signature) |
| Payment (amount, status) | `payment-service/model.js` (Payment) |
| (Rating & feedback, FR-09) | `appointment-service/models.js` (Review) |

### Data flow diagram (search → book → pay)
1.0 **Search**: `GET /doctors` (Redis cache → Doctor store).
2.0 **Book**: `POST /appointments` atomically takes the slot and stores a `pending_payment`
appointment + `appointment.created` event (Appointment store).
3.0 **Pay**: `POST /payments` checks the hold synchronously, charges the provider, stores the
Payment and `payment.succeeded` (Payment store) → the Appointment Service confirms the booking
and emits `appointment.booked` → Records and Notification react.

## 3. Requirements → implementation

| CA01 requirement | Prototype |
|------------------|-----------|
| FR-01 Registration & authentication | patient/doctor sign-up, admin verification, JWT, disabled accounts blocked |
| FR-02 Search | speciality, location, clinic filters; availability; ratings |
| FR-03 Book / reschedule / cancel | hold → pay → booked; reschedule; cancel with automatic refund |
| FR-04 Consultation record | created from `appointment.booked`, completed by the doctor |
| FR-05 E-prescription (signed, downloadable) | Ed25519 signature, PDF with QR, public verification |
| FR-06 EHR | patient history for treating doctors, audited |
| FR-07 Payment + receipt | Payment Service, receipts (PDF), refunds |
| FR-08 Confirmations & reminders | Notification Service, email via Mailpit, reminder scheduler |
| FR-09 Rating & feedback | reviews after completed visits |
| FR-10 Administration | admin portal: doctors, users, clinics, payments, activity, health |
| NFR-05 transactional consistency | Saga with compensations, outbox, atomic conditional updates, idempotency keys |
| NFR-07 audit logging | every event recorded by the Admin Service; EHR access events |

## 4. Quality attributes

| Attribute | Shown by |
|-----------|----------|
| Scalability | Stateless services, `--scale` replicas, shared Redis rate limit + cache, gateway round-robin |
| Performance | Redis cache-aside for search (`X-Cache: HIT/MISS`), indexes on lookup fields |
| Security | JWT + RBAC + ownership checks, spoof-proof identity headers, admin guard, bcrypt, doctor verification, signed prescriptions, no card data stored, audit log |
| Availability | Fault isolation per service; bookings and payments keep working while RabbitMQ is down; health dashboard |
| Reliability | Outbox + publisher confirms, idempotent consumers, retry + dead-letter queues, Saga compensations, hold expiry |
| Maintainability | Clear service boundaries, shared `common/` library, automated end-to-end tests and CI |
