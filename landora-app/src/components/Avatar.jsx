import { useEffect, useState } from "react";

// Foto de perfil redonda. Sem foto (ou se ela falhar ao carregar), mostra a inicial do nome.
export default function Avatar({ src, name, size = 36 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (src && !failed) {
    return <img className="avatar" style={style} src={src} alt={name || ""} onError={() => setFailed(true)} />;
  }
  return (
    <div className="avatar avatar-fallback" style={style}>
      {initial}
    </div>
  );
}
