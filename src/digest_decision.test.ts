import test from "node:test";
import assert from "node:assert/strict";
import { composeShipmentDigest } from "./digest_decision.ts";

test("digest separates proof-backed deliveries from exceptions", () => {
  const digest = composeShipmentDigest([
    { shipmentId: "SHIP-42", status: "delivered", occurredAt: "2026-09-14T08:00:00.000Z", proofOfDelivery: { documentId: "pod-42", label: "Signed by Mira" } },
    { shipmentId: "SHIP-77", status: "exception", occurredAt: "2026-09-14T09:00:00.000Z", exception: { code: "ADDRESS", note: "Address needs confirmation" } }
  ], "Monday cut");

  assert.equal(digest.subject, "Logistics digest: Monday cut");
  assert.match(digest.html, /SHIP-42 delivered; proof: Signed by Mira/);
  assert.match(digest.html, /SHIP-77: Address needs confirmation/);
});
