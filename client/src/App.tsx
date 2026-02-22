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
  timestamp: number;
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
  reconnectionDelayMax: 2000,
  reconnectionAttempts: Infinity
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
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [showDebug, setShowDebug] = useState(false);
  const [socketEvents, setSocketEvents] = useState<Array<{ time: string; event: string }>>([]);
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
    const peer = new Peer({ host: RTC_SERVER_HOST, port: RTC_SERVER_PORT, 
      secure: true
    });
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
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: "room_state" }]);
      setRoomState(state);
      // Only clear flipping when status returns to waiting
      if (state.status === 'waiting') {
        setIsFlipping(false);
      }

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
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: "start_flip" }]);
      setIsFlipping(true);
      setLastResult({ winnerId, winnerName });
    });

    socket.on("join_rejected", ({ reason }: { reason: string }) => {
      console.error("Join rejected:", reason);
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: `join_rejected: ${reason}` }]);
      alert(`Join rejected: ${reason}`);
    });

    // Re-join room on reconnect to sync state
    socket.on("reconnect", () => {
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: "reconnect" }]);
      setIsConnected(true);
      setIsFlipping(false);
      setLastResult(null);
      setRoomState(null);
      setMySeatIndex(null);
      setBet(10);
      if (peerRef.current?.id && roomId) {
        socket.emit("join_room", { roomId, playerId: MY_PLAYER_ID, peerId: peerRef.current.id });
      }
    });

    socket.on("connect", () => {
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: "connect" }]);
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event: "disconnect" }]);
      setIsConnected(false);
    });

    return () => {
      socket.off("room_state");
      socket.off("start_flip");
      socket.off("join_rejected");
      socket.off("reconnect");
      socket.off("connect");
      socket.off("disconnect");
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
    <div className="fixed inset-0 bg-[#0f0f0f] text-white flex flex-col overflow-hidden">
      {/* Reconnecting Overlay */}
      {!isConnected && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="text-center">
            <div className="text-2xl font-bold mb-4">Reconnecting...</div>
            <div className="animate-spin inline-block w-8 h-8 border-4 border-gray-600 border-t-white rounded-full"></div>
          </div>
        </div>
      )}

      {/* Opponent Video (Top 0–45%) */}
      <div className="relative w-full overflow-hidden" style={{ height: '45dvh' }}>
        <video ref={remoteVideoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover ${opponentSeat?.online ? '' : 'opacity-50'}`} />
        {opponentSeat && (
          <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded text-sm font-bold">
            {opponentSeat.name}
          </div>
        )}
        {opponentSeat ? (
          !opponentSeat.online && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-2xl font-bold">DISCONNECTED</div>
            </div>
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-xl font-bold">WAITING FOR OPPONENT...</div>
          </div>
        )}
      </div>

      {/* Middle Controls (45–55%) */}
      <div className="flex flex-col justify-center items-center px-4 gap-1 overflow-hidden" style={{ height: '10dvh' }}>
        {/* Player Info Row */}
        <div className="flex justify-between items-start w-full text-xs">
          <div className="flex-1">
            {opponentSeat && (
              <>
                <div className="font-bold truncate">{opponentSeat.name}</div>
                <div className="text-gray-400">💰 {opponentSeat.balance} • W:{opponentSeat.wins} L:{opponentSeat.losses}</div>
                <div className="text-gray-500">{opponentSeat.ready ? '✓ READY' : '○ NOT READY'}</div>
              </>
            )}
          </div>

          {/* Game Status + Controls */}
          <div className="flex-1 flex flex-col items-center justify-center gap-1 px-2">
            {isFlipping ? (
              <div className="text-lg font-bold text-center">🪙 SPINNING...</div>
            ) : mySeat.ready ? (
              <>
                <div className="text-lg font-bold text-center">READY?</div>
                <button
                  onClick={() => socket.emit("toggle_ready", { roomId, bet })}
                  className="font-black px-5 py-1 rounded-full text-sm bg-red-500"
                >
                  CANCEL
                </button>
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-center">
                  {lastResult ? `${lastResult.winnerName} WINS!` : "READY?"}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={mySeat.balance}
                    value={bet}
                    onChange={(e) => setBet(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-center text-sm"
                  />
                  <button
                    onClick={() => socket.emit("toggle_ready", { roomId, bet })}
                    className="font-black px-5 py-1 rounded-full text-sm bg-green-500"
                  >
                    READY
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 text-right">
            <div className="font-bold truncate">{mySeat.name}</div>
            <div className="text-gray-400">💰 {mySeat.balance} • W:{mySeat.wins} L:{mySeat.losses}</div>
            <div className="text-gray-500">{mySeat.ready ? '✓ READY' : '○ NOT READY'}</div>
          </div>
        </div>
      </div>

      {/* My Video (Bottom 55–100%) */}
      <div className="relative w-full overflow-hidden" style={{ height: '45dvh' }}>
        <video ref={myVideoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-2 rounded text-sm font-bold">
          {mySeat.name}
        </div>
      </div>

      {/* Debug Panel */}
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white px-3 py-2 rounded text-xs font-bold z-40"
      >
        {showDebug ? '✕' : '⚙'}
      </button>

      {showDebug && (
        <div className="fixed bottom-16 right-4 bg-black/95 border border-gray-600 rounded w-64 max-h-80 overflow-hidden flex flex-col z-40">
          <div className="bg-gray-800 px-3 py-2 font-bold text-xs">Socket Events</div>
          <div className="flex-1 overflow-y-auto p-2 text-xs font-mono">
            <div className={`mb-1 ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
              Status: {isConnected ? 'Connected' : 'Disconnected'}
            </div>
            <div className="text-gray-300 mb-1 truncate">
              ID: {MY_PLAYER_ID}
            </div>
            <div className="text-gray-300 mb-1 truncate">
              Room: {roomId}
            </div>
            <div className="text-gray-300 mb-1 truncate">
              Status: {roomState?.status || 'unknown'}
            </div>
            <div className="text-gray-300 mb-2 truncate text-xs">
              TS: {roomState?.timestamp ? new Date(roomState.timestamp).toLocaleTimeString() + '.' + (roomState.timestamp % 1000) : 'none'}
            </div>
            <div className="text-gray-400 mb-2 border-t border-gray-700 pt-2">
              {socketEvents.length === 0 ? 'No events' : socketEvents.map((e, i) => (
                <div key={i} className="text-gray-300">
                  <span className="text-gray-500">{e.time}</span> {e.event}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
