import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function Login({ configError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (configError) {
      setError(configError);
      return;
    }

    if (!auth) {
      setError("Firebase authentication is not configured.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      if (err.code === "auth/invalid-credential") {
        setError("Invalid email or password.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please try again later.");
      } else {
        setError("Unable to sign in right now.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(99,102,241,0.14),_transparent_24%)] pointer-events-none" />
      <div className="relative z-10 w-full max-w-md px-4 sm:px-6">
        <div className="rounded-[30px] border border-white/10 bg-slate-900/55 p-6 sm:p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">Video Call</h1>
            <p className="text-slate-400">Sign in with your email and password</p>
          </div>

          {(error || configError) && (
            <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3.5 text-sm text-rose-200 text-center backdrop-blur-sm">
              {error || configError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email id"
                autoComplete="email"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400/50 focus:bg-white/10"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400/50 focus:bg-white/10"
                disabled={isSubmitting}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || Boolean(configError)}
              className="w-full rounded-2xl bg-blue-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-400 active:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
