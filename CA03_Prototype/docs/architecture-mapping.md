# Mapping the Prototype to the CA01 Architecture

This document links each part of the running prototype to the architecture and diagrams
proposed in the CA01 report, so the demonstration can be tied directly back to the design.

## 1. Architectural style

| CA01 decision | Prototype realisation |
|---------------|-----------------------|
| Microservices architecture | 4 independent Express services, each its own process/container |
| API Gateway as single entry point | `api-gateway/` – all client traffic routed through it |
| Database-per-service | Each service uses its own MongoDB database (`auth_db`, `appointment_db`, `records_db`, `notification_db`) |
| Event-driven backbone | RabbitMQ topic exchange `mediconnect.events`, events `appointment.booked` / `appointment.cancelled`, published via a transactional outbox |
| Layered organisation inside each service | `routes.js` (controller) → `controller.js` (business logic) → `model.js` (data access) |

## 2. CA01 diagram → prototype

### Context diagram
- **Patient / Doctor / Administrator** → user roles in the Auth Service. Patients self-register;
  doctor accounts are provisioned by the clinic (seeded), linked to their profile by email.
- **Payment Provider** → simulated inside the Appointment Service (`paymentStatus = 'paid'`).
- **Email/SMS Provider** → mocked by the Notification Service (logs the message).

### Architecture diagram (microservices)
| CA01 element | Prototype |
|--------------|-----------|
| Web App (React SPA) | `frontend/index.html` served by nginx |
| API Gateway / Load Balancer | `api-gateway/src/index.js` |
| Auth Service | `services/auth-service/` |
| Appointment Service | `services/appointment-service/` |
| Consultation + Prescription/EHR | `services/records-service/` |
| Notification Service | `services/notification-service/` |
| Message Broker (RabbitMQ) | `rabbitmq` container + `events.js` in each service (outbox relay in the Appointment Service) |
| Per-service databases | `mongodb` container, separate DB name per service |

### Component diagram (layered service)
The CA01 component diagram (Controller → Business Logic → Repository/Data Access → DB, plus an
Event Publisher) maps directly onto every service:

```
routes.js      -> REST Controller (API endpoints)
controller.js  -> Business Logic (validation, rules)
model(s).js    -> Repository / Data Access (Mongoose)
events.js      -> Event Publisher / Consumer (RabbitMQ)
```

### Deployment diagram
- CA01 shows containers on Kubernetes. The prototype uses **Docker Compose** as an equivalent
  local orchestration (`docker-compose.yml`): one container per service + MongoDB + RabbitMQ,
  with only the gateway and frontend exposed to the host.

### Class diagram
| CA01 entity | Prototype model |
|-------------|-----------------|
| User (Patient / Doctor) | `auth-service/model.js` (`role`) |
| Doctor, Clinic (fields) | `appointment-service/models.js` (Doctor) |
| Appointment | `appointment-service/models.js` (Appointment) |
| Consultation, Prescription | `records-service/model.js` (Record + prescription[]) |
| Payment (status) | Appointment `paymentStatus` field (simulated) |

### Data flow diagram (search → book → pay)
Implemented by `FindDoctor` (search) → `POST /appointments` (book + simulated pay) →
`appointment.booked` event (outbox → RabbitMQ) → Notification + Records consumers.
Cancellation follows the same path with `appointment.cancelled`. When the doctor completes the
consultation record, the Records Service synchronously asks the Appointment Service to move the
appointment `booked → completed` (the Appointment Service stays the single owner of appointment
state).

## 3. Quality attributes (as far as a prototype shows them)

| Attribute | Shown by |
|-----------|----------|
| Scalability | Independent stateless services; each could be replicated (Compose `--scale`) |
| Availability / fault isolation | A service crashing does not take down the others; gateway returns 502 for that route only; bookings still succeed while RabbitMQ is down (events wait in the outbox). Completing a record deliberately fails closed (503) if the Appointment Service is down – consistency over availability for clinical data |
| Security | JWT verification at the gateway, identity headers stripped from client requests, bcrypt hashing, role + ownership checks, rate limiting |
| Maintainability | Clear service boundaries + layered structure; one language/toolchain |
| Reliability | Transactional outbox + publisher confirms (no lost events); idempotent consumers; atomic slot reservation; durable exchange/queues; reconnect logic; ack/nack |
| Performance | Gateway routing; MongoDB indexing on unique fields; lightweight JSON APIs |
