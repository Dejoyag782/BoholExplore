import { useCallback, useEffect, useRef, useState } from "react";
import type { DataConnection, Peer } from "peerjs";
import {
  createTankPlayer,
  IDLE_TANK_INPUT,
  stepTankBattle,
  type TankInput,
  type TankPlayer,
  type TankTerrainElevation,
} from "../game/tankPvp";
import { ensureTankModelCached } from "../game/tankModelCache";

type PartyStatus = "idle" | "downloading" | "connecting" | "hosting" | "joined" | "error";
type ClientMessage =
  | { type: "join"; name: string }
  | { type: "input"; input: TankInput };
type HostMessage = { type: "snapshot"; players: TankPlayer[] };

const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PARTY_CODE_LENGTH = 6;
const PARTY_PEER_PREFIX = "bt3d-";
const PARTY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const TANK_SNAPSHOT_INTERVAL_MS = 33;

export const createTankPartyCode = () => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(PARTY_CODE_LENGTH));
  return Array.from(
    randomBytes,
    (value) => PARTY_CODE_ALPHABET[value % PARTY_CODE_ALPHABET.length]
  ).join("");
};

export const partyPeerIdFromCode = (value: string) => {
  const trimmed = value.trim();
  const shortCode = trimmed.toUpperCase();
  if (PARTY_CODE_PATTERN.test(shortCode)) {
    return `${PARTY_PEER_PREFIX}${shortCode.toLowerCase()}`;
  }
  return trimmed;
};

const displayCodeFromPeerId = (peerId: string) =>
  peerId.toLowerCase().startsWith(PARTY_PEER_PREFIX)
    ? peerId.slice(PARTY_PEER_PREFIX.length).toUpperCase()
    : peerId;

const isTankInput = (value: unknown): value is TankInput => {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<TankInput>;
  return (
    typeof input.forward === "number" &&
    typeof input.turn === "number" &&
    typeof input.firing === "boolean"
  );
};

const clientMessage = (value: unknown): ClientMessage | null => {
  if (!value || typeof value !== "object") return null;
  const message = value as { type?: unknown; name?: unknown; input?: unknown };
  if (message.type === "join" && typeof message.name === "string") {
    return { type: "join", name: message.name };
  }
  if (message.type === "input" && isTankInput(message.input)) {
    return {
      type: "input",
      input: {
        forward: Math.max(-1, Math.min(1, message.input.forward)),
        turn: Math.max(-1, Math.min(1, message.input.turn)),
        firing: message.input.firing,
      },
    };
  }
  return null;
};

const hostMessage = (value: unknown): HostMessage | null => {
  if (!value || typeof value !== "object") return null;
  const message = value as { type?: unknown; players?: unknown };
  return message.type === "snapshot" && Array.isArray(message.players)
    ? { type: "snapshot", players: message.players as TankPlayer[] }
    : null;
};

