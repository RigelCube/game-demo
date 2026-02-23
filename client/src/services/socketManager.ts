import { Socket, io } from "socket.io-client";

const BET_SERVER_URL = process.env.BUN_PUBLIC_BET_SERVER_URL;

export class SocketManager {
  private static instance: Socket | null = null;

  static getInstance(): Socket {
    if (!SocketManager.instance) {
      SocketManager.instance = io(BET_SERVER_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 2000,
        reconnectionAttempts: Infinity,
      });

      SocketManager.instance.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
      });
    }

    return SocketManager.instance;
  }

  static joinRoom(roomId: string, playerId: string, peerId: string) {
    SocketManager.getInstance().emit("join_room", {
      roomId,
      playerId,
      peerId,
    });
  }

  static toggleReady(roomId: string, bet: number) {
    SocketManager.getInstance().emit("toggle_ready", { roomId, bet });
  }

  static setBalance(playerId: string, roomId: string, balance: number) {
    SocketManager.getInstance().emit("set_balance", { playerId, roomId, balance });
  }

  static onRoomState(callback: (state: any) => void) {
    SocketManager.getInstance().on("room_state", callback);
  }

  static onStartFlip(callback: (data: any) => void) {
    SocketManager.getInstance().on("start_flip", callback);
  }

  static onJoinRejected(callback: (data: any) => void) {
    SocketManager.getInstance().on("join_rejected", callback);
  }

  static onConnect(callback: () => void) {
    SocketManager.getInstance().on("connect", callback);
  }

  static onDisconnect(callback: () => void) {
    SocketManager.getInstance().on("disconnect", callback);
  }

  static onReconnect(callback: () => void) {
    SocketManager.getInstance().on("reconnect", callback);
  }

  static getId(): string | undefined {
    return SocketManager.getInstance().id;
  }

  static isConnected(): boolean {
    return SocketManager.getInstance().connected;
  }
}

export const socket = SocketManager.getInstance();
