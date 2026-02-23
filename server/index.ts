import { Server, Socket } from "socket.io";

interface PlayerRecord {
  playerId: string;
  name: string;
  balance: number;
  wins: number;
  losses: number;
}

interface RoomSeat {
  seatIndex: 0 | 1;
  playerId: string;
  socketId: string | null;
  ready: boolean;
  bet: number;
  peerId?: string;
}

interface RoomState {
  seats: [RoomSeat | null, RoomSeat | null];
  status: 'waiting' | 'flipping' | 'result';
}

interface SeatView {
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

interface RoomStateView {
  seats: [SeatView | null, SeatView | null];
  status: 'waiting' | 'flipping' | 'result';
  timestamp: number;
}

const ADJECTIVES = ['Crazy', 'Sneaky', 'Bold', 'Lucky', 'Sly', 'Wild', 'Calm', 'Iron', 'Swift', 'Bright'];
const NOUNS = ['Fox', 'Bear', 'Wolf', 'Eagle', 'Shark', 'Tiger', 'Hawk', 'Raven', 'Lynx', 'Otter'];

function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

const io = new Server({
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 30000,
  pingInterval: 10000,
});

const playerRecords = new Map<string, PlayerRecord>();
const rooms = new Map<string, RoomState>();
const socketToSeat = new Map<string, { roomId: string; seatIndex: 0 | 1 }>();
const roomEmptyTime = new Map<string, number>();

function buildRoomView(room: RoomState): RoomStateView {
  return {
    seats: room.seats.map(seat => {
      if (!seat) return null;
      const playerRecord = playerRecords.get(seat.playerId)!;
      return {
        seatIndex: seat.seatIndex,
        playerId: seat.playerId,
        name: playerRecord.name,
        balance: playerRecord.balance,
        wins: playerRecord.wins,
        losses: playerRecord.losses,
        ready: seat.ready,
        bet: seat.bet,
        online: seat.socketId !== null,
        peerId: seat.peerId,
      };
    }) as [SeatView | null, SeatView | null],
    status: room.status,
    timestamp: Date.now(),
  };
}

io.on("connection", (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join_room", ({ roomId, playerId, peerId }: { roomId: string; playerId: string; peerId: string }) => {
    console.log(`join_room event received - roomId: ${roomId}, playerId: ${playerId}, peerId: ${peerId}, socketId: ${socket.id}`);

    // Get or create PlayerRecord
    if (!playerRecords.has(playerId)) {
      playerRecords.set(playerId, {
        playerId,
        name: generateName(),
        balance: 10000,
        wins: 0,
        losses: 0,
      });
    }

    // Get or create RoomState
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { seats: [null, null], status: 'waiting' });
    }

    const room = rooms.get(roomId)!;

    // Check if playerId already has a seat in this room (reconnect path)
    let existingSeat = room.seats.find(seat => seat && seat.playerId === playerId);
    if (existingSeat) {
      // Reconnect: update socketId and peerId
      existingSeat.socketId = socket.id;
      existingSeat.peerId = peerId;
      socketToSeat.set(socket.id, { roomId, seatIndex: existingSeat.seatIndex });
      socket.join(roomId);
      console.log(`Player ${playerId} reconnected to room ${roomId}, seat ${existingSeat.seatIndex}`);
      // Cancel cleanup since room is no longer empty
      roomEmptyTime.delete(roomId);
      io.to(roomId).emit("room_state", buildRoomView(room));
      return;
    }

    // Find first available seat
    let seatIndex: 0 | 1 | null = null;
    if (room.seats[0] === null) seatIndex = 0;
    else if (room.seats[1] === null) seatIndex = 1;

    if (seatIndex === null) {
      console.log(`Room ${roomId} is full, rejecting player ${playerId}`);
      socket.emit("join_rejected", { reason: "Room is full" });
      return;
    }

    // Assign seat
    const newSeat: RoomSeat = {
      seatIndex,
      playerId,
      socketId: socket.id,
      ready: false,
      bet: 0,
      peerId,
    };
    room.seats[seatIndex] = newSeat;
    socketToSeat.set(socket.id, { roomId, seatIndex });

