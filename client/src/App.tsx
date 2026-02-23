import { useState, useEffect, useRef, memo } from "react";
import { Peer } from "peerjs";
import type { SeatView, RoomStateView, GameResult } from "./types";
import { socket } from "./services/socketManager";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Environment variables
const BET_SERVER_URL = process.env.BUN_PUBLIC_BET_SERVER_URL;
const RTC_SERVER_HOST = process.env.BUN_PUBLIC_RTC_SERVER_HOST;
const RTC_SERVER_PORT = process.env.BUN_PUBLIC_RTC_SERVER_PORT as any as number;
const TURN_URLS = process.env.BUN_PUBLIC_TURN_URLS || '';
const TURN_USERNAME = process.env.BUN_PUBLIC_TURN_USERNAME;
const TURN_CREDENTIAL = process.env.BUN_PUBLIC_TURN_CREDENTIAL;

// Constants
const VIDEO_CONSTRAINTS = {
  video: { width: { max: 640 }, height: { max: 480 }, frameRate: { max: 25 } },
  audio: true
};
const HEARTBEAT_INTERVAL = 2500;
const HEARTBEAT_TIMEOUT = 4000;
const UI_TEXT = {
  CONNECTING: 'Connecting to room...',
  WAITING_OPPONENT: 'WAITING FOR OPPONENT...',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'Reconnecting...',
  READY: '✓ READY',
  NOT_READY: '○ NOT READY',
  READY_PROMPT: 'READY?',
  SPINNING: '🪙 SPINNING...',
  WINS: 'WINS!',
};

// Helpers
async function getLocalStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
}

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

function getRoomIdFromPath(): string {
  const pathname = window.location.pathname;
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] || '';
}

interface DebugPanelProps {
  showDebug: boolean;
  setShowDebug: (show: boolean) => void;
  isConnected: boolean;
  socketId: string | undefined;
  peerId: string;
  roomId: string;
  gameStatus: string;
  lastUpdate: number | undefined;
  events: Array<{ time: string; event: string }>;
}

const DebugPanel = memo(function DebugPanel({ showDebug, setShowDebug, isConnected, socketId, peerId, roomId, gameStatus, lastUpdate, events }: DebugPanelProps) {
  return (
    <>
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white px-3 py-2 rounded text-xs font-bold z-40"
      >
        {showDebug ? '✕' : '⚙'}
      </button>

      {showDebug && (
        <div className="fixed bottom-16 right-4 bg-black/95 border border-gray-600 rounded w-72 max-h-96 overflow-hidden flex flex-col z-40">
          <div className="bg-gray-800 px-3 py-2 font-bold text-xs">Socket Debug</div>
          <div className="flex-1 overflow-y-auto p-2 text-xs font-mono">
            <div className={`mb-1 p-1 rounded ${isConnected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              🔌 {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
            <div className="text-gray-400 mb-2 text-xs">
              Socket ID: {socketId || 'none'}
            </div>
            <div className="text-gray-300 mb-1 truncate">
              Player: {MY_PLAYER_ID.substring(0, 12)}...
            </div>
            <div className="text-gray-300 mb-1 truncate">
              WebRTC: {peerId.substring(0, 12) || 'connecting'}...
            </div>
            <div className="text-gray-300 mb-1 truncate">
              Room: {roomId}
            </div>
            <div className="text-gray-300 mb-1 truncate">
              Game: {gameStatus || 'unknown'}
            </div>
            <div className="text-gray-400 mb-2 text-xs border-t border-gray-700 pt-2">
              Last update: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'never'}
            </div>
            <div className="text-gray-400 mb-2 border-t border-gray-700 pt-2">
              {events.length === 0 ? 'No events' : events.map((e, i) => (
                <div key={i} className="text-gray-300">
                  <span className="text-gray-500">{e.time}</span> {e.event}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

interface RemoteVideoPanelProps {
  opponentSeat: SeatView | null;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
}

const RemoteVideoPanel = memo(function RemoteVideoPanel({ opponentSeat, remoteVideoRef }: RemoteVideoPanelProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height: '45dvh' }}>
      <video ref={remoteVideoRef} autoPlay muted playsInline className={`absolute inset-0 w-full h-full object-cover ${opponentSeat?.online ? '' : 'opacity-50'}`} />
      {opponentSeat && (
        <div className="absolute top-4 left-4 bg-black/70 px-3 py-2 rounded text-sm font-bold">
          {opponentSeat.name}
        </div>
      )}
      {opponentSeat ? (
        !opponentSeat.online && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-2xl font-bold">{UI_TEXT.DISCONNECTED}</div>
          </div>
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-xl font-bold">{UI_TEXT.WAITING_OPPONENT}</div>
        </div>
      )}
    </div>
  );
});

interface LocalVideoPanelProps {
  mySeat: SeatView;
  myVideoRef: React.RefObject<HTMLVideoElement | null>;
}

const LocalVideoPanel = memo(function LocalVideoPanel({ mySeat, myVideoRef }: LocalVideoPanelProps) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height: '45dvh' }}>
      <video ref={myVideoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
      <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-2 rounded text-sm font-bold">
        {mySeat.name}
      </div>
    </div>
  );
});

interface GameControlsProps {
  isFlipping: boolean;
  mySeat: SeatView;
  lastResult: { winnerId: string; winnerName: string } | null;
  bet: number;
  setBet: (bet: number) => void;
  roomId: string;
  opponentSeat: SeatView | null;
}

const GameControls = memo(function GameControls({ isFlipping, mySeat, lastResult, bet, setBet, roomId, opponentSeat }: GameControlsProps) {
  return (
    <div className="flex flex-col justify-center items-center px-4 gap-1 overflow-hidden" style={{ height: '10dvh' }}>
      <div className="flex justify-between items-start w-full text-xs">
        <div className="flex-1">
          {opponentSeat && (
            <>
              <div className="font-bold truncate">{opponentSeat.name}</div>
              <div className="text-gray-400">💰 {opponentSeat.balance} • W:{opponentSeat.wins} L:{opponentSeat.losses}</div>
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-1 px-2">
          {isFlipping ? (
            <div className="text-lg font-bold text-center">{UI_TEXT.SPINNING}</div>
          ) : mySeat.ready ? (
            <>
              <div className="text-lg font-bold text-center">{UI_TEXT.READY_PROMPT}</div>
              <button
                onClick={() => socket.emit("toggle_ready", { roomId, bet: 0 })}
                className="font-black px-5 py-1 rounded-full text-sm bg-red-500"
              >
                CANCEL
              </button>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-center">
                {lastResult ? `${lastResult.winnerName} ${UI_TEXT.WINS}` : UI_TEXT.READY_PROMPT}
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
          <div className="text-gray-500">{mySeat.ready ? UI_TEXT.READY : UI_TEXT.NOT_READY}</div>
        </div>
      </div>
    </div>
  );
});

function AppComponent() {
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
  const lastRoomStateTimeRef = useRef<number>(0);;
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
  const [peerId, setPeerId] = useState<string>('');

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const autoJoinedRef = useRef(false);
  const currentRemoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Helper to log events to debug panel
  const logEvent = (event: string) => {
    setSocketEvents(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), event }]);
  };

  // Get or create local stream (cached to avoid re-prompting for permissions)
  const getOrCreateLocalStream = async (): Promise<MediaStream> => {
    if (localStreamRef.current && localStreamRef.current.active) {
      return localStreamRef.current;
    }
    const stream = await getLocalStream();
    localStreamRef.current = stream;
    return stream;
  };

  useEffect(() => {
    // 1. Setup PeerJS for WebRTC
    const peer = new Peer({ host: RTC_SERVER_HOST, port: RTC_SERVER_PORT,
      secure: true,
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            ...(TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL ?
              TURN_URLS.split(',').map(url => ({
                urls: url,
                username: TURN_USERNAME,
                credential: TURN_CREDENTIAL,
              }))
            : []),
        ],
        'sdpSemantics': 'unified-plan'
    }
    });
    peerRef.current = peer;

    peer.on("open", (id) => {
      setPeerId(id);

      // Auto-join if we have a roomId from the URL
      const pathRoomId = getRoomIdFromPath();
      if (pathRoomId && !autoJoinedRef.current) {
        // Ensure socket is connected before emitting
        const attemptJoin = () => {
          if (socket.connected) {
            socket.emit("join_room", { roomId: pathRoomId, playerId: MY_PLAYER_ID, peerId: id });
            autoJoinedRef.current = true;
          } else {
            setTimeout(attemptJoin, 100);
          }
        };
        attemptJoin();

        // Start camera
        getOrCreateLocalStream()
          .then((stream) => {
            if (myVideoRef.current) {
              const videoTracks = stream.getVideoTracks();
              if (videoTracks.length === 0) {
                console.warn("No video tracks in local stream");
                logEvent("media_error: No video tracks");
              }
              // Only set srcObject if it's different to prevent flickering
              if (myVideoRef.current.srcObject !== stream) {
                myVideoRef.current.srcObject = stream;
              }
              myVideoRef.current.play().catch(err => {
                console.warn("Local video play failed:", err);
                logEvent(`local_play_error: ${err.message}`);
              });
            }
          })
          .catch((err) => {
            console.error("Error accessing media devices:", err);
            logEvent(`media_error: ${err.message}`);
          });
      }
    });

    peer.on("call", (call) => {
      getLocalStream()
        .then((stream) => {
          call.answer(stream);
          call.on("stream", (remoteStream) => {
            if (remoteVideoRef.current && currentRemoteStreamRef.current !== remoteStream) {
              remoteVideoRef.current.srcObject = remoteStream;
              currentRemoteStreamRef.current = remoteStream;

              // Handle video playback
              remoteVideoRef.current.onloadedmetadata = () => {
                remoteVideoRef.current?.play().catch(err => {
                  console.warn("Remote video play failed:", err);
                });
              };

              // Retry play if it fails
              remoteVideoRef.current.play().catch(err => {
                console.warn("Remote video initial play failed, will retry on metadata:", err);
              });
            }

            // Monitor for stream ended
            remoteStream.getTracks().forEach(track => {
              track.onended = () => {
                console.warn("Remote stream track ended, reconnecting...");
                startVideoCall(call.peer);
              };
            });
          });
          call.on("error", (err) => {
            console.error("Call error:", err);
            logEvent(`call_error: ${err}`);
          });
        })
        .catch((err) => {
          console.error("Error getting local stream for call:", err);
          logEvent(`call_answer_error: ${err.message}`);
          setTimeout(() => {
            if (call) call.answer();
          }, 1000);
        });
    });

    // 2. Socket Listeners
    socket.on("room_state", (state: RoomStateView) => {
      lastRoomStateTimeRef.current = Date.now();
      setRoomState(state);
      setIsConnected(true);
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
      setIsFlipping(true);
      setLastResult({ winnerId, winnerName });
    });

    socket.on("join_rejected", ({ reason }: { reason: string }) => {
      alert(`Join rejected: ${reason}`);
    });

    // Re-join room on reconnect to sync state
    socket.on("reconnect", () => {
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
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // Heartbeat: detect if socket is dead even though socket.connected=true
    const heartbeatInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastRoomStateTimeRef.current;
      if (lastRoomStateTimeRef.current > 0 && timeSinceLastUpdate > HEARTBEAT_TIMEOUT && isConnected) {
        setIsConnected(false);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(heartbeatInterval);
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
    getOrCreateLocalStream()
      .then((stream) => {
        if (myVideoRef.current && myVideoRef.current.srcObject !== stream) {
          myVideoRef.current.srcObject = stream;
        }
        const call = peerRef.current?.call(remotePeerId, stream);
        call?.on("stream", (remoteStream) => {
          if (remoteVideoRef.current && currentRemoteStreamRef.current !== remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
            currentRemoteStreamRef.current = remoteStream;

            // Handle video playback
            remoteVideoRef.current.onloadedmetadata = () => {
              remoteVideoRef.current?.play().catch(err => {
                console.warn("Remote video play failed:", err);
              });
            };

            // Retry play if it fails
            remoteVideoRef.current.play().catch(err => {
              console.warn("Remote video initial play failed, will retry on metadata:", err);
            });
          }

          remoteStream.getTracks().forEach(track => {
            track.onended = () => {
              console.warn("Remote stream track ended, reconnecting...");
              startVideoCall(remotePeerId);
            };
          });
        });
        call?.on("error", (err) => {
          console.error("Call error:", err);
          logEvent(`call_error: ${err}`);
        });
      })
      .catch((err) => {
        console.error("Error starting video call:", err);
        logEvent(`getUserMedia_error: ${err.message}`);
      });
  };

  if (!joined || !roomState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#1a1a1a] text-white">
        <div className="text-center">
          <div className="text-2xl mb-4">{UI_TEXT.CONNECTING}</div>
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
            <div className="text-2xl font-bold mb-4">{UI_TEXT.RECONNECTING}</div>
            <div className="animate-spin inline-block w-8 h-8 border-4 border-gray-600 border-t-white rounded-full"></div>
          </div>
        </div>
      )}

      <RemoteVideoPanel opponentSeat={opponentSeat} remoteVideoRef={remoteVideoRef} />

      <GameControls
        isFlipping={isFlipping}
        mySeat={mySeat}
        lastResult={lastResult}
        bet={bet}
        setBet={setBet}
        roomId={roomId}
        opponentSeat={opponentSeat}
      />

      <LocalVideoPanel mySeat={mySeat} myVideoRef={myVideoRef} />

      <DebugPanel
        showDebug={showDebug}
        setShowDebug={setShowDebug}
        isConnected={isConnected}
        socketId={socket.id}
        peerId={peerId}
        roomId={roomId}
        gameStatus={roomState?.status || 'unknown'}
        lastUpdate={roomState?.timestamp}
        events={socketEvents}
      />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppComponent />
    </ErrorBoundary>
  );
}
