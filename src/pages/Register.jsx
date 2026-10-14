import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(email, password, nickname);
      navigate("/");
    } catch (err) {
      setError(err.message || "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src="/logo.png" alt="Landora" className="auth-logo" />
        <p className="auth-sub">Criar conta — só os sócios devem se registrar aqui.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Nickname
            <input value={nickname} required onChange={(e) => setNickname(e.target.value)} placeholder="como te chamamos no chat" />
          </label>
          <label>
            E-mail
            <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
          </label>
          <label>
            Senha
            <input type="password" value={password} required minLength={6} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-gradient" disabled={busy} type="submit">
            {busy ? "Criando…" : "Criar conta"}
          </button>
        </form>

        <p className="auth-foot">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
