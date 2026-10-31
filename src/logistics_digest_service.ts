import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { composeShipmentDigest, type ShipmentEvent } from "./digest_decision.ts";
import { InfraiError, infrai } from "./infrai_mailroom.ts";

const ShipmentEventSchema = z.object({
  shipmentId: z.string().min(1),
  status: z.enum(["in_transit", "delivered", "exception"]),
  occurredAt: z.string().datetime(),
  proofOfDelivery: z.object({ documentId: z.string(), label: z.string() }).optional(),
  exception: z.object({ code: z.string(), note: z.string() }).optional()
});

const DigestRequestSchema = z.object({
  edition: z.string().min(1),
  subscribers: z.array(z.string().email()).min(1),
  events: z.array(ShipmentEventSchema).min(1)
});

type DigestRequest = z.infer<typeof DigestRequestSchema>;
const queue = process.env.DIGEST_QUEUE ?? "logistics-digest-events";

function requestId(): string {
  return randomUUID();
}

async function enqueueDigest(input: DigestRequest): Promise<void> {
  await infrai.queue.publish({ queue, payload: input, idempotency_key: requestId() });
}

async function sendQueuedDigests(): Promise<number> {
  const batch = await infrai.queue.consume({ queue, max_messages: 10, visibility_timeout: 60 });
  const items = batch.items ?? [];
  for (const item of items) {
    const input = DigestRequestSchema.parse(item.payload);
    const digest = composeShipmentDigest(input.events as ShipmentEvent[], input.edition);
    await infrai.email.batch.send({
      messages: input.subscribers.map((to) => ({ to, subject: digest.subject, html: digest.html })),
      idempotency_key: requestId()
    });
    await infrai.queue.ack({ queue, message_id: item.message_id, idempotency_key: requestId() });
  }
  return items.length;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

function reply(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/digest-events") {
      const input = DigestRequestSchema.parse(await readJson(request));
      await enqueueDigest(input);
      return reply(response, 202, { accepted: true });
    }
    if (request.method === "POST" && request.url === "/scheduled-digest") {
      return reply(response, 200, { delivered: await sendQueuedDigests() });
    }
    return reply(response, 404, { error: "route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) return reply(response, 400, { error: error.issues });
    if (error instanceof InfraiError) return reply(response, error.status < 500 ? error.status : 502, { error: error.message });
    return reply(response, 500, { error: "unexpected request error" });
  }
});

export async function scheduleDigest(task: string): Promise<string> {
  const job = await infrai.cron.create({ cron_expr: "0 16 * * 1-5", task, idempotency_key: requestId() });
  return job.job_id;
}

if (process.env.RUN_SCHEDULE_SETUP === "1") {
  const task = process.env.DIGEST_WORKER_URL;
  if (!task) throw new Error("Set DIGEST_WORKER_URL to the public scheduled-digest URL");
  scheduleDigest(task).then((jobId) => console.log(JSON.stringify({ jobId })));
} else {
  server.listen(Number(process.env.PORT ?? 3000), () => console.log("listening on http://localhost:3000"));
}
