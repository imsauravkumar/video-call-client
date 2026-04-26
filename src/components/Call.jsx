import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, RotateCcw, PhoneOff, MessageCircle } from "lucide-react";

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

export default function Call({ socket, onBack, roomCode, setRoomCode, isHost, phase, setPhase, error, setError, messages, setMessages, chatInput, setChatInput }) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facingMode, setFacingMode] = useState("user");
  const [localVideoPos, setLocalVideoPos] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showChat, setShowChat] = useState(false);
  const [hasUnreadMessage, setHasUnreadMessage] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const chatPanelRef = useRef(null);
  const chatButtonRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const roomCodeRef = useRef("");
  const isHostRef = useRef(false);

  const iceServers = useMemo(() => buildIceServers(), []);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    if (phase !== "lobby") {
      ensureLocalMedia().catch((e) => {
        console.error("Failed to open local media", e);
        setError("Unable to access camera or microphone.");
      });
    }
  }, [phase, facingMode]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (phase === "in-call" && remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      console.log("Remote stream tracks:", remoteStreamRef.current.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
    }
  }, [phase]);

  useEffect(() => {
    if (showChat) {
      setHasUnreadMessage(false);
    }
  }, [showChat]);

  useEffect(() => {
    if (!showChat || !chatMessagesRef.current) return;
    chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
  }, [showChat, messages]);

  useEffect(() => {
    if (!showChat) return;

    function handlePointerDown(event) {
      const target = event.target;
      if (chatPanelRef.current?.contains(target) || chatButtonRef.current?.contains(target)) {
        return;
      }
      setShowChat(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [showChat]);

  async function ensureLocalMedia() {
    const constraints = {
      video: { facingMode },
      audio: true,
    };

    if (!localStreamRef.current) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    }

    if (localVideoRef.current && localVideoRef.current.srcObject !== localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    return localStreamRef.current;
  }

  function createPeerConnection() {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    remoteStreamRef.current = new MediaStream();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind, "enabled:", event.track.enabled);
      if (!remoteStreamRef.current) return;
      remoteStreamRef.current.addTrack(event.track);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      setPhase("in-call");
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
      console.log("Connection state:", state);
      if (state === "connected") {
        setPhase("in-call");
      }
      if (state === "failed" || state === "closed" || state === "disconnected") {
        setError("Connection lost. Please try again.");
      }
    };

    return pc;
  }

  async function preparePeer() {
    const stream = await ensureLocalMedia();
    const pc = createPeerConnection();
    const existingTrackIds = new Set(
      pc.getSenders()
        .map((sender) => sender.track?.id)
        .filter(Boolean)
    );

    for (const track of stream.getTracks()) {
      if (!existingTrackIds.has(track.id)) {
        pc.addTrack(track, stream);
      }
    }

    return pc;
  }

  async function startOffer() {
    const pc = pcRef.current;
    const code = roomCodeRef.current;
    if (!pc || !code) return;
    console.log("Creating offer");
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

    try {
      if (data?.type === "offer") {
        console.log("Setting remote offer");
        await pc.setRemoteDescription(new RTCSessionDescription(data.description));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", {
          code,
          data: { type: "answer", description: pc.localDescription },
        });
      } else if (data?.type === "answer") {
        console.log("Setting remote answer");
        await pc.setRemoteDescription(new RTCSessionDescription(data.description));
      } else if (data?.type === "ice") {
        if (data.candidate) {
          console.log("Adding ICE candidate");
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      }
    } catch (e) {
      console.error("WebRTC signal error:", e);
      setError("Connection failed. Please try again.");
    }
  }

  function cleanupPeerResources() {
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
  }

  function stopAll(options = { keepError: false }) {
    cleanupPeerResources();

    setMicOn(true);
    setCamOn(true);
    setMessages([]);
    setChatInput("");
    setRoomCode("");
    setPhase("lobby");
    setShowChat(false);
    setHasUnreadMessage(false);
    if (!options.keepError) {
      setError("");
    }
  }

  useEffect(() => {
    function onPeerJoined() {
      if (isHostRef.current) {
        preparePeer()
          .then(() => startOffer())
          .catch(() => {});
      }
      setPhase("connecting");
    }

    function onRoomJoined() {
      preparePeer().catch(() => {});
      setPhase("connecting");
    }

    function onSignal({ data }) {
      handleSignal(data).catch(() => {});
    }

    function onChat(msg) {
      const isOwnMessage = msg.from === socket.id;
      setMessages(prev => [...prev, {
        message: msg.message,
        sender: isOwnMessage ? "You" : "Friend"
      }]);
      if (!isOwnMessage && !showChat) {
        setHasUnreadMessage(true);
      }
    }

    function onPeerLeft() {
      setError("Peer left the call.");
      stopAll({ keepError: true });
      setTimeout(() => {
        setError("");
        onBack();
      }, 1400);
    }

    function onCallEnded() {
      setError("Call ended.");
      stopAll({ keepError: true });
      setTimeout(() => {
        setError("");
        onBack();
      }, 1400);
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
  }, [socket, showChat]);

  useEffect(() => {
    return () => {
      cleanupPeerResources();
    };
  }, []);

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

  async function swapCamera() {
    const newFacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacingMode);
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
      localStreamRef.current = null;
    }
    try {
      await ensureLocalMedia();
      if (pcRef.current) {
        const pc = pcRef.current;
        const stream = localStreamRef.current;
        for (const sender of pc.getSenders()) {
          if (sender.track && sender.track.kind === "video") {
            pc.removeTrack(sender);
          }
        }
        for (const track of stream.getVideoTracks()) {
          pc.addTrack(track, stream);
        }
      }
    } catch (e) {
      setError("Failed to switch camera.");
    }
  }

  function leaveCall() {
    stopAll();
    onBack();
  }

  function endCall() {
    if (roomCodeRef.current) socket.emit("call:end", { code: roomCodeRef.current });
    leaveCall();
  }

  function handleMouseDown(e) {
    setIsDragging(true);
    setDragStart({ x: e.clientX - localVideoPos.x, y: e.clientY - localVideoPos.y });
  }

  function handleTouchStart(e) {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - localVideoPos.x, y: touch.clientY - localVideoPos.y });
  }

  function handleMouseMove(e) {
    if (!isDragging) return;
    setLocalVideoPos({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }

  function handleTouchMove(e) {
    if (!isDragging) return;
    const touch = e.touches[0];
    setLocalVideoPos({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchmove", handleTouchMove);
      document.addEventListener("touchend", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  if (phase === "waiting") {
    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.16),_transparent_24%)] pointer-events-none" />
        <div className="relative z-10 text-center px-4">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-6">Waiting for someone to join</h1>
          <div className="bg-slate-900/55 p-8 rounded-[30px] border border-white/10 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400 mb-3">Room code</div>
            <div className="text-5xl font-semibold tracking-[0.25em] mb-6">{formatCode(roomCode)}</div>
            <p className="text-slate-400">Share this code with your friend to start the call.</p>
          </div>
          <button
            onClick={leaveCall}
            className="mt-8 px-6 py-3 text-lg font-semibold text-slate-300 hover:text-white transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.15),_transparent_30%),linear-gradient(to_bottom,_rgba(2,6,23,0.15),_transparent_32%,_rgba(2,6,23,0.4))] z-0 pointer-events-none" />
      {/* Remote Video Background */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Local Video Overlay */}
      <div
        className="absolute w-32 h-24 sm:w-40 sm:h-30 bg-black/70 rounded-2xl overflow-hidden shadow-2xl shadow-black/30 cursor-move border border-white/10 backdrop-blur-sm z-10"
        style={{
          left: `${localVideoPos.x}px`,
          top: `${localVideoPos.y}px`,
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : {}}
        />
      </div>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-center items-center z-20">
        <div className="rounded-full bg-slate-900/45 px-4 py-2 text-white text-sm font-medium shadow-lg shadow-black/20 backdrop-blur-xl border border-white/10">
          {phase === "connecting" ? "Connecting..." : phase === "in-call" ? "In Call" : "Waiting"}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-rose-500/85 text-white px-4 py-2.5 rounded-2xl z-20 shadow-lg shadow-black/20 backdrop-blur-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 sm:bottom-8 left-1/2 transform -translate-x-1/2 flex items-center gap-2 sm:gap-4 z-20">
        <button
          onClick={toggleMic}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors ${
            micOn
              ? "bg-slate-900/45 hover:bg-slate-800/60 border border-white/10"
              : "bg-red-500 hover:bg-red-600"
          }`}
        >
          {micOn ? <Mic size={18} className="sm:w-5 sm:h-5" /> : <MicOff size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button
          onClick={toggleCam}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors ${
            camOn
              ? "bg-slate-900/45 hover:bg-slate-800/60 border border-white/10"
              : "bg-red-500 hover:bg-red-600"
          }`}
        >
          {camOn ? <Video size={18} className="sm:w-5 sm:h-5" /> : <VideoOff size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button
          ref={chatButtonRef}
          onClick={() => setShowChat((prev) => !prev)}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors ${
            showChat
              ? "bg-blue-500 hover:bg-blue-600"
              : "bg-slate-900/45 hover:bg-slate-800/60 border border-white/10"
          } relative`}
        >
          <MessageCircle size={18} className="sm:w-5 sm:h-5" />
          {hasUnreadMessage && !showChat && (
            <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-red-500" />
          )}
        </button>
        <button
          onClick={swapCamera}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-slate-900/45 hover:bg-slate-800/60 border border-white/10 flex items-center justify-center transition-colors"
        >
          <RotateCcw size={18} className="sm:w-5 sm:h-5" />
        </button>
        <button
          onClick={endCall}
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-red-500 hover:bg-red-600 shadow-xl shadow-red-950/40 flex items-center justify-center transition-colors ml-2"
        >
          <PhoneOff size={20} className="sm:w-6 sm:h-6" />
        </button>
      </div>

      {/* Chat Interface */}
      {showChat && (
        <div ref={chatPanelRef} className="absolute right-3 top-16 bottom-3 sm:top-20 sm:right-4 sm:bottom-4 w-[calc(100%-1.5rem)] max-w-80 rounded-3xl bg-slate-950/78 shadow-2xl shadow-black/40 backdrop-blur-xl z-30 flex flex-col overflow-hidden">
          <div className="px-5 py-4 bg-white/5 flex items-center justify-between gap-3">
            <h3 className="text-white font-semibold">Chat</h3>
            <button
              onClick={() => setShowChat(false)}
              className="text-sm text-white/80 hover:text-white transition-colors"
            >
              ← Back
            </button>
          </div>
          <div ref={chatMessagesRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg, idx) => (
              <div key={idx} className="text-white bg-white/8 rounded-2xl px-3 py-2.5 shadow-lg shadow-black/10">
                <div className="text-xs tracking-wide text-white/55 mb-1">{msg.sender || "Friend"}</div>
                <div className="text-sm leading-6">{msg.message}</div>
              </div>
            ))}
          </div>
          <div className="p-4 bg-white/5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (chatInput.trim()) {
                  socket.emit("chat:message", { code: roomCode, message: chatInput });
                  setChatInput("");
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2.5 bg-white/10 rounded-2xl text-white placeholder-white/45 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
              <button
                type="submit"
                className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );

}
