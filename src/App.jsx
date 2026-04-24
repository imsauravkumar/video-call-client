import { useState } from "react";
import { io } from "socket.io-client";
import Lobby from "./components/Lobby";
import Call from "./components/Call";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

export default function App() {
  const [view, setView] = useState("lobby");
  const [socket] = useState(() => io(SERVER_URL));
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

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

  if (view === "lobby") {
    return (
      <Lobby
        socket={socket}
        onEnterCall={handleEnterCall}
        roomCode={roomCode}
        setRoomCode={setRoomCode}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        isHost={isHost}
        setIsHost={setIsHost}
        error={error}
        setError={setError}
      />
    );
  } else {
    return (
      <Call
        socket={socket}
        onBack={handleBack}
        roomCode={roomCode}
        setRoomCode={setRoomCode}
        phase={phase}
        setPhase={setPhase}
        error={error}
        setError={setError}
        messages={messages}
        setMessages={setMessages}
        chatInput={chatInput}
        setChatInput={setChatInput}
      />
    );
  }
}