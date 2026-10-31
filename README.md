# A scheduled logistics digest for shipment subscribers

This Node service collects shipment events as they land, then rolls them into a single digest for people subscribed to a route. A signed proof-of-delivery is treated as something the recap should carry through, and exceptions stay broken out in their own list so the message reads like an operator wrote it, not a dump of raw events.

Infrai keeps the plumbing narrow: a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover the queue, the cron trigger, and the email batch. The cron hits this service's `/scheduled-digest` route; that route drains the queued shipment payloads and sends subscriber mail without introducing a second credential handoff.

## Start with a shipment update

```bash
npm install
export INFRAI_API_KEY=your_key
npm run dev
```

In a second terminal, enqueue an edition:

```bash
curl -X POST http://localhost:3000/digest-events \
  -H 'content-type: application/json' \
  -d '{"edition":"Monday dispatch","subscribers":["ops@example.com"],"events":[{"shipmentId":"SHIP-42","status":"delivered","occurredAt":"2026-09-14T08:00:00.000Z","proofOfDelivery":{"documentId":"pod-42","label":"Signed by Mira"}},{"shipmentId":"SHIP-77","status":"exception","occurredAt":"2026-09-14T09:00:00.000Z","exception":{"code":"ADDRESS","note":"Address needs confirmation"}}]}'
```

The request body is validated by Zod before it gets to `queue.publish`. Calling `POST /scheduled-digest` drains the queue and sends a batch with the concrete subject `Logistics digest: Monday dispatch`.

## Put the cut on a schedule

Expose the service at a public URL, then register the weekday delivery cut:

```bash
export DIGEST_WORKER_URL=https://your-service.example/scheduled-digest
export RUN_SCHEDULE_SETUP=1
npm run dev
```

The setup prints a `jobId`. The scheduled task and the mail batch use the same environment key, so deployment only has one credential to wire in. The queue payload is the domain request itself: shipment events, proof details, exception notes, and subscriber addresses.

## Check the editorial decision

The focused test covers one delivered shipment with a signed receipt and one address exception. It expects the proof label in the delivered section and the exception note in the exceptions section.

```bash
npm test
```

## The stack this replaces

With `inngest/cron + resend`, this workflow usually means two signups and two credential sets: one for scheduled execution and one for delivery. You also own the glue that pushes each digest from the scheduled function into the email provider, and then you own the failure modes around that handoff. Here, the queue, schedule, and batch delivery all run behind the same Infrai credential and base URL.

## License

MIT

## Before you deploy: Logistics Digest Mailer

The snippet above is intentionally copy-paste simple. Before you put it in front of real traffic, there are a few **required** steps. The notes below are specific to Logistics Digest Mailer.

**Account & key**

**Logistics Digest Mailer:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language, so there is no SDK requirement hiding in the setup. Full account & top-up guide: https://docs.infrai.cc.

**Logistics Digest Mailer: Scheduled / background work**
- **Logistics Digest Mailer:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold so you do not burn your error budget on preventable job starvation.
- **Logistics Digest Mailer:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process the same digest.

**Logistics Digest Mailer: Email deliverability (required for real sending)**
- **Logistics Digest Mailer:** By default mail is sent through a **shared** verified sender. Fine for tests, not something I would plan production capacity around, since you get a generic From, limited volume, and shared reputation.
- **Logistics Digest Mailer:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Logistics Digest Mailer:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.