import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Peer } from "peerjs";
import { useRive } from "@rive-app/react-canvas";

// Image assets
import piggyBankImg from "../images/piggy-bank.svg";
import cashImg from "../images/cash.svg";
import leftAvatarImg from "../images/avatar-left.svg";
import rightAvatarImg from "../images/right.svg";
import smileIcon from "../images/smile.svg";
import giftIcon from "../images/gift.svg";
import sendIcon from "../images/send.svg";

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
  action?: 'ready' | 'rematch' | 'double';
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

/* Responsive-size helpers: multiply by the --rs / --rs-sm CSS variables */
const rs = (px: number) => `calc(${px} * var(--rs))`;
const rsSm = (px: number) => `calc(${px} * var(--rs-sm))`;

/* ─── Coin Flip Animation ─── */
/* Keyed by flipCount so each flip gets a fresh Rive instance — avoids
   rive.reset() corrupting the WASM runtime on repeated calls. */
function CoinFlipAnimation({ shouldFlip }: { shouldFlip: boolean }) {
  const { rive, RiveComponent } = useRive({
    src: "/coinflip.riv",
    stateMachines: "State Machine 1",
    autoplay: true,
  });

  useEffect(() => {
    if (!shouldFlip || !rive) return;
    const timeout = setTimeout(() => {
      const inputs = rive.stateMachineInputs("State Machine 1");
      if (inputs) {
        const flip = inputs.find(i => i.name === "flip");
        if (flip) flip.fire();
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [rive, shouldFlip]);

  return <RiveComponent style={{ width: rsSm(800), height: rsSm(800) }} />;
}

/* ─── Glass Pill ─── */
function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`pill ${className}`}>
      {children}
    </div>
  );
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
  const [activeAction, setActiveAction] = useState<null | 'ready' | 'rematch' | 'double'>(null);
  const [flipCount, setFlipCount] = useState(0);

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const autoJoinedRef = useRef(false);

  useEffect(() => {
    const peer = new Peer({ host: RTC_SERVER_HOST, port: RTC_SERVER_PORT,
      secure: true
    });
    peerRef.current = peer;

    peer.on("open", (id) => {
      console.log("My Peer ID:", id);
      const pathRoomId = getRoomIdFromPath();
      if (pathRoomId && !autoJoinedRef.current) {
        const attemptJoin = () => {
          if (socket.connected) {
            socket.emit("join_room", { roomId: pathRoomId, playerId: MY_PLAYER_ID, peerId: id });
            autoJoinedRef.current = true;
          } else {
            setTimeout(attemptJoin, 100);
          }
        };
        attemptJoin();
        navigator.mediaDevices.getUserMedia({ video: {
          width: { max: 640 },
          height: { max: 480 },
          frameRate: { max: 25 }
        }, audio: true }).then((stream) => {
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

    socket.on("room_state", (state: RoomStateView) => {
      console.log("Received room_state:", state);
      setRoomState(state);
      if (state.status !== 'flipping') {
        setIsFlipping(false);
      }
      const mySeat = state.seats.find(seat => seat && seat.playerId === MY_PLAYER_ID);
      if (mySeat) {
        setMySeatIndex(mySeat.seatIndex);
        setJoined(true);
      }
      const opponentSeat = state.seats.find(seat => seat && seat.playerId !== MY_PLAYER_ID);
      if (opponentSeat?.peerId && !remoteVideoRef.current?.srcObject) {
        startVideoCall(opponentSeat.peerId);
      }
    });

    socket.on("start_flip", ({ winnerId, winnerName }: { winnerId: string; winnerName: string }) => {
      setIsFlipping(true);
      setFlipCount(c => c + 1);
      setActiveAction(null);
      setLastResult({ winnerId, winnerName });
    });

    socket.on("join_rejected", ({ reason }: { reason: string }) => {
      console.error("Join rejected:", reason);
      alert(`Join rejected: ${reason}`);
    });

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

  /* ─── Loading Screen ─── */
  if (!joined || !roomState) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center">
        <div className="text-shadow" style={{ fontSize: rs(24), lineHeight: 1.3, marginBottom: rs(12) }}>Connecting...</div>
        <div className="text-white/40" style={{ fontSize: rs(14), lineHeight: 1.3 }}>{roomId}</div>
      </div>
    );
  }

  const mySeat = roomState.seats[mySeatIndex!] as SeatView;
  const opponentSeat = roomState.seats[1 - mySeatIndex!] as SeatView | null;
  const gamePot = bet * 2;

  const toggleAction = (action: 'ready' | 'rematch' | 'double') => {
    if (isFlipping) return;

    // Compute new state synchronously so we can send the correct values
    const prev = activeAction;
    const newAction = prev === action ? null : action;

    const wasDouble = prev === 'double';
    const goingToDouble = action === 'double' && prev !== 'double';
    const leavingDouble = wasDouble && action !== 'double';
    const togglingDoubleOff = wasDouble && action === 'double';

    let newBet = bet;
    if (goingToDouble) {
      newBet = bet * 2;
    } else if (leavingDouble || togglingDoubleOff) {
      newBet = Math.max(1, Math.floor(bet / 2));
    }

    setActiveAction(newAction);
    setBet(newBet);

    // Send explicit ready state (not toggle)
    const isReady = newAction !== null;
    socket.emit("toggle_ready", {
      roomId,
      bet: isReady ? newBet : 0,
      ready: isReady,
      action: isReady ? newAction : undefined,
    });
  };

  return (
    <div className="fixed inset-0 text-white overflow-hidden">

      {/* ═══ OPPONENT VIDEO — Top Half ═══ */}
      <div className="absolute top-0 left-0 right-0 overflow-hidden" style={{ height: '50dvh' }}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover ${opponentSeat?.online ? '' : 'opacity-40'}`}
        />
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: '45%', background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)' }} />

        {opponentSeat ? (
          !opponentSeat.online && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-shadow tracking-wider" style={{ fontSize: rs(24), lineHeight: 1.3 }}>DISCONNECTED</div>
            </div>
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="tracking-widest text-shadow text-white/80" style={{ fontSize: rs(20), lineHeight: 1.3 }}>
              WAITING FOR OPPONENT...
            </div>
          </div>
        )}
      </div>

      {/* ═══ SELF VIDEO — Bottom Half ═══ */}
      <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: '50dvh' }}>
        <video
          ref={myVideoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: '45%', background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)' }} />
      </div>

      {/* ═══════════ FLOATING UI LAYER ═══════════ */}

      {/* ── TOP RIGHT: Balance + Total pills ── */}
      <div className="absolute left-0 right-0 z-20 flex justify-end" style={{ gap: rs(12), paddingRight: rs(16), top: 'max(10px, env(safe-area-inset-top, 10px))' }}>
        <Pill>
          <img src={piggyBankImg} alt="" style={{ width: rs(36), height: rs(36) }} />
          <span>{bet * 2}</span>
        </Pill>
        <Pill>
          <img src={cashImg} alt="" style={{ width: rs(36), height: rs(28) }} />
          <span><span style={{ color: '#DCDCDC' }}>Total:</span> {mySeat.balance}</span>
        </Pill>
      </div>

      {/* ── CENTER: Both players SAME LINE, coin in middle ── */}

      {/* Opponent (LEFT) — avatar + name */}
      {opponentSeat?.online && (
        <div className="absolute z-20 flex flex-col items-center" style={{ top: `calc(50dvh - ${rsSm(105)})`, left: rsSm(14) }}>
          <div className="relative">
            <div className={`speech-bubble ${opponentSeat.ready && !isFlipping ? 'visible' : ''}`}>{opponentSeat.action === 'double' ? 'Double?' : opponentSeat.action === 'rematch' ? 'Rematch?' : 'Ready!'}</div>
            <img src={leftAvatarImg} alt="" style={{ width: rsSm(130), height: rsSm(98) }} draggable={false} />
          </div>
          <span className="name-label" style={{ marginTop: rsSm(-6) }}>{opponentSeat.name}</span>
        </div>
      )}

      {/* Coin Flip Animation — center (CLICKABLE = toggle ready) */}
      <div
        className="absolute left-1/2 z-30"
        style={{
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: rsSm(800),
          height: rsSm(800),
          pointerEvents: 'none',
        }}
      >
        <CoinFlipAnimation key={flipCount} shouldFlip={flipCount > 0} />
      </div>
      {/* Clickable area — only the coin center */}
      <div
        className="absolute left-1/2 z-30 coin-wrapper"
        style={{
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: rsSm(150),
          height: rsSm(150),
        }}
        onClick={() => toggleAction('ready')}
      />

      {/* Self (RIGHT) — avatar + name */}
      <div className="absolute z-20 flex flex-col items-center" style={{ top: `calc(50dvh - ${rsSm(99)})`, right: rsSm(14) }}>
        <div className="relative">
          {/* "Ready!" bubble — pops up above avatar on coin tap */}
          <div className={`speech-bubble ${!isFlipping && activeAction ? 'visible' : ''}`}>{activeAction === 'double' ? 'Double?' : activeAction === 'rematch' ? 'Rematch?' : 'Ready!'}</div>
          <img src={rightAvatarImg} alt="" style={{ width: rsSm(130), height: rsSm(86) }} draggable={false} />
        </div>
        <span className="name-label">{mySeat.name}</span>
        <div style={{ height: rsSm(6) }} />
        {/* Bet input pill (cash icon + editable amount) */}
        <div className="bet-pill">
          <img src={cashImg} alt="" style={{ width: rs(40), height: rs(28) }} />
          <input
            type="number"
            min="1"
            max={mySeat.balance}
            value={bet}
            onChange={(e) => setBet(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
      </div>

      {/* ═══ BOTTOM CONTROLS AREA ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col" style={{ gap: rs(12), padding: `0 ${rs(14)} ${rs(14)} ${rs(14)}`, paddingBottom: `max(${rs(14)}, env(safe-area-inset-bottom, ${rs(14)}))` }}>

        {/* Status / Result text */}
        {isFlipping ? (
          <div className="text-center tracking-wide text-shadow" style={{ fontSize: rs(20), lineHeight: 1.3, color: '#FFD700' }}>
            SPINNING...
          </div>
        ) : lastResult && !mySeat.ready ? (
          <div
            className="text-center tracking-wide text-shadow"
            style={{
              fontSize: rs(20),
              lineHeight: 1.3,
              animation: 'resultPop 0.5s ease-out',
              color: lastResult.winnerId === MY_PLAYER_ID ? '#4CD964' : '#FF3B30',
            }}
          >
            {lastResult.winnerId === MY_PLAYER_ID ? 'YOU WIN!' : `${lastResult.winnerName} WINS!`}
          </div>
        ) : null}

        {/* Row 1: smiley (right-aligned) */}
        <div className="flex items-center" style={{ gap: rs(12) }}>
          <div className="flex-1" />
          <div className="circle-btn border-2 border-white/30 inactive pointer-events-none">
            <img src={smileIcon} alt="" style={{ width: rs(28), height: rs(28) }} />
          </div>
        </div>

        {/* Row 2: Rematch + Double (left) ── gift (right) */}
        <div className="flex items-center" style={{ gap: rs(12) }}>
          <div className={`pill-lg cursor-pointer ${activeAction === 'rematch' ? 'pill-active' : ''}`} onClick={() => toggleAction('rematch')}>
            <span style={{ color: '#FF9500' }}>▶</span>
            <span>Rematch</span>
          </div>
          <div className={`pill-lg cursor-pointer ${activeAction === 'double' ? 'pill-active' : ''}`} onClick={() => toggleAction('double')}>
            <span style={{ color: '#5856D6' }}>💎</span>
            <span>Double</span>
          </div>
          <div className="flex-1" />
          <div className="circle-btn inactive pointer-events-none" style={{ background: '#FF9500' }}>
            <img src={giftIcon} alt="" style={{ width: rs(28), height: rs(28) }} />
          </div>
        </div>

        {/* Row 3: Chat input + send (purple) */}
        <div className="flex items-center" style={{ gap: rs(12) }}>
          <input
            type="text"
            placeholder="Type message..."
            className="chat-input-bar"
          />
          <div className="circle-btn inactive pointer-events-none" style={{ background: '#5856D6' }}>
            <img src={sendIcon} alt="" style={{ width: rs(28), height: rs(28) }} />
          </div>
        </div>

      </div>
    </div>
  );
}
