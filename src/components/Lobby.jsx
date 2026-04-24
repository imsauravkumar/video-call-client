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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="w-full max-w-4xl px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Video Call</h1>
          <p className="text-slate-400">Start or join a video call</p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 text-center">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-xl font-semibold mb-4">Create a room</h2>
            <p className="text-sm text-slate-400 mb-6">
              Start a new video call and share the code with your friend.
            </p>
            <button
              onClick={createRoom}
              className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 active:bg-indigo-600"
            >
              Create room
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-xl font-semibold mb-4">Join a room</h2>
            <p className="text-sm text-slate-400 mb-6">Enter the 6-digit code you received.</p>

            <div className="mb-4 flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                inputMode="numeric"
                placeholder="123 456"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-3 text-sm outline-none focus:border-indigo-500"
              />
              <button
                onClick={joinRoom}
                className="shrink-0 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-white"
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