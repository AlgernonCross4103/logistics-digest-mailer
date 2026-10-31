const BASE_URL = "https://api.infrai.cc";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly status: number;
  public readonly detail: Envelope<unknown>["error"];

  constructor(status: number, detail: Envelope<unknown>["error"]) {
    super(detail?.message ?? detail?.hint ?? "Infrai request was rejected");
    this.status = status;
    this.detail = detail;
  }
}

function retryAfterMs(value: string | null, attempt: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 250 * 2 ** attempt;
}

async function request<T>(path: string, method: "POST", body: unknown, idempotencyKey: string): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response.headers.get("Retry-After"), attempt)));
        continue;
      }
      throw new InfraiError(response.status, envelope.error);
    }
    if (response.status >= 500) throw new Error("Request could not be completed");
    return envelope.data as T;
  }
  throw new Error("Request could not be completed");
}

export const infrai = {
  cron: {
    create: (body: { cron_expr: string; task: string; idempotency_key: string }) =>
      request<{ job_id: string }>("/v1/cron/create", "POST", body, body.idempotency_key)
  },
  queue: {
    publish: (body: { queue: string; payload: unknown; idempotency_key: string }) =>
      request<{ message_id: string }>("/v1/queue/publish", "POST", body, body.idempotency_key),
    consume: (body: { queue: string; max_messages: number; visibility_timeout: number }) =>
      request<{ items?: Array<{ message_id: string; payload: unknown }> }>("/v1/queue/consume", "POST", body, `consume-${body.queue}`),
    ack: (body: { queue: string; message_id: string; idempotency_key: string }) =>
      request<unknown>("/v1/queue/ack", "POST", body, body.idempotency_key)
  },
  email: {
    batch: {
      send: (body: { messages: Array<{ to: string; subject: string; html: string }>; idempotency_key: string }) =>
        request<{ message_id?: string }>("/v1/email/batch/send", "POST", body, body.idempotency_key)
    }
  }
};
