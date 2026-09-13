import { describe, expect, it } from "vitest";
import { createTankPartyCode, partyPeerIdFromCode } from "./useTankParty";

describe("tank party invitation codes", () => {
  it("creates a readable six-character code", () => {
    expect(createTankPartyCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("converts a short invitation code into its PeerJS id", () => {
    expect(partyPeerIdFromCode(" ab3k9z ")).toBe("bt3d-ab3k9z");
  });

  it("keeps legacy full PeerJS ids working", () => {
    expect(partyPeerIdFromCode("legacy-peer-id-123")).toBe("legacy-peer-id-123");
  });
});
