import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Peer } from "peerjs";

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
}

const FRONT_SERVER_URL = process.env.BUN_PUBLIC_FRONT_SERVER_URL;
const BET_SERVER_URL = process.env.BUN_PUBLIC_BET_SERVER_URL
const RTC_SERVER_HOST = process.env.BUN_PUBLIC_RTC_SERVER_HOST
const RTC_SERVER_PORT = process.env.BUN_PUBLIC_RTC_SERVER_PORT as any as number;

function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function getOrCreatePlayerId(): string {
  let id = localStorage.getItem('playerId');
  if (!id) {
    id = generateRandomId();
    localStorage.setItem('playerId', id);
  }
  return id;
}

const MY_PLAYER_ID = getOrCreatePlayerId();

const socket: Socket = io(BET_SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
});

socket.on("connect_error", (error) => {
  console.error("Socket connection error:", error);
});

function getRoomIdFromPath(): string {
  const pathname = window.location.pathname;
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] || '';
}

export function App() {
  if(
    BET_SERVER_URL === undefined ||
    RTC_SERVER_HOST === undefined ||
    RTC_SERVER_PORT === undefined
  ) {
    throw new Error("undefined");
  }
  const [joined, setJoined] = useState(false);
  const [roomId] = useState<string>(() => {
    const pathRoomId = getRoomIdFromPath();
    if (!pathRoomId) {
      const randomId = generateRandomId();
      window.history.replaceState(null, '', `/${randomId}`);
      return randomId;
    }
    return pathRoomId;
  });
  const [roomState, setRoomState] = useState<RoomStateView | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [mySeatIndex, setMySeatIndex] = useState<0 | 1 | null>(null);
  const [bet, setBet] = useState(10);
  const [lastResult, setLastResult] = useState<{ winnerId: string; winnerName: string } | null>(null);

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const autoJoinedRef = useRef(false);

  useEffect(() => {
    // 1. Setup PeerJS for WebRTC
    const peer = new Peer({ host: RTC_SERVER_HOST, port: RTC_SERVER_PORT, path: '/' });
    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("My Peer ID:", id);

      // Auto-join if we have a roomId from the URL
      const pathRoomId = getRoomIdFromPath();
      if (pathRoomId && !autoJoinedRef.current) {
        // Ensure socket is connected before emitting
        const attemptJoin = () => {
          console.log("Attempt join - socket.connected:", socket.connected);
          if (socket.connected) {
            console.log("Emitting join_room for room:", pathRoomId);
            socket.emit("join_room", { roomId: pathRoomId, playerId: MY_PLAYER_ID, peerId: id });
            autoJoinedRef.current = true;
          } else {
            console.log("Socket not connected yet, retrying...");
            setTimeout(attemptJoin, 100);
          }
        };
        attemptJoin();

        // Start camera
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
          if (myVideoRef.current) myVideoRef.current.srcObject = stream;
        }).catch((err) => console.error("Error accessing media devices:", err));
      }
    });

    peer.on("call", (call) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        call.answer(stream);
        call.on("stream", (remoteStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        });
      });
    });

    // 2. Socket Listeners
    socket.on("room_state", (state: RoomStateView) => {
      console.log("Received room_state:", state);
      setRoomState(state);
      setIsFlipping(false);

      // Find my seat by playerId
      const mySeat = state.seats.find(seat => seat && seat.playerId === MY_PLAYER_ID);
      if (mySeat) {
        setMySeatIndex(mySeat.seatIndex);
        setJoined(true);
      }

      // Auto-call opponent if they have a peerId and we don't have a stream yet
      const opponentSeat = state.seats.find(seat => seat && seat.playerId !== MY_PLAYER_ID);
      if (opponentSeat?.peerId && !remoteVideoRef.current?.srcObject) {
        startVideoCall(opponentSeat.peerId);
      }
    });

    socket.on("start_flip", ({ winnerId, winnerName }: { winnerId: string; winnerName: string }) => {
      console.log("start_flip:", winnerId, winnerName);
      setIsFlipping(true);
      setLastResult({ winnerId, winnerName });
    });

    socket.on("join_rejected", ({ reason }: { reason: string }) => {
      console.error("Join rejected:", reason);
      alert(`Join rejected: ${reason}`);
    });

    // Reset autoJoinedRef on reconnect so we can rejoin
    socket.on("reconnect", () => {
      autoJoinedRef.current = false;
    });

    return () => {
      socket.off("room_state");
      socket.off("start_flip");
      socket.off("join_rejected");
      socket.off("reconnect");
      peer.destroy();
    };
  }, []);

  const startVideoCall = (remotePeerId: string) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      const call = peerRef.current?.call(remotePeerId, stream);
      call?.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });
    });
  };

  if (!joined || !roomState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#1a1a1a] text-white">
        <div className="text-center">
          <div className="text-2xl mb-4">Connecting to room...</div>
          <div className="text-gray-400">{roomId}</div>
        </div>
      </div>
    );
  }

  const mySeat = roomState.seats[mySeatIndex!] as SeatView;
  const opponentSeat = roomState.seats[1 - mySeatIndex!] as SeatView | null;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-8">
      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Local Video */}
        <div className="relative bg-black rounded-xl overflow-hidden aspect-video border-2 border-blue-500">
          <video ref={myVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <div className="absolute bottom-2 left-2 text-xs bg-blue-600 px-2 py-1 rounded">
            P{mySeat.seatIndex + 1} • {mySeat.name}
          </div>
          <div className="absolute bottom-2 right-2 text-xs bg-blue-600 px-2 py-1 rounded">
            💰 {mySeat.balance} • W:{mySeat.wins} L:{mySeat.losses}
          </div>
        </div>

        {/* Remote Video */}
        <div className={`relative bg-black rounded-xl overflow-hidden aspect-video border-2 ${opponentSeat?.online ? 'border-red-500' : 'border-gray-600'}`}>
          <video ref={remoteVideoRef} autoPlay playsInline className={`w-full h-full object-cover ${opponentSeat?.online ? '' : 'opacity-50'}`} />
          {opponentSeat ? (
            <>
              <div className="absolute bottom-2 left-2 text-xs bg-red-600 px-2 py-1 rounded">
                P{opponentSeat.seatIndex + 1} • {opponentSeat.name}
              </div>
              <div className="absolute bottom-2 right-2 text-xs bg-red-600 px-2 py-1 rounded">
                💰 {opponentSeat.balance} • W:{opponentSeat.wins} L:{opponentSeat.losses}
              </div>
              {!opponentSeat.online && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                  <div className="text-xl font-bold">DISCONNECTED</div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
              <div className="text-xl font-bold">WAITING FOR OPPONENT...</div>
            </div>
          )}
        </div>
      </div>

      <div className="text-center">
        <div className="text-4xl mb-8">
          {isFlipping ? "🪙 SPINNING..." : lastResult ? `${lastResult.winnerName} WINS!` : "READY?"}
        </div>

        {roomState.status === 'waiting' && !mySeat.ready && (
          <div className="mb-6 flex justify-center gap-4">
            <div>
              <label className="block text-sm mb-2">Bet Amount</label>
              <input
                type="number"
                min="1"
                max={mySeat.balance}
                value={bet}
                onChange={(e) => setBet(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-center"
              />
            </div>
          </div>
        )}

        <button
          onClick={() => socket.emit("toggle_ready", { roomId, bet })}
          disabled={isFlipping}
          className={`text-2xl font-black px-12 py-4 rounded-full transition-all ${
            mySeat.ready
              ? 'bg-red-500'
              : 'bg-green-500 hover:scale-105'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {mySeat.ready ? "CANCEL" : "READY"}
        </button>
      </div>
    </div>
  );
}
