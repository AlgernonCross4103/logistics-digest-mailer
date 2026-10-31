export type ShipmentEvent = {
  shipmentId: string;
  status: "in_transit" | "delivered" | "exception";
  occurredAt: string;
  proofOfDelivery?: { documentId: string; label: string };
  exception?: { code: string; note: string };
};

export type Digest = { subject: string; html: string };

export function composeShipmentDigest(events: ShipmentEvent[], edition: string): Digest {
  const delivered = events.filter((event) => event.status === "delivered");
  const exceptions = events.filter((event) => event.status === "exception");
  const deliveryLines = delivered.map((event) => {
    const proof = event.proofOfDelivery ? `; proof: ${event.proofOfDelivery.label}` : "";
    return `<li>${event.shipmentId} delivered${proof}</li>`;
  });
  const exceptionLines = exceptions.map((event) => `<li>${event.shipmentId}: ${event.exception?.note ?? "needs review"}</li>`);
  return {
    subject: `Logistics digest: ${edition}`,
    html: `<h1>${edition}</h1><h2>Delivered (${delivered.length})</h2><ul>${deliveryLines.join("")}</ul><h2>Exceptions (${exceptions.length})</h2><ul>${exceptionLines.join("")}</ul>`
  };
}
