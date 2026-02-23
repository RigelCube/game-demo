import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { Peer } from "peerjs";
import { useRive } from "@rive-app/react-canvas";

// Image assets
import piggyBankImg from "../images/freepik__img3-same-styling-piggy-bank-but-only-one-piggy-ba__93008-2 1.svg";
import cashImg from "../images/cash 4.svg";
import leftAvatarImg from "../images/new left.svg";
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

  const { rive, RiveComponent } = useRive({
    src: "/coinflip.riv",
    stateMachines: "State Machine 1",
    autoplay: true,
    onStateChange: (event) => {
      console.log("Rive state changed:", event.data);
    },
  });

  const fireFlip = useCallback(() => {
    if (!rive) return;
    // Reset state machine to initial state so trigger works again
    rive.reset({ stateMachines: true });
    rive.play("State Machine 1");
    // Fire after a short delay to let the state machine reinitialize
    setTimeout(() => {
      const inputs = rive.stateMachineInputs("State Machine 1");
      if (!inputs) return;
      const flip = inputs.find(i => i.name === "flip");
      if (flip) {
        flip.fire();
      }
    }, 50);
  }, [rive]);

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
        // Clear action when server says not ready
        if (!mySeat.ready) setActiveAction(null);
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

  // Trigger Rive flip via state machine when game starts
  useEffect(() => {
    if (flipCount === 0) return;
    fireFlip();
  }, [flipCount, fireFlip]);

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
        <div className="text-2xl text-shadow mb-3">Connecting...</div>
        <div className="text-white/40 text-sm">{roomId}</div>
      </div>
    );
  }

  const mySeat = roomState.seats[mySeatIndex!] as SeatView;
  const opponentSeat = roomState.seats[1 - mySeatIndex!] as SeatView | null;
  const gamePot = bet * 2;

  const toggleAction = (action: 'ready' | 'rematch' | 'double') => {
    if (isFlipping) return;
    setActiveAction(prev => {
      const wasDouble = prev === 'double';
      const goingToDouble = action === 'double' && prev !== 'double';
      const leavingDouble = wasDouble && action !== 'double';
      const togglingDoubleOff = wasDouble && action === 'double';

      if (goingToDouble) {
        setBet(b => b * 2);
      } else if (leavingDouble || togglingDoubleOff) {
        setBet(b => Math.max(1, Math.floor(b / 2)));
      }

      if (prev === action) return null; // toggle off
      return action; // switch to new action
    });
    socket.emit("toggle_ready", { roomId, bet: action === 'double' ? bet * 2 : bet });
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
              <div className="text-2xl text-shadow tracking-wider">DISCONNECTED</div>
            </div>
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-xl tracking-widest text-shadow text-white/80">
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
      <div className="absolute left-0 right-0 z-20 flex justify-end gap-3 pr-4" style={{ top: 'max(10px, env(safe-area-inset-top, 10px))' }}>
        <Pill>
          <img src={piggyBankImg} alt="" className="w-9 h-9" />
          <span>{mySeat.balance}</span>
        </Pill>
        <Pill>
          <img src={cashImg} alt="" className="w-9 h-7" />
          <span><span style={{ color: '#DCDCDC' }}>Total:</span> {opponentSeat ? opponentSeat.balance + mySeat.balance : mySeat.balance}</span>
        </Pill>
      </div>

      {/* ── CENTER: Both players SAME LINE, coin in middle ── */}

      {/* Opponent (LEFT) — avatar + name */}
      {opponentSeat && (
        <div className="absolute z-20 flex flex-col items-center" style={{ top: 'calc(50dvh - 105px)', left: 14 }}>
          <div className="relative">
            <div className={`speech-bubble ${opponentSeat.ready && !isFlipping ? 'visible' : ''}`}>Ready!</div>
            <img src={leftAvatarImg} alt="" style={{ width: 130, height: 98 }} draggable={false} />
          </div>
          <span className="name-label" style={{ marginTop: -6 }}>{opponentSeat.name}</span>
        </div>
      )}

      {/* Coin Flip Animation — center (CLICKABLE = toggle ready) */}
      <div
        className="absolute left-1/2 z-30 coin-wrapper"
        style={{
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 800,
          height: 800,
        }}
        onClick={() => toggleAction('ready')}
      >
        <RiveComponent style={{ width: 800, height: 800 }} />
      </div>

      {/* Self (RIGHT) — avatar + name */}
      <div className="absolute z-20 flex flex-col items-center" style={{ top: 'calc(50dvh - 99px)', right: 14 }}>
        <div className="relative">
          {/* "Ready!" bubble — pops up above avatar on coin tap */}
          <div className={`speech-bubble ${activeAction ? 'visible' : ''}`}>{activeAction === 'double' ? 'Double?' : activeAction === 'rematch' ? 'Rematch?' : 'Ready!'}</div>
          <img src={rightAvatarImg} alt="" style={{ width: 130, height: 86 }} draggable={false} />
        </div>
        <span className="name-label">{mySeat.name}</span>
        <div style={{ height: 6 }} />
        {/* Bet input pill (cash icon + editable amount) */}
        <div className="bet-pill">
          <img src={cashImg} alt="" className="w-10 h-7" />
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
      <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-3" style={{ padding: '0 14px 14px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))' }}>

        {/* Status / Result text */}
        {isFlipping ? (
          <div className="text-center text-xl tracking-wide text-shadow" style={{ color: '#FFD700' }}>
            SPINNING...
          </div>
        ) : lastResult && !mySeat.ready ? (
          <div
            className="text-center text-xl tracking-wide text-shadow"
            style={{
              animation: 'resultPop 0.5s ease-out',
              color: lastResult.winnerId === MY_PLAYER_ID ? '#4CD964' : '#FF3B30',
            }}
          >
            {lastResult.winnerId === MY_PLAYER_ID ? 'YOU WIN!' : `${lastResult.winnerName} WINS!`}
          </div>
        ) : null}

        {/* Row 1: smiley (right-aligned) */}
        <div className="flex items-center gap-3">
          <div className="flex-1" />
          <div className="circle-btn border-2 border-white/30 inactive pointer-events-none">
            <img src={smileIcon} alt="" className="w-7 h-7" />
          </div>
        </div>

        {/* Row 2: Rematch + Double (left) ── gift (right) */}
        <div className="flex items-center gap-3">
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
            <img src={giftIcon} alt="" className="w-7 h-7" />
          </div>
        </div>

        {/* Row 3: Chat input + send (purple) */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Type message..."
            className="chat-input-bar"
          />
          <div className="circle-btn inactive pointer-events-none" style={{ background: '#5856D6' }}>
            <img src={sendIcon} alt="" className="w-7 h-7" />
          </div>
        </div>

      </div>
    </div>
  );
}
