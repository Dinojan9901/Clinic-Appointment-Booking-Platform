# MediConnect CA03 v2 – Testing Guide

The prototype now implements the remaining CA01 functional requirements. Please run it and go
through the checks below before the evaluation. The code is on the branch **`dev/final`**.

## What's new

- **Payment Service** (from the CA01 architecture diagram) with its own database. Booking works
  as a **Saga**: the slot is *held* → the patient pays with a test card → the booking is
  confirmed. Unpaid holds expire, and cancelling a paid booking triggers a **refund**. Payments
  are simulated, so no money moves.
- **Admin portal:**
  - verify doctor sign-ups
  - manage users and clinics
  - view all payments
  - an activity/audit log built from every event
  - live health of all services
- **Doctor onboarding:** doctors register themselves and can only log in after an admin
  approves their licence.
- **Patients** can **reschedule**, **rate & review** doctors after a visit, and download PDF
  **receipts**. They also get **reminders**.
- **Prescriptions** are **digitally signed** (Ed25519) and downloadable as a PDF with a QR code.
  A public page lets a pharmacy verify the signature.
- **Doctors** manage their own slots and can see a patient's **history**. Every history view is
  audited.
- **Infrastructure:**
  - **Redis** caches doctor search.
  - **Mailpit** is a local inbox where you can read every email the system sends.
  - Services can be **scaled** (`--scale`).
  - **GitHub Actions CI** builds and tests everything on every push.
- **Fixed:** the retry-queue bug from the last review. A failing message no longer duplicates
  or loops; it goes to a dead-letter queue after 5 attempts.

Read sections 7 and 8 of `CA03_Prototype/README.md` before the presentation. They explain the
design decisions and are our Q&A prep.

**Time needed:** about 45 minutes. The first build takes 5–10 minutes.

---

## 1. Setup

```bash
git fetch origin
git checkout dev/final
git pull origin dev/final
cd CA03_Prototype
docker compose down -v          # REQUIRED: the database layout changed
docker compose up --build -d
node tests/wait-ready.js        # optional (needs Node 18+): waits until everything is healthy
```

If you don't have Node, wait until `docker compose ps` shows `mongodb`, `rabbitmq` and `redis`
as **healthy**, then give it another minute.

| Open | What |
|------|------|
| http://localhost:3000 | Web app |
| http://localhost:8025 | **Mailpit**: every email the system sends |
| http://localhost:15672 | RabbitMQ UI (`guest` / `guest`) |

**Accounts:**

| Role | Login |
|------|-------|
| Admin | `admin@mediconnect.lk` / `admin123` |
| Doctors (password `doctor123`) | `anushka.perera@mediconnect.lk`, `suresh.kumar@mediconnect.lk`, `fathima.nazeer@mediconnect.lk`, `rajitha.silva@mediconnect.lk` |
| Patients | register in the UI |

**Tip:** use a separate browser or incognito window for each role. Logins are stored in the
browser, so two roles in the same window would overwrite each other.

**Test cards** (shown in the checkout):

| Card number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | approved |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 9995` | insufficient funds |

---

## 2. Quick automated check (5 minutes, needs Node 18+)

```bash
node tests/e2e.js
```

It runs about 70 checks through the gateway and should end with **`… passed, 0 failed`**.
Please paste the last lines into the group. Then do the manual checks below, because they test
the UI.

---

## 3. Manual checklist

### A. Booking and payment (patient)

| # | Do this | Expected |
|---|---------|----------|
| A1 | Register a patient, open **Find a Doctor**, and filter by **Clinic**. | The list filters. Slots are grouped by day for the next 5 days. |
| A2 | Click a slot. | A toast says the slot is held. **Checkout** opens with a countdown. |
| A3 | Click **declined**, then **Pay**. | Red "payment declined". The checkout stays open. |
| A4 | Click **approved**, then **Pay**. | "Payment approved… Confirming" turns into **"Your appointment is confirmed"** within a few seconds. |
| A5 | Open **My Appointments**. | `booked` and `paid` with a receipt number, plus **Reschedule** and **Cancel** buttons. |
| A6 | Open **Payments** and click **Receipt**. | A PDF receipt downloads. |
| A7 | Open **Notifications**, and **Mailpit**. | Hold, declined and confirmed messages appear in both places. A red unread counter shows on the tab. |
| A8 | Book another slot and click **Pay later**. In My Appointments, use **Pay now**. | The countdown shows, and Pay now opens the checkout. |

### B. Doctor

| # | Do this | Expected |
|---|---------|----------|
| B1 | Log in as the doctor you booked with. | **Appointments** shows the paid booking. Unpaid holds are not shown. |
| B2 | Open **Consultation Records**, add notes and **2 medications**, then **Complete & sign**. | "Record completed and prescription digitally signed". The badge shows `completed`. |
| B3 | Click **Patient history**. | A modal lists the patient's completed visits. |
| B4 | Open **My Schedule**, publish a slot, then click a slot to withdraw it. | The slot appears in patient search immediately, then disappears again. |
| B5 | Log in as a *different* doctor. | Patients of the first doctor are **not** visible. |

### C. Prescription and after the visit (patient)

| # | Do this | Expected |
|---|---------|----------|
| C1 | Open **My Records** and click **Download prescription (PDF)**. | A PDF with the medications, a QR code and the signature. |
| C2 | Click **Verify RX-…**, or scan the QR code. | A green **"Valid prescription – digital signature verified"**. No login is needed. |
| C3 | In **My Appointments**, click **Rate your visit**, give 4 stars and submit. | "Thanks for your feedback". The doctor's rating updates in Find a Doctor. |
| C4 | Reschedule a booked appointment. | The slot changes, the old slot becomes free, and the doctor's record shows the new date. |
| C5 | Cancel a **paid** appointment. | A "refund is being processed" toast. **Payments** shows `refunded`, and a refund email arrives. |
| C6 | Try to cancel a **completed** visit. | No Cancel button (the API refuses it). |

### D. Doctor onboarding and admin

| # | Do this | Expected |
|---|---------|----------|
| D1 | Use **Join as doctor**: fill in licence, speciality, clinic and fee. | "Registration received…". Mailpit shows the email. |
| D2 | Try to log in as that doctor. | "awaiting admin verification". |
| D3 | As admin, open **Doctor Verification** and click **Verify & approve**. | The doctor can now log in. After publishing slots, they appear in patient search. |
| D4 | As admin, open **Users** and **Disable** a doctor. | The doctor can't log in and disappears from patient search. **Enable** restores both. |
| D5 | As admin, open **Clinics** and add a clinic. | It appears in the clinic filter and in the doctor sign-up form. |
| D6 | Check the admin **Dashboard**, **Payments** and **Activity Log**. | Stats, all services `up`, payment totals, and a feed of events, including `ehr.accessed`. |

### E. Resilience and architecture demos (good for the presentation)

| # | Do this | Expected |
|---|---------|----------|
| E1 | Run `docker compose stop rabbitmq`, then book **and pay**. | Both still succeed. The booking stays `pending payment` because the event is waiting in the outbox. |
| E2 | Run `docker compose start rabbitmq` and wait 1–3 minutes. | The booking becomes **booked**, and the notification and email arrive. Nothing was lost. |
| E3 | Run `docker compose down`, then start with a 1-minute hold: `HOLD_MINUTES=1 docker compose up -d` (in PowerShell: `$env:HOLD_MINUTES=1; docker compose up -d`). Book a slot and don't pay. | After about 1–1.5 minutes the booking shows `expired`, the slot is free again, and the patient is notified. |
| E4 | Run `docker compose stop appointment-service`. As a doctor, click **Complete & sign**. | "cannot verify the appointment right now (Appointment Service unavailable)". Then `docker compose start appointment-service`. |
| E5 | Run `docker compose up -d --scale appointment-service=3`. | The admin Dashboard's health table shows a changing **Instance** ID. In the browser DevTools Network tab, the `X-Served-By` header changes between requests. |
| E6 | Search the same doctors twice. | The second response has the header `X-Cache: HIT` (the Redis cache). |

### F. Security (PowerShell)

```powershell
# F1 - trying to register as admin still creates a PATIENT (look for: role : patient)
Invoke-RestMethod -Method Post -Uri http://localhost:8090/api/auth/register -ContentType 'application/json' `
  -Body '{"name":"Hacker","email":"hacker2@test.lk","password":"secret1","role":"admin"}'

# F2 - a forged identity header without a token is rejected (look for: 401)
Invoke-WebRequest -Uri http://localhost:8090/api/auth/me -Headers @{ 'x-user-id' = 'x'; 'x-user-role' = 'admin' }
```

---

## 4. Troubleshooting

| Problem | Fix |
|---------|-----|
| Strange old data, login problems, or MongoDB index errors | Run `docker compose down -v` and then `docker compose up --build -d`. The database layout changed. |
| A port is already in use (3000, 8090, 8025, 15672) | Change the **left** number in that `ports:` entry in `docker-compose.yml`. |
| Booking stays "confirming" or no emails arrive | RabbitMQ is still starting. Check `docker compose ps` and wait for `rabbitmq` to be **healthy**. |
| Blank page | The UI loads React from a CDN, so it needs internet. Hard-refresh with Ctrl+F5. |
| *"Upstream service unavailable"* | That service is still starting. Run `docker compose logs <service>`. |

When you're done, run `docker compose down`. Add `-v` to also wipe the data.

## 5. Reporting back

```
OS + Docker version:
tests/e2e.js result (last line):
A1–A8:  ✅ / ❌ (which, what happened)
B1–B5:  ✅ / ❌
C1–C6:  ✅ / ❌
D1–D6:  ✅ / ❌
E1–E6:  ✅ / ❌
F1–F2:  ✅ / ❌
Anything confusing in the UI:
```

For any ❌, add a screenshot or the output of `docker compose logs <service>`.

**If you change any code, push it to a separate branch (for example `fix/<your-name>`), not to
`dev/final` or `main`, and tell me so I can review it first.**
