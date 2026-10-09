# Mapping the Prototype to the CA01 Architecture

This document links each part of the running prototype to the architecture and diagrams
proposed in the CA01 report, so the demonstration can be tied directly back to the design.

## 1. Architectural style

| CA01 decision | Prototype realisation |
|---------------|-----------------------|
| Microservices architecture | 4 independent Express services, each its own process/container |
| API Gateway as single entry point | `api-gateway/` – all client traffic routed through it |
| Database-per-service | Each service uses its own MongoDB database (`auth_db`, `appointment_db`, `records_db`, `notification_db`) |
| Event-driven backbone | MongoDB outbox + RabbitMQ topic exchange `mediconnect.events`, events `appointment.booked` and `appointment.cancelled` |
| Layered organisation inside each service | `routes.js` (controller) → `controller.js` (business logic) → `model.js` (data access) |

## 2. CA01 diagram → prototype

### Context diagram
- **Patient / Doctor / Administrator** → patient self-registration and privileged accounts provisioned separately.
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
| Message Broker (RabbitMQ) | `rabbitmq` container + `events.js` in each service |
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
`appointment.booked` event → Notification + Records consumers. Cancellation publishes
`appointment.cancelled` through the same outbox and updates both services.

## 3. Quality attributes (as far as a prototype shows them)

| Attribute | Shown by |
|-----------|----------|
| Scalability | Independent stateless services; each could be replicated (Compose `--scale`) |
| Availability / fault isolation | A service crashing does not take down the others; gateway returns 502 for that route only |
| Security | JWT verification at the gateway, bcrypt hashing, role checks, rate limiting |
| Maintainability | Clear service boundaries + layered structure; one language/toolchain |
| Reliability | MongoDB outbox; durable RabbitMQ exchange/queues; reconnect, publisher confirms, idempotent consumers, message ack/nack |
| Performance | Gateway routing; MongoDB indexing on unique fields; lightweight JSON APIs |
