import { useState } from "react";

export default function Lobby({ socket, onEnterCall, roomCode, setRoomCode, joinCode, setJoinCode, isHost, setIsHost, error, setError }) {
  function createRoom() {
    setError("");
    socket.emit("room:create", async ({ ok, code }) => {
      if (!ok) return setError("Failed to create room.");
      setIsHost(true);
      setRoomCode(code);
      onEnterCall('waiting');
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
      setRoomCode(code);
      onEnterCall('connecting');
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.16),_transparent_24%)] pointer-events-none" />
      <div className="relative z-10 w-full max-w-5xl px-4 sm:px-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">Video Call</h1>
          <p className="text-slate-400 text-sm sm:text-base">Start or join a video call</p>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3.5 text-sm text-rose-200 text-center shadow-lg shadow-black/10 backdrop-blur-sm">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-slate-900/55 p-6 sm:p-7 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <h2 className="text-xl font-semibold mb-3 tracking-tight">Create a room</h2>
            <p className="text-sm text-slate-400 mb-6 leading-6">
              Start a new video call and share the code with your friend.
            </p>
            <button
              onClick={createRoom}
              className="w-full rounded-2xl bg-blue-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-400 active:bg-blue-600"
            >
              Create room
            </button>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-900/55 p-6 sm:p-7 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <h2 className="text-xl font-semibold mb-3 tracking-tight">Join a room</h2>
            <p className="text-sm text-slate-400 mb-6 leading-6">Enter the 6-digit code you received.</p>

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
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
