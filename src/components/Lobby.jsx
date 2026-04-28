import { useState } from "react";

const ROOM_COPY = {
  video: {
    heading: "Video Room",
    title: "Video Call",
    subtitle: "Start or join a video call",
    createDescription: "Start a new video call and share the code with your friend.",
    joinDescription: "Enter the 6-digit code you received for the video room.",
  },
  voice: {
    heading: "Voice Room",
    title: "Voice Call",
    subtitle: "Start or join an audio room with the same smooth flow",
    createDescription: "Start a private voice room and share the code with your friend.",
    joinDescription: "Enter the 6-digit code you received for the voice room.",
  },
};

export default function Lobby({ socket, onEnterCall, roomType, setRoomType, roomCode, setRoomCode, joinCode, setJoinCode, isHost, setIsHost, error, setError }) {
  const roomCopy = ROOM_COPY[roomType] || ROOM_COPY.video;

  function createRoom() {
    setError("");
    socket.emit("room:create", { roomType }, async ({ ok, code, roomType: createdRoomType }) => {
      if (!ok) return setError("Failed to create room.");
      setIsHost(true);
      setRoomType(createdRoomType || roomType);
      setRoomCode(code);
      onEnterCall("waiting");
    });
  }

  function joinRoom() {
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
      setRoomType(res.roomType || roomType);
      setRoomCode(code);
      onEnterCall("connecting");
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.16),_transparent_24%)] pointer-events-none" />
      <div className="relative z-10 w-full max-w-5xl px-4 sm:px-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">Video & Voice Rooms</h1>
          <p className="text-slate-400 text-sm sm:text-base">Choose your room type and jump in with the same polished flow.</p>
        </div>

        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full border border-white/10 bg-slate-900/55 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl">
            {["video", "voice"].map((type) => {
              const isActive = roomType === type;
              return (
                <button
                  key={type}
                  onClick={() => {
                    setRoomType(type);
                    setError("");
                  }}
                  className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                    isActive
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-950/30"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {type === "video" ? "Video Room" : "Voice Room"}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3.5 text-sm text-rose-200 text-center shadow-lg shadow-black/10 backdrop-blur-sm">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-slate-900/55 p-6 sm:p-7 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="mb-4 inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-blue-200">
              {roomCopy.heading}
            </div>
            <h2 className="text-xl font-semibold mb-3 tracking-tight">Create a room</h2>
            <p className="text-sm text-slate-400 mb-6 leading-6">
              {roomCopy.createDescription}
            </p>
            <button
              onClick={createRoom}
              className="w-full rounded-2xl bg-blue-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-400 active:bg-blue-600"
            >
              Create {roomCopy.title}
            </button>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-900/55 p-6 sm:p-7 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <h2 className="text-xl font-semibold mb-3 tracking-tight">Join a room</h2>
            <p className="text-sm text-slate-400 mb-6 leading-6">{roomCopy.joinDescription}</p>

            <div className="mb-4 flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                inputMode="numeric"
                placeholder="123 456"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400/50 focus:bg-white/10"
              />
              <button
                onClick={joinRoom}
                className="shrink-0 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-slate-900 shadow-lg shadow-black/20 transition hover:bg-slate-100"
              >
                Join {roomType === "video" ? "Video" : "Voice"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
