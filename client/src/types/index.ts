export interface SeatView {
  seatIndex: 0 | 1;
  playerId: string;
  name: string;
  balance: number;
  wins: number;
  losses: number;
  ready: boolean;
  bet: number;
  online: boolean;
  peerId?: string;
}

export interface RoomStateView {
  seats: [SeatView | null, SeatView | null];
  status: 'waiting' | 'flipping' | 'result';
  timestamp: number;
}

export interface SocketEvent {
  time: string;
  event: string;
}

export interface GameResult {
  winnerId: string;
  winnerName: string;
}
