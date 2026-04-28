import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Lobby from "./components/Lobby";
import Call from "./components/Call";
import Login from "./components/Login";
import AuthMenu from "./components/AuthMenu";
import { auth, authConfigError } from "./firebase";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const SOCKET_URL = import.meta.env.DEV ? window.location.origin : SERVER_URL;
const SOCKET_OPTIONS = import.meta.env.DEV
  ? {
      autoConnect: false,
      path: "/socket.io",
      transports: ["polling"],
      upgrade: false,
    }
  : {
      autoConnect: false,
      transports: ["websocket"],
    };

export default function App() {
  const [view, setView] = useState("lobby");
  const [socket] = useState(() => io(SOCKET_URL, SOCKET_OPTIONS));
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomType, setRoomType] = useState("video");
  const [isHost, setIsHost] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authUser) {
      socket.connect();
      return;
    }

    socket.disconnect();
  }, [authUser, socket]);

  function handleEnterCall(newPhase) {
    setPhase(newPhase);
    setView("call");
  }

  function handleBack() {
    setView("lobby");
    setPhase("lobby");
    setRoomCode("");
    setJoinCode("");
    setIsHost(false);
    setError("");
    setMessages([]);
    setChatInput("");
  }

  async function handleLogout() {
    if (!auth || logoutPending) return;

    setLogoutPending(true);

    try {
      handleBack();
      socket.disconnect();
      await signOut(auth);
    } finally {
      setLogoutPending(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.16),_transparent_24%)] pointer-events-none" />
        <div className="relative z-10 text-center rounded-[28px] border border-white/10 bg-slate-900/55 px-8 py-10 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Video Call</h1>
          <p className="text-slate-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <Login configError={authConfigError} />;
  }

  if (view === "lobby") {
    return (
      <>
        <AuthMenu
          email={authUser.email}
          onLogout={handleLogout}
          isLoading={logoutPending}
        />
        <Lobby
          socket={socket}
          onEnterCall={handleEnterCall}
          roomType={roomType}
          setRoomType={setRoomType}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          isHost={isHost}
          setIsHost={setIsHost}
          error={error}
          setError={setError}
        />
      </>
    );
  } else {
    return (
      <>
        <AuthMenu
          email={authUser.email}
          onLogout={handleLogout}
          isLoading={logoutPending}
        />
        <Call
          socket={socket}
          onBack={handleBack}
          roomType={roomType}
          setRoomType={setRoomType}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          isHost={isHost}
          phase={phase}
          setPhase={setPhase}
          error={error}
          setError={setError}
          messages={messages}
          setMessages={setMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
        />
      </>
    );
  }
}
