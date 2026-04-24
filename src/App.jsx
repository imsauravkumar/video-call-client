import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

function buildIceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;
  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

function formatCode(code) {
  const c = String(code || "");
  if (c.length !== 6) return c;
  return `${c.slice(0, 3)} ${c.slice(3)}`;
}

export default function App() {
  const socket = useMemo(() => io(SERVER_URL), []);
  const [phase, setPhase] = useState("lobby"); // lobby | waiting | connecting | in-call
  const [isHost, setIsHost] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const roomCodeRef = useRef("");
  const isHostRef = useRef(false);

  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);

  const iceServers = useMemo(() => buildIceServers(), []);

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  async function ensureLocalMedia() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }

  function createPeerConnection() {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    remoteStreamRef.current = new MediaStream();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) return;
      remoteStreamRef.current.addTrack(event.track);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("signal", {
        code: roomCodeRef.current,
        data: { type: "ice", candidate: event.candidate },
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setPhase("in-call");
      }
      if (state === "failed" || state === "closed" || state === "disconnected") {
        // Let explicit "end call" control the reset; peer:left/call:ended also handle it.
      }
    };

    return pc;
  }

  async function preparePeer() {
    const stream = await ensureLocalMedia();
    const pc = createPeerConnection();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
  }

  async function startOffer() {
    const pc = pcRef.current;
    const code = roomCodeRef.current;
    if (!pc || !code) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", {
      code,
      data: { type: "offer", description: pc.localDescription },
    });
  }

  async function handleSignal(data) {
    if (!pcRef.current) await preparePeer();
    const pc = pcRef.current;
    const code = roomCodeRef.current;
    if (!pc || !code) return;

    if (data?.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.description));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", {
        code,
        data: { type: "answer", description: pc.localDescription },
      });
    } else if (data?.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.description));
    } else if (data?.type === "ice") {
      if (data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  function stopAll() {
    try {
      pcRef.current?.close?.();
    } catch {}
    pcRef.current = null;

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
    }
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setMicOn(true);
    setCamOn(true);
    setMessages([]);
    setChatInput("");
    setRoomCode("");
    setJoinCode("");
    setIsHost(false);
    setPhase("lobby");
  }

  useEffect(() => {
    function onPeerJoined() {
      // Host should create offer when second user arrives.
      if (isHostRef.current) startOffer().catch(() => {});
      setPhase("connecting");
    }

    function onRoomJoined() {
      setPhase("connecting");
    }

    function onSignal({ data }) {
      handleSignal(data).catch(() => {});
    }

    function onChat(msg) {
      setMessages((prev) => prev.concat(msg));
    }

    function onPeerLeft() {
      setError("Peer left the call.");
      stopAll();
    }

    function onCallEnded() {
      setError("Call ended.");
      stopAll();
    }

    socket.on("peer:joined", onPeerJoined);
    socket.on("room:joined", onRoomJoined);
    socket.on("signal", onSignal);
    socket.on("chat:message", onChat);
    socket.on("peer:left", onPeerLeft);
    socket.on("call:ended", onCallEnded);

    return () => {
      socket.off("peer:joined", onPeerJoined);
      socket.off("room:joined", onRoomJoined);
      socket.off("signal", onSignal);
      socket.off("chat:message", onChat);
      socket.off("peer:left", onPeerLeft);
      socket.off("call:ended", onCallEnded);
    };
  }, [socket]);

  async function createRoom() {
    setError("");
    socket.emit("room:create", async ({ ok, code }) => {
      if (!ok) return setError("Failed to create room.");
      setIsHost(true);
      setRoomCode(code);
      setPhase("waiting");
      try {
        await preparePeer();
      } catch (e) {
        setError("Camera/microphone permission is required.");
      }
    });
  }

  async function joinRoom() {
    const code = joinCode.replace(/\s/g, "");
    setError("");
    if (!/^\d{6}$/.test(code)) return setError("Enter a valid 6-digit code.");

    socket.emit("room:join", { code }, async (res) => {
      if (!res?.ok) {
        if (res?.error === "ROOM_NOT_FOUND") return setError("Room not found.");
        if (res?.error === "ROOM_FULL") return setError("Room already has 2 users.");
        return setError("Failed to join room.");
      }
      setIsHost(false);
      setRoomCode(code);
      setPhase("connecting");
      try {
        await preparePeer();
      } catch (e) {
        setError("Camera/microphone permission is required.");
      }
    });
  }

  function toggleMic() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMicOn(next);
  }

  function toggleCam() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCamOn(next);
  }

  function endCall() {
    if (roomCodeRef.current) socket.emit("call:end", { code: roomCodeRef.current });
    stopAll();
  }

  function sendChat(e) {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    socket.emit("chat:message", { code: roomCode, message: trimmed });
    setChatInput("");
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="text-sm font-semibold tracking-wide text-slate-100">
            1-to-1 Video Call
          </div>
          <div className="text-xs text-slate-400">
            {phase === "lobby"
              ? "Lobby"
              : phase === "waiting"
                ? "Waiting"
                : phase === "connecting"
                  ? "Connecting"
                  : "In call"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {phase === "lobby" || phase === "waiting" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <h2 className="text-base font-semibold">Create a room</h2>
              <p className="mt-1 text-sm text-slate-400">
                Start a new 1-to-1 call and share the code with your friend.
              </p>
              <button
                onClick={createRoom}
                className="mt-4 w-full rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 active:bg-indigo-600"
              >
                Create room
              </button>

              {isHost && roomCode ? (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="text-xs font-medium text-slate-400">Room code</div>
                  <div className="mt-1 text-2xl font-bold tracking-widest">{formatCode(roomCode)}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    Share this code. Waiting for someone to join…
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <h2 className="text-base font-semibold">Join a room</h2>
              <p className="mt-1 text-sm text-slate-400">Enter the 6-digit code you received.</p>

              <div className="mt-4 flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="123 456"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  onClick={joinRoom}
                  className="shrink-0 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white"
                >
                  Join
                </button>
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-400">Preview</div>
                <div className="mt-2 aspect-video overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Camera preview starts after you create or join a room.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-800 bg-black">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />

                <div className="absolute bottom-3 right-3 h-28 w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-950/70 sm:h-32 sm:w-48">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="absolute left-3 top-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs text-slate-200 border border-slate-800">
                  Room {formatCode(roomCode)}
                </div>

                {phase === "connecting" ? (
                  <div className="absolute inset-0 grid place-items-center bg-black/40">
                    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
                      Connecting…
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={toggleMic}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                    micOn
                      ? "border-slate-700 bg-slate-950/60 text-slate-100 hover:bg-slate-950"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                  }`}
                >
                  {micOn ? "Mute" : "Unmute"}
                </button>
                <button
                  onClick={toggleCam}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                    camOn
                      ? "border-slate-700 bg-slate-950/60 text-slate-100 hover:bg-slate-950"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                  }`}
                >
                  {camOn ? "Camera off" : "Camera on"}
                </button>
                <button
                  onClick={endCall}
                  className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 active:bg-rose-600"
                >
                  End call
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3 flex flex-col min-h-[22rem]">
              <div className="px-2 py-2">
                <div className="text-sm font-semibold">Chat</div>
                <div className="text-xs text-slate-400">Realtime (no history)</div>
              </div>

              <div className="flex-1 overflow-auto px-2 pb-2">
                {messages.length === 0 ? (
                  <div className="mt-6 text-center text-sm text-slate-500">No messages yet.</div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-[90%] rounded-xl px-3 py-2 text-sm border ${
                          m.from === socket.id
                            ? "ml-auto border-indigo-500/40 bg-indigo-500/10 text-indigo-50"
                            : "mr-auto border-slate-700 bg-slate-950/60 text-slate-100"
                        }`}
                      >
                        {m.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={sendChat} className="border-t border-slate-800 p-2 flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message…"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <button className="shrink-0 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white">
                  Send
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
          STUN: Google. Add TURN env vars for production NAT traversal.
        </div>
      </footer>
    </div>
  );
}
