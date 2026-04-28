import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, RotateCcw, Phone, MessageCircle } from "lucide-react";

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

export default function Call({ socket, onBack, roomType, setRoomType, roomCode, setRoomCode, isHost, phase, setPhase, error, setError, messages, setMessages, chatInput, setChatInput }) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facingMode, setFacingMode] = useState("user");
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
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
  const pendingIceCandidatesRef = useRef([]);
  const disconnectTimeoutRef = useRef(null);
  const localAudioAnalyserRef = useRef(null);
  const remoteAudioAnalyserRef = useRef(null);
  const localAudioCleanupRef = useRef(null);
  const remoteAudioCleanupRef = useRef(null);
  const levelAnimationRef = useRef(null);

  const iceServers = useMemo(() => buildIceServers(), []);
  const isVoiceRoom = roomType === "voice";
  const roomLabel = isVoiceRoom ? "Voice Room" : "Video Room";

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  useEffect(() => {
    if (phase !== "lobby") {
      ensureLocalMedia().catch((e) => {
        console.error("Failed to open local media", e);
        setError(isVoiceRoom ? "Unable to access microphone." : "Unable to access camera or microphone.");
      });
    }
  }, [phase, facingMode, roomType]);

  useEffect(() => {
    setCamOn(!isVoiceRoom);
  }, [isVoiceRoom]);

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
    if (!isVoiceRoom) return;

    function updateLevels() {
      const nextLocalLevel = readAnalyserLevel(localAudioAnalyserRef.current);
      const nextRemoteLevel = readAnalyserLevel(remoteAudioAnalyserRef.current);
      setLocalAudioLevel(nextLocalLevel);
      setRemoteAudioLevel(nextRemoteLevel);
      levelAnimationRef.current = window.requestAnimationFrame(updateLevels);
    }

    levelAnimationRef.current = window.requestAnimationFrame(updateLevels);

    return () => {
      if (levelAnimationRef.current) {
        window.cancelAnimationFrame(levelAnimationRef.current);
      }
      levelAnimationRef.current = null;
      setLocalAudioLevel(0);
      setRemoteAudioLevel(0);
    };
  }, [isVoiceRoom]);

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
      video: isVoiceRoom ? false : { facingMode },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };

    if (!localStreamRef.current) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (isVoiceRoom) {
        attachAudioAnalyser(stream, localAudioAnalyserRef, localAudioCleanupRef);
      }
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
      if (isVoiceRoom) {
        attachAudioAnalyser(remoteStreamRef.current, remoteAudioAnalyserRef, remoteAudioCleanupRef);
      }
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
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }
      if (state === "connected") {
        setPhase("in-call");
        setError("");
      }
      if (state === "failed") {
        setError("Connection lost. Please try again.");
      }
      if (state === "disconnected") {
        disconnectTimeoutRef.current = setTimeout(() => {
          if (pc.connectionState === "disconnected") {
            setError("Connection lost. Please try again.");
          }
        }, 2500);
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

  async function flushPendingIceCandidates(pc) {
    if (!pc?.remoteDescription?.type || !pendingIceCandidatesRef.current.length) return;

    const queuedCandidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      console.log("Flushing queued ICE candidate");
      await pc.addIceCandidate(candidate);
    }
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
        await flushPendingIceCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", {
          code,
          data: { type: "answer", description: pc.localDescription },
        });
      } else if (data?.type === "answer") {
        console.log("Setting remote answer");
        await pc.setRemoteDescription(new RTCSessionDescription(data.description));
        await flushPendingIceCandidates(pc);
      } else if (data?.type === "ice") {
        if (data.candidate) {
          const candidate = new RTCIceCandidate(data.candidate);
          if (pc.remoteDescription?.type) {
            console.log("Adding ICE candidate");
            await pc.addIceCandidate(candidate);
          } else {
            console.log("Queueing ICE candidate until remote description is ready");
            pendingIceCandidatesRef.current.push(candidate);
          }
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
    pendingIceCandidatesRef.current = [];
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    localAudioCleanupRef.current?.();
    remoteAudioCleanupRef.current?.();
    localAudioCleanupRef.current = null;
    remoteAudioCleanupRef.current = null;
    localAudioAnalyserRef.current = null;
    remoteAudioAnalyserRef.current = null;
    setLocalAudioLevel(0);
    setRemoteAudioLevel(0);

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
    setCamOn(!isVoiceRoom);
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

    function onRoomJoined({ roomType: joinedRoomType }) {
      if (joinedRoomType) {
        setRoomType(joinedRoomType);
      }
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
  }, [socket, showChat, setRoomType]);

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
    if (!next) {
      setLocalAudioLevel(0);
    }
  }

  function toggleCam() {
    if (isVoiceRoom) return;
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCamOn(next);
  }

  async function swapCamera() {
    if (isVoiceRoom) return;
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
          <div className="mb-4 inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.22em] text-blue-200">
            {roomLabel}
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-6">Waiting for someone to join</h1>
          <div className="bg-slate-900/55 p-8 rounded-[30px] border border-white/10 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400 mb-3">Room code</div>
            <div className="text-5xl font-semibold tracking-[0.25em] mb-6">{formatCode(roomCode)}</div>
            <p className="text-slate-400">Share this code with your friend to start the {isVoiceRoom ? "voice call" : "call"}.</p>
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
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={isVoiceRoom ? "absolute h-0 w-0 opacity-0 pointer-events-none" : "absolute inset-0 w-full h-full object-cover"}
      />

      {isVoiceRoom ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-4 py-10">
          <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[#0b141a] px-4 pb-8 pt-10 shadow-2xl shadow-black/40 sm:rounded-[36px] sm:px-6 sm:pt-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.14),_transparent_26%),linear-gradient(180deg,_rgba(11,20,26,0.96),_rgba(17,27,33,0.98))]" />

            <div className="relative z-10 flex flex-1 flex-col items-center pb-28 text-center sm:pb-32">
              <div className="mt-12 flex items-center justify-center sm:mt-16">
                <div
                  className="flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-[#1f2c34] text-4xl font-semibold text-white shadow-[0_20px_80px_rgba(0,0,0,0.35)] transition-transform duration-150 sm:h-40 sm:w-40 sm:text-5xl"
                  style={{ transform: `scale(${1 + remoteAudioLevel * 0.22})` }}
                >
                  F
                </div>
              </div>

              <div className="mt-6 text-[28px] font-semibold tracking-tight text-white sm:mt-8 sm:text-3xl">Friend</div>
              <div className="mt-2 px-4 text-sm text-slate-300">
                {remoteAudioLevel > 0.12 ? "Speaking..." : phase === "in-call" ? "Voice call in progress" : "Calling..."}
              </div>

              <div className="mt-6 w-full max-w-[220px] sm:mt-8 sm:max-w-[240px]">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#25d366] transition-[width] duration-150"
                    style={{ width: `${Math.max(8, remoteAudioLevel * 100)}%` }}
                  />
                </div>
              </div>

              <div className="mt-auto w-full pt-10">
                <div className="flex w-full items-center gap-3 rounded-[22px] border border-white/8 bg-white/5 px-3.5 py-3 text-left shadow-lg shadow-black/10 backdrop-blur-sm sm:justify-between sm:rounded-[28px] sm:px-5 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold tracking-tight text-white sm:text-[15px]">You</div>
                    <div className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400 sm:text-[11px] sm:tracking-[0.16em]">
                      {localAudioLevel > 0.12 ? "Speaking" : micOn ? "Microphone on" : "Microphone muted"}
                    </div>
                  </div>
                  <div className="w-[88px] shrink-0 sm:ml-4 sm:w-24">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10 sm:h-2">
                      <div
                        className="h-full rounded-full bg-[#7ae582] transition-[width] duration-150"
                        style={{ width: `${Math.max(8, localAudioLevel * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
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
            style={facingMode === "user" ? { transform: "scaleX(-1)" } : {}}
          />
        </div>
      )}

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-center items-center z-20">
        <div
          className={`max-w-[calc(100%-2rem)] text-center text-xs font-medium text-white shadow-lg shadow-black/20 backdrop-blur-xl border sm:text-sm ${
            isVoiceRoom
              ? "rounded-[22px] border-white/10 bg-slate-950/55 px-4 py-2.5 sm:rounded-[24px] sm:px-5 sm:py-3"
              : "rounded-full border-white/10 bg-slate-900/45 px-4 py-2"
          }`}
        >
          {roomLabel} • {phase === "connecting" ? "Connecting..." : phase === "in-call" ? "In Call" : "Waiting"}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-rose-500/85 text-white px-4 py-2.5 rounded-2xl z-20 shadow-lg shadow-black/20 backdrop-blur-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className={`absolute left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-[24px] border border-white/10 bg-slate-950/55 px-2.5 py-2.5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:max-w-none sm:gap-3 sm:rounded-[28px] sm:px-4 sm:py-3 ${
        isVoiceRoom ? "bottom-10 sm:bottom-12" : "bottom-4 sm:bottom-8"
      }`}>
        <button
          onClick={toggleMic}
          className={`flex h-10 w-10 items-center justify-center rounded-[16px] border transition-all duration-200 sm:h-12 sm:w-12 sm:rounded-[18px] ${
            micOn
              ? "border-white/10 bg-white/8 text-white hover:-translate-y-0.5 hover:bg-white/14"
              : "border-red-400/30 bg-red-500 text-white hover:-translate-y-0.5 hover:bg-red-600"
          }`}
        >
          {micOn ? <Mic size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" /> : <MicOff size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />}
        </button>
        <button
          onClick={toggleCam}
          className={`flex h-10 w-10 items-center justify-center rounded-[16px] border transition-all duration-200 sm:h-12 sm:w-12 sm:rounded-[18px] ${
            camOn
              ? "border-white/10 bg-white/8 text-white hover:-translate-y-0.5 hover:bg-white/14"
              : "border-red-400/30 bg-red-500 text-white hover:-translate-y-0.5 hover:bg-red-600"
          } ${isVoiceRoom ? "hidden" : ""}`}
        >
          {camOn ? <Video size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" /> : <VideoOff size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />}
        </button>
        <button
          ref={chatButtonRef}
          onClick={() => setShowChat((prev) => !prev)}
          className={`relative flex h-10 w-10 items-center justify-center rounded-[16px] border transition-all duration-200 sm:h-12 sm:w-12 sm:rounded-[18px] ${
            showChat
              ? "border-blue-300/30 bg-blue-500 text-white shadow-lg shadow-blue-950/30"
              : "border-white/10 bg-white/8 text-white hover:-translate-y-0.5 hover:bg-white/14"
          }`}
        >
          <MessageCircle size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
          {hasUnreadMessage && !showChat && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
          )}
        </button>
        <button
          onClick={swapCamera}
          className={`flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-white/8 text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/14 sm:h-12 sm:w-12 sm:rounded-[18px] ${
            isVoiceRoom ? "hidden" : ""
          }`}
        >
          <RotateCcw size={20} className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
        </button>
        <button
          onClick={endCall}
          className="ml-1 flex h-12 w-12 rotate-[135deg] items-center justify-center rounded-[20px] border border-red-300/20 bg-[#ff3b30] text-white shadow-xl shadow-red-950/40 transition-all duration-200 hover:scale-[1.03] hover:bg-[#ff554b] sm:ml-2 sm:h-16 sm:w-16 sm:rounded-[26px]"
        >
          <Phone size={24} strokeWidth={3.1} className="h-5 w-5 text-white sm:h-7 sm:w-7" />
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

function attachAudioAnalyser(stream, analyserRef, cleanupRef) {
  cleanupRef.current?.();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    analyserRef.current = null;
    cleanupRef.current = null;
    return;
  }

  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  source.connect(analyser);
  analyserRef.current = analyser;

  cleanupRef.current = () => {
    try {
      source.disconnect();
    } catch {}
    try {
      analyser.disconnect();
    } catch {}
    try {
      audioContext.close();
    } catch {}
  };
}

function readAnalyserLevel(analyser) {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;

  for (let i = 0; i < data.length; i += 1) {
    const normalized = (data[i] - 128) / 128;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / data.length);
  return Math.min(1, rms * 4);
}
