import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

// Quem está agora num canal de voz (presença das calls, atualizada a cada 15 s).
export function useVoiceMembers(callId) {
  const [members, setMembers] = useState([]);
  useEffect(() => {
    if (!callId) return undefined;
    return onSnapshot(
      collection(db, "calls", callId, "participants"),
      (snap) => {
        const now = Date.now();
        const byUid = new Map();
        snap.docs.forEach((d) => {
          const data = d.data();
          if (Math.abs(now - (data.lastSeen || 0)) > 90000) return; // saiu sem avisar
          const cur = byUid.get(data.uid);
          if (!cur || (data.joinedAt || 0) > (cur.joinedAt || 0)) byUid.set(data.uid, { id: d.id, ...data });
        });
        setMembers([...byUid.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)));
      },
      () => setMembers([])
    );
  }, [callId]);
  return members;
}