export const useTankParty = (
  active: boolean,
  origin: [number, number],
  terrainElevation?: TankTerrainElevation
) => {
  const [status, setStatus] = useState<PartyStatus>("idle");
  const [partyCode, setPartyCode] = useState("");
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [players, setPlayers] = useState<TankPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const hostConnectionRef = useRef<DataConnection | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const playersRef = useRef<TankPlayer[]>([]);
  const inputsRef = useRef<Map<string, TankInput>>(new Map());
  const localInputRef = useRef<TankInput>(IDLE_TANK_INPUT);
  const operationRef = useRef(0);
  const originRef = useRef(origin);
  const terrainElevationRef = useRef(terrainElevation);
  originRef.current = origin;
  terrainElevationRef.current = terrainElevation;

  const publishPlayers = useCallback((next: TankPlayer[]) => {
    playersRef.current = next;
    setPlayers(next);
    const snapshot: HostMessage = { type: "snapshot", players: next };
    connectionsRef.current.forEach((connection) => {
      if (connection.open) connection.send(snapshot);
    });
  }, []);

  const leaveParty = useCallback(() => {
    operationRef.current += 1;
    hostConnectionRef.current?.close();
    connectionsRef.current.forEach((connection) => connection.close());
    connectionsRef.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    hostConnectionRef.current = null;
    playersRef.current = [];
    inputsRef.current.clear();
    setPlayers([]);
    setPartyCode("");
    setLocalPeerId(null);
    setIsHost(false);
    setError(null);
    setStatus("idle");
  }, []);

  const createParty = useCallback(async (name: string) => {
    leaveParty();
    const operation = operationRef.current;
    setStatus("downloading");
    try {
      await ensureTankModelCached();
      if (operationRef.current !== operation) return;
      setStatus("connecting");
      const { Peer: PeerClient } = await import("peerjs");
      if (operationRef.current !== operation) return;
      const partyCode = createTankPartyCode();
      const peer = new PeerClient(partyPeerIdFromCode(partyCode));
      peerRef.current = peer;
      peer.on("open", (id) => {
        if (operationRef.current !== operation) {
          peer.destroy();
          return;
        }
        const host = createTankPlayer(id, name, originRef.current, 0);
        setLocalPeerId(id);
        setPartyCode(partyCode);
        setIsHost(true);
        setStatus("hosting");
        inputsRef.current.set(id, localInputRef.current);
        publishPlayers([host]);
      });
      peer.on("connection", (connection) => {
        connectionsRef.current.set(connection.peer, connection);
        connection.on("data", (data) => {
          const message = clientMessage(data);
          if (!message) return;
          if (message.type === "join") {
            if (!playersRef.current.some((player) => player.id === connection.peer)) {
              const player = createTankPlayer(
                connection.peer,
                message.name,
                originRef.current,
                playersRef.current.length
              );
              inputsRef.current.set(connection.peer, IDLE_TANK_INPUT);
              publishPlayers([...playersRef.current, player]);
            }
            return;
          }
          inputsRef.current.set(connection.peer, message.input);
        });
        connection.on("close", () => {
          connectionsRef.current.delete(connection.peer);
          inputsRef.current.delete(connection.peer);
          publishPlayers(playersRef.current.filter((player) => player.id !== connection.peer));
        });
      });
      peer.on("error", (peerError) => {
        if (operationRef.current !== operation) return;
        setError(peerError.message || "Could not create party");
        setStatus("error");
      });
    } catch (cause) {
      if (operationRef.current !== operation) return;
      setError(cause instanceof Error ? cause.message : "PeerJS failed to load");
      setStatus("error");
    }
  }, [leaveParty, publishPlayers]);

  const joinParty = useCallback(async (code: string, name: string) => {
    const hostId = partyPeerIdFromCode(code);
    if (!hostId) return;
    leaveParty();
    const operation = operationRef.current;
    setPartyCode(displayCodeFromPeerId(hostId));
    setStatus("downloading");
    try {
      await ensureTankModelCached();
      if (operationRef.current !== operation) return;
      setStatus("connecting");
      const { Peer: PeerClient } = await import("peerjs");
      if (operationRef.current !== operation) return;
      const peer = new PeerClient();
      peerRef.current = peer;
      peer.on("open", (id) => {
        if (operationRef.current !== operation) {
          peer.destroy();
          return;
        }
        setLocalPeerId(id);
        const connection = peer.connect(hostId, { reliable: true });
        hostConnectionRef.current = connection;
        connection.on("open", () => {
          if (operationRef.current !== operation) return;
          connection.send({ type: "join", name } satisfies ClientMessage);
          setStatus("joined");
        });
        connection.on("data", (data) => {
          const message = hostMessage(data);
          if (message) {
            playersRef.current = message.players;
            setPlayers(message.players);
          }
        });
        connection.on("close", () => {
          setError("The host ended the party");
          setStatus("error");
        });
        connection.on("error", (connectionError) => {
          setError(connectionError.message || "Could not join the host");
          setStatus("error");
        });
      });
      peer.on("error", (peerError) => {
        if (operationRef.current !== operation) return;
        setError(peerError.message || "Could not connect to party");
        setStatus("error");
      });
    } catch (cause) {
      if (operationRef.current !== operation) return;
      setError(cause instanceof Error ? cause.message : "PeerJS failed to load");
      setStatus("error");
    }
  }, [leaveParty]);

  const setInput = useCallback((input: TankInput) => {
    localInputRef.current = input;
    const localId = peerRef.current?.id;
    if (localId && inputsRef.current.has(localId)) inputsRef.current.set(localId, input);
    const connection = hostConnectionRef.current;
    if (connection?.open) connection.send({ type: "input", input } satisfies ClientMessage);
  }, []);

  useEffect(() => {
    if (!active) leaveParty();
  }, [active, leaveParty]);

  useEffect(() => leaveParty, [leaveParty]);

  useEffect(() => {
    if (!active || !isHost || status !== "hosting") return;
    let frame = 0;
    let previous = performance.now();
    let lastBroadcast = 0;
    const tick = (now: number) => {
      const next = stepTankBattle(
        playersRef.current,
        inputsRef.current,
        (now - previous) / 1000,
        terrainElevationRef.current
      );
      previous = now;
      playersRef.current = next;
      if (now - lastBroadcast >= TANK_SNAPSHOT_INTERVAL_MS) {
        publishPlayers(next);
        lastBroadcast = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, isHost, publishPlayers, status]);

  return {
    status,
    partyCode,
    localPeerId,
    players,
    playersRef,
    error,
    isHost,
    createParty,
    joinParty,
    leaveParty,
    setInput,
  };
};
