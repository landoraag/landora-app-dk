import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { uploadImage } from "../../lib/cloudinary";
import Avatar from "../Avatar";
import NotificationSettings from "../NotificationSettings";
import AccessSettings from "../AccessSettings";

// Recorta o centro da imagem em quadrado e reduz, para a foto ficar leve e sem distorcer.
async function squareAvatar(file, size = 320) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d").drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Não consegui processar essa imagem.");
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

export default function Perfil() {
  const { user, profile, updatePhoto, logout } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg("");
    setErr("");
    if (!file.type.startsWith("image/")) return setErr("Escolha um arquivo de imagem (JPG, PNG, WEBP...).");
    if (file.size > 15 * 1024 * 1024) return setErr("A imagem é grande demais (máximo 15 MB).");

    setBusy(true);
    try {
      const small = await squareAvatar(file);
      const { url } = await uploadImage(small, "landora/avatars");
      await updatePhoto(url);
      setMsg("Foto atualizada!");
    } catch (e2) {
      console.error(e2);
      setErr(e2.message || "Não foi possível enviar a foto.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      await updatePhoto(null);
      setMsg("Foto removida.");
    } catch (e2) {
      console.error(e2);
      setErr("Não foi possível remover a foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="content-header">
        <h2>Meu perfil</h2>
        <p className="muted">Sua foto aparece no menu, no chat e nas calls.</p>
      </div>

      <div className="profile-card">
        <Avatar src={profile?.photoURL} name={profile?.nickname} size={132} />

        <div className="profile-info">
          <div className="profile-name">{profile?.nickname}</div>
          <div className="muted">{user?.email}</div>

          <div className="row-actions profile-actions">
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
            <button className="btn btn-gradient" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? "Enviando…" : profile?.photoURL ? "Trocar foto" : "Escolher foto"}
            </button>
            {profile?.photoURL && (
              <button className="btn-link danger" disabled={busy} onClick={removePhoto}>
                Remover foto
              </button>
            )}
          </div>

          {msg && <p className="profile-ok">{msg}</p>}
          {err && <p className="auth-error">{err}</p>}
        </div>
      </div>

      <NotificationSettings />
      <AccessSettings />

      <button className="btn-link profile-logout" onClick={logout}>
        Sair da conta
      </button>
    </div>
  );
}