    socket.join(roomId);
    console.log(`Player ${playerId} joined room ${roomId}, seat ${seatIndex}`);
    io.to(roomId).emit("room_state", buildRoomView(room));
  });

  socket.on("toggle_ready", ({ roomId, bet }: { roomId: string; bet: number }) => {
    const seatLocation = socketToSeat.get(socket.id);
    if (!seatLocation) return;

    const room = rooms.get(seatLocation.roomId);
    if (!room) return;

    const seat = room.seats[seatLocation.seatIndex];
    if (!seat) return;

    // Toggle ready state
    seat.ready = !seat.ready;
    if (seat.ready) {
      seat.bet = bet;
      const player = playerRecords.get(seat.playerId)!;
      console.log(`Player ${player.name} (${seat.playerId}) ready with bet ${bet} in room ${roomId}, seat ${seat.seatIndex}`);
    } else {
      seat.bet = 0;
      const player = playerRecords.get(seat.playerId)!;
      console.log(`Player ${player.name} (${seat.playerId}) cancelled ready in room ${roomId}`);
    }

    // Check if both seats occupied and both ready
    const [seat0, seat1] = room.seats;
    if (seat0 && seat1 && seat0.ready && seat1.ready) {
      // Validate bets are equal
      if (seat0.bet !== seat1.bet) {
        seat0.ready = false;
        seat0.bet = 0;
        seat1.ready = false;
        seat1.bet = 0;
        io.to(seatLocation.roomId).emit("room_state", buildRoomView(room));
        return;
      }

      // Validate balances can cover bets
      const player0 = playerRecords.get(seat0.playerId)!;
      const player1 = playerRecords.get(seat1.playerId)!;
      if (player0.balance < seat0.bet || player1.balance < seat1.bet) {
        seat0.ready = false;
        seat0.bet = 0;
        seat1.ready = false;
        seat1.bet = 0;
        io.to(seatLocation.roomId).emit("room_state", buildRoomView(room));
        return;
      }

      // Both ready, valid bets, and sufficient balance - start flip
      room.status = 'flipping';
      const winnerSeatIndex = Math.random() > 0.5 ? 0 : 1;
      const winnerSeat = room.seats[winnerSeatIndex]!;
      const winner = playerRecords.get(winnerSeat.playerId)!;
      const loserSeatIndex = 1 - winnerSeatIndex;
      const loserSeat = room.seats[loserSeatIndex]!;
      const loser = playerRecords.get(loserSeat.playerId)!;
      const betAmount = seat0.bet;

      console.log(`FLIP in room ${roomId}: ${winner.name} vs ${loser.name}, bet ${betAmount}`);
      io.to(seatLocation.roomId).emit("start_flip", { winnerId: winner.playerId, winnerName: winner.name });

      setTimeout(() => {
        // Update balances and stats
        winner.balance += betAmount;
        loser.balance -= betAmount;
        winner.wins += 1;
        loser.losses += 1;

        console.log(`OUTCOME in room ${roomId}: ${winner.name} WINS! (+${betAmount}) vs ${loser.name} (-${betAmount})`);
        console.log(`  ${winner.name}: balance ${winner.balance}, wins ${winner.wins}`);
        console.log(`  ${loser.name}: balance ${loser.balance}, losses ${loser.losses}`);

        // Reset seats
        seat0.ready = false;
        seat0.bet = 0;
        seat1.ready = false;
        seat1.bet = 0;
        room.status = 'waiting';

        io.to(seatLocation.roomId).emit("room_state", buildRoomView(room));
      }, 3500);
    } else {
      io.to(seatLocation.roomId).emit("room_state", buildRoomView(room));
    }
  });

  socket.on("set_balance", ({ playerId, roomId, balance }: { playerId: string; roomId: string; balance: number }) => {
    const playerRecord = playerRecords.get(playerId);
    if (playerRecord) {
      playerRecord.balance = balance;
      const room = rooms.get(roomId);
      if (room) {
        io.to(roomId).emit("room_state", buildRoomView(room));
      }
    }
  });

  socket.on("disconnect", () => {
    const seatLocation = socketToSeat.get(socket.id);
    if (!seatLocation) return;

    socketToSeat.delete(socket.id);

    const room = rooms.get(seatLocation.roomId);
    if (!room) return;

    const seat = room.seats[seatLocation.seatIndex];
    if (!seat) return;

    // Mark seat as offline but keep it reserved
    seat.socketId = null;
    seat.ready = false;
    seat.bet = 0;

    console.log(`Player disconnected from room ${seatLocation.roomId}, seat ${seatLocation.seatIndex}`);

    // Check if both players are now offline
    const bothOffline = room.seats[0]?.socketId === null && room.seats[1]?.socketId === null;
    if (bothOffline && !roomEmptyTime.has(seatLocation.roomId)) {
      roomEmptyTime.set(seatLocation.roomId, Date.now());
      console.log(`Room ${seatLocation.roomId} is now empty, will be cleaned up in 2 minutes`);
    }

    io.to(seatLocation.roomId).emit("room_state", buildRoomView(room));
  });
});

// Periodically broadcast room state and clean up empty rooms
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    io.to(roomId).emit("room_state", buildRoomView(room));

    // Clean up rooms that have been empty for 2 minutes
    const emptyTime = roomEmptyTime.get(roomId);
    if (emptyTime && Date.now() - emptyTime > 2 * 60 * 1000) {
      rooms.delete(roomId);
      roomEmptyTime.delete(roomId);
      console.log(`Cleaned up empty room ${roomId}`);
    }
  }
}, 2000);

io.listen(3001);
console.log("Coinflip Server running on port 3001");
