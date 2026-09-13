import type { Command, RoomState } from "./protocol";

export interface CloudRoomState extends RoomState {
  playerClientId: string | null;
  leaseUntil: number;
  /** Query evaluation time; cached results are not suitable for clock synchronization. */
  serverNow: number;
  ackSequence: number;
}

export interface CloudSetup {
  roomId: string;
  pin: string;
  pinExpiresAt: number;
  playerClientId: string | null;
  leaseUntil: number;
}

export interface CloudCommand {
  sequence: number;
  command: Command;
  expiresAt: number;
  clientId: string;
}

export const PLAYER_LEASE_MS = 45_000;
export const CONTROLLER_PRESENCE_MS = 30_000;
export const CONTROLLER_GRANT_MS = 12 * 60 * 60 * 1000;
export const PAIRING_PIN_MS = 10 * 60 * 1000;
export const COMMAND_TTL_MS = 5_000;
