import { useEffect, useRef, useState } from "react";
import { LogOut, User } from "lucide-react";

export default function AuthMenu({ email, onLogout, isLoading }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleLogoutClick() {
    setIsOpen(false);
    await onLogout();
  }

  return (
    <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-40" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-slate-100 shadow-xl shadow-black/25 backdrop-blur-xl transition hover:bg-slate-800/80"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Open user menu"
      >
        <User size={18} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-[24px] border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/35 backdrop-blur-xl">
          <div className="px-4 py-3.5 bg-white/5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Signed in</p>
            <p className="truncate text-sm text-slate-200">{email || "Authenticated user"}</p>
          </div>

          <div className="p-2">
            <button
              type="button"
              onClick={handleLogoutClick}
              disabled={isLoading}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogOut size={16} />
              {isLoading ? "Logging out..." : "Log out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
