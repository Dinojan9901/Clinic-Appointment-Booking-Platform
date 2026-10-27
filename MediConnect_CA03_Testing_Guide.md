# MediConnect CA03 – Testing Guide

Please run the prototype on your machine and go through the checks below to confirm
everything works before we demo.

The changes are on **`main`**. They fix the weak points examiners are
likely to ask about in Q&A. In short:

- Identity headers can no longer be spoofed through the gateway.
- Events are no longer lost when RabbitMQ is down (transactional outbox).
- Two people can no longer book the same slot.
- Cancelling an appointment now notifies the other services.
- Doctors can't self-register, and each doctor only sees their own patients.
- Completing a record marks the appointment *completed*, so it can't be cancelled afterwards.
- If the Appointment Service is down, completing a record is refused instead of silently
  skipping the check.

The full explanation is in section 8 of `CA03_Prototype/README.md` ("Key design decisions").
**Please read it before the presentation**, because it doubles as our Q&A prep.

**Time needed:** about 30–40 minutes, including the first build.

---

## 1. Prerequisites

- **Docker Desktop**, running. Check with `docker info`.
- **Git**.
- **Internet access** the first time the page loads, because the React UI loads from a CDN.
- These ports must be free: **3000** (web app), **8090** (gateway), **15672** (RabbitMQ UI).

## 2. Get the code

If you haven't cloned the repo yet:

```bash
git clone https://github.com/Dinojan9901/Clinic-Appointment-Booking-Platform.git
cd Clinic-Appointment-Booking-Platform
```

If you already have it, get the latest `main` (if your `origin` is your own fork, pull from
Dinojan's repo as shown):

```bash
git checkout main
git pull https://github.com/Dinojan9901/Clinic-Appointment-Booking-Platform.git main
```

## 3. Start the stack (clean)

```bash
cd CA03_Prototype
docker compose down -v          # wipes old data – important, old data won't show for doctors
docker compose up --build -d
docker compose ps               # repeat until mongodb + rabbitmq say "(healthy)"
```

- The first build takes a few minutes.
- RabbitMQ can take **1–3 minutes** to become healthy, and the services start after it.
- To check readiness, run `docker compose logs appointment-service records-service notification-service`.
  You should see `listening on port ...` and `consuming ...appointment-events`.

Then open:

- **Web app:** http://localhost:3000
- **RabbitMQ UI:** http://localhost:15672 (`guest` / `guest`). Under *Queues* you should see
  `records.appointment-events` and `notifications.appointment-events`.

## 4. Accounts

**Patients:** register in the UI with any email. Password must be at least 6 characters.

**Doctors** (seeded – doctors can't self-register any more). The password for all of them is
**`doctor123`**:

| Doctor | Email | Speciality / City |
|--------|-------|-------------------|
| Dr. Anushka Perera | `anushka.perera@mediconnect.lk` | Cardiology, Colombo |
| Dr. Suresh Kumar | `suresh.kumar@mediconnect.lk` | Dermatology, Jaffna |
| Dr. Fathima Nazeer | `fathima.nazeer@mediconnect.lk` | Pediatrics, Kandy |
| Dr. Rajitha Silva | `rajitha.silva@mediconnect.lk` | Cardiology, Kandy |

**Tip:** use a normal window for the patient and an **incognito window** for the doctor. Both
sessions are stored in the browser, so one window can't be logged in as both.

---

## 5. Test checklist

Tick each one, and note anything that doesn't match the **Expected** column.

### A. Main flow

| # | Do this | Expected |
|---|---------|----------|
| A1 | Open **Register**. | There is **no "Register as doctor"** option. New accounts are patients. |
| A2 | Register patient **P1** and log in. | The *Find a Doctor* tab opens with 4 doctors. |
| A3 | Book a slot with **Dr. Anushka Perera**. | Green "Appointment booked..." message. The slot disappears from the list. |
| A4 | Open **My Appointments**. | The booking shows `booked` and `paid`, with a **Cancel** button. |
| A5 | Open **Notifications**. You may need to switch tabs to refresh. | A "confirmed" message appears within a few seconds. |
| A6 | In incognito, log in as **Anushka**. | *Appointments* shows P1's booking. *Consultation Records* shows a `pending` record. |
| A7 | In incognito, log in as **Suresh** instead. | P1's appointment and record are **not** visible. Doctors only see their own patients. |
| A8 | As **Anushka**, add notes and a medication, then click **Complete record**. | "Record completed and saved." |
| A9 | As **P1**, open **My Records**. | The notes and prescription are visible. |
| A10 | As **P1**, open **My Appointments**. | The appointment shows `completed`, and there is **no Cancel button**. |

### B. Cancellation

| # | Do this | Expected |
|---|---------|----------|
| B1 | As P1, book another Anushka slot, then **Cancel** it. | The status becomes `cancelled`. |
| B2 | Open **Find a Doctor**. | The cancelled slot is **available again**. |
| B3 | Open **Notifications**. | A "has been cancelled" message appears. |
| B4 | As Anushka, open **Consultation Records**. | That record shows `cancelled`: "The patient cancelled this appointment." There is no form. |

### C. Double booking

| # | Do this | Expected |
|---|---------|----------|
| C1 | Register patient **P2** in another browser and open *Find a Doctor*. Don't refresh. | — |
| C2 | As **P1**, book a slot with Dr. Rajitha Silva. Then, as **P2**, click the **same slot** on the stale page. | P2 gets **"selected slot is no longer available"**. Only one booking exists. |

### D. Security checks (PowerShell)

Run these in PowerShell while the stack is up.

```powershell
# D1 – trying to register as a doctor still creates a PATIENT (look for: role : patient)
Invoke-RestMethod -Method Post -Uri http://localhost:8090/api/auth/register -ContentType 'application/json' `
  -Body '{"name":"Hacker","email":"hacker1@test.lk","password":"secret1","role":"doctor"}'

# D2 – a forged identity header without a token is rejected (look for: 401 Unauthorized)
Invoke-WebRequest -Uri http://localhost:8090/api/auth/me -Headers @{ 'x-user-id' = 'someone-else' }
```

On macOS or Linux, use these instead:
`curl -X POST localhost:8090/api/auth/register -H 'Content-Type: application/json' -d '{"name":"Hacker","email":"hacker1@test.lk","password":"secret1","role":"doctor"}'`
and `curl -i localhost:8090/api/auth/me -H 'x-user-id: someone-else'`.

### E. Resilience (our best demo moments – please try these)

Run the commands from inside `CA03_Prototype/`.

| # | Do this | Expected |
|---|---------|----------|
| E1 | `docker compose stop rabbitmq`, then book an appointment as a patient. | Booking **still succeeds**. No notification yet: the event is waiting in the outbox. |
| E2 | `docker compose start rabbitmq`, then wait 1–3 minutes. | The confirmation **appears by itself**, and the doctor's record appears too. Nothing was lost. |
| E3 | Book an appointment and wait until the doctor sees the pending record. Then run `docker compose stop appointment-service`. As the doctor, click **Complete record**. | An error says *"cannot verify the appointment right now (Appointment Service unavailable)"*. The record stays `pending`. |
| E4 | `docker compose start appointment-service`, wait about 20 seconds, then click **Complete record** again. | It succeeds. |

---

## 6. Troubleshooting

| Problem | Fix |
|---------|-----|
| A port is already in use (3000, 8090 or 15672) | In `docker-compose.yml`, change the **left** number of that `ports:` entry, e.g. `"3001:80"`. |
| Blank white page | The page needs internet to load React from unpkg. Hard-refresh with Ctrl+F5. |
| *"Upstream service unavailable"* | That service is still starting. Check `docker compose ps` and `docker compose logs <service>`. |
| Doctors see nothing / old bookings look odd | Run `docker compose down -v` and then `docker compose up --build -d` for clean data. |
| RabbitMQ never becomes healthy | Run `docker compose logs rabbitmq` and send me the last ~30 lines. |
| Notifications don't appear | Check `docker compose logs notification-service`. It should say `consuming notifications.appointment-events`. |

When you're done: `docker compose down`. Add `-v` to also wipe the data.

## 7. Reporting back

Reply in the group with:

```
OS + Docker version:
Stack started OK?          yes / no (what failed)
A1–A10:  ✅ / ❌ (which, what happened)
B1–B4:   ✅ / ❌
C1–C2:   ✅ / ❌
D1–D2:   ✅ / ❌
E1–E4:   ✅ / ❌
Anything confusing in the UI or README:
```

For any ❌, please include a screenshot or the output of `docker compose logs <service>`.

**If you make any changes, don't push them to `main`.** Push them to a separate branch
(e.g. `git checkout -b fix/<your-name>`, then `git push origin fix/<your-name>`) and let me
know, so I can review them before they're merged.
