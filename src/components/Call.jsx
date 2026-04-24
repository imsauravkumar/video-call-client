import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Mic, MicOff, Video, VideoOff, RotateCcw, PhoneOff } from "lucide-react";

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

export default function Call({ socket, onBack, roomCode, setRoomCode, phase, setPhase, error, setError, messages, setMessages, chatInput, setChatInput }) {
  const [isHost, setIsHost] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facingMode, setFacingMode] = useState("user");
  const [localVideoPos, setLocalVideoPos] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
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
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
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

  function stopAll(options = { keepError: false }) {
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
    setIsHost(false);
    setPhase("lobby");
    if (!options.keepError) {
      setError("");
    }
  }

  useEffect(() => {
    function onPeerJoined() {
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
      // Chat disabled in full screen mode
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
  }, [socket]);

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
      <div className="fixed inset-0 bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-6">Waiting for someone to join</h1>
          <div className="bg-slate-900/60 p-8 rounded-2xl border border-slate-700">
            <div className="text-sm font-medium text-slate-300 mb-2">Room code</div>
            <div className="text-5xl font-bold tracking-widest mb-6">{formatCode(roomCode)}</div>
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
      {/* Remote Video Background */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Local Video Overlay */}
      <div
        className="absolute w-32 h-24 sm:w-40 sm:h-30 bg-black rounded-lg overflow-hidden shadow-lg cursor-move border border-white/20 z-10"
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
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-20">
        <button
          onClick={leaveCall}
          className="text-white hover:text-gray-300 transition-colors"
        >
          ← Back
        </button>
        <div className="text-white font-semibold">
          {phase === "connecting" ? "Connecting..." : phase === "in-call" ? "In Call" : "Waiting"}
        </div>
        <div></div> {/* Spacer */}
      </div>

      {/* Error Message */}
      {error && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg z-20">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 sm:bottom-8 left-1/2 transform -translate-x-1/2 flex items-center gap-2 sm:gap-4 z-20">
        <button
          onClick={toggleMic}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors ${
            micOn
              ? "bg-white/20 hover:bg-white/30"
              : "bg-red-500 hover:bg-red-600"
          }`}
        >
          {micOn ? <Mic size={18} className="sm:w-5 sm:h-5" /> : <MicOff size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button
          onClick={toggleCam}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors ${
            camOn
              ? "bg-white/20 hover:bg-white/30"
              : "bg-red-500 hover:bg-red-600"
          }`}
        >
          {camOn ? <Video size={18} className="sm:w-5 sm:h-5" /> : <VideoOff size={18} className="sm:w-5 sm:h-5" />}
        </button>
        <button
          onClick={swapCamera}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
        >
          <RotateCcw size={18} className="sm:w-5 sm:h-5" />
        </button>
        <button
          onClick={endCall}
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors ml-2"
        >
          <PhoneOff size={20} className="sm:w-6 sm:h-6" />
        </button>
      </div>
    </div>
  );
}