/** The most calendar days between the two bookings of a transfer that is paired automatically. */
export const automaticPairingDays = 3;

/** The most calendar days between the two bookings a person is offered to link. */
export const manualLinkDays = 14;

/** Two bookings that could be the outgoing and incoming side of one transfer: opposite amounts in the same currency on two own accounts within the pairing window. */
export type PairingCandidate = {
  outgoingId: string;
  incomingId: string;
};

/**
 * The candidates that are paired automatically: only those whose outgoing and incoming booking each have exactly one candidate. Any ambiguity leaves all bookings involved unpaired until someone links them.
 */
export function unambiguousPairs(candidates: PairingCandidate[]): PairingCandidate[] {
  const unique = new Map<string, PairingCandidate>();

  for (const candidate of candidates) {
    unique.set(`${candidate.outgoingId}\u0000${candidate.incomingId}`, candidate);
  }

  const edges = [...unique.values()];
  const degree = new Map<string, number>();

  for (const edge of edges) {
    degree.set(edge.outgoingId, (degree.get(edge.outgoingId) ?? 0) + 1);
    degree.set(edge.incomingId, (degree.get(edge.incomingId) ?? 0) + 1);
  }

  return edges.filter(edge => degree.get(edge.outgoingId) === 1 && degree.get(edge.incomingId) === 1);
}
