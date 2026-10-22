import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "./firebase";

// Mensagens de UM canal, gastando poucas leituras do Firestore:
// - ao abrir, escuta só as últimas LIVE_COUNT (e as novas chegam ao vivo);
// - "carregar mais antigas" busca PAGE_SIZE de cada vez (leitura única, sem ficar escutando).
// Precisa do índice composto chatMessages (channelId + createdAt desc): firestore.indexes.json.
export const LIVE_COUNT = 20;
export const PAGE_SIZE = 100;

const ms = (m) => m.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER; // ainda sem hora = acabou de enviar

export function useChannelMessages(channelId, { older = true } = {}) {
  const [state, setState] = useState({ channelId: null, list: [], hasMore: false, loadingMore: false });
  const map = useRef(new Map());
  const cursor = useRef(null); // última (mais antiga) mensagem carregada
  const exhausted = useRef(false);

  const publish = useCallback(
    (extra = {}) => {
      const list = [...map.current.values()].sort((a, b) => ms(a) - ms(b));
      setState((s) => ({ ...s, channelId, list, ...extra }));
    },
    [channelId]
  );

  useEffect(() => {
    map.current = new Map();
    cursor.current = null;
    exhausted.current = false;
    setState({ channelId: null, list: [], hasMore: false, loadingMore: false });
    if (!channelId) return undefined;
    const q = query(collection(db, "chatMessages"), where("channelId", "==", channelId), orderBy("createdAt", "desc"), limit(LIVE_COUNT));
    return onSnapshot(
      q,
      (snap) => {
        const oldestLive = snap.docs.length ? ms({ createdAt: snap.docs[snap.docs.length - 1].data({ serverTimestamps: "estimate" }).createdAt }) : 0;
        for (const ch of snap.docChanges()) {
          const d = ch.doc;
          const data = { id: d.id, ...d.data({ serverTimestamps: "estimate" }), _doc: d };
          if (ch.type === "removed") {
            // saiu da janela das últimas 20 (continua existindo) ou foi mesmo apagada?
            if (ms(data) < oldestLive) continue;
            map.current.delete(d.id);
          } else map.current.set(d.id, data);
        }
        if (!cursor.current && snap.docs.length) cursor.current = snap.docs[snap.docs.length - 1];
        const full = snap.docs.length >= LIVE_COUNT;
        publish({ hasMore: full && !exhausted.current });
      },
      (err) => {
        console.error("Erro lendo mensagens:", err);
        publish({ hasMore: false });
      }
    );
  }, [channelId, publish]);

  const loadMore = useCallback(async () => {
    if (!older || !channelId || !cursor.current || exhausted.current) return;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      // a âncora é a mais antiga que já temos na tela
      let oldest = null;
      for (const m of map.current.values()) if (!oldest || ms(m) < ms(oldest)) oldest = m;
      const anchor = oldest?._doc || cursor.current;
      const snap = await getDocs(
        query(collection(db, "chatMessages"), where("channelId", "==", channelId), orderBy("createdAt", "desc"), startAfter(anchor), limit(PAGE_SIZE))
      );
      for (const d of snap.docs) map.current.set(d.id, { id: d.id, ...d.data({ serverTimestamps: "estimate" }), _doc: d });
      if (snap.docs.length < PAGE_SIZE) exhausted.current = true;
      publish({ hasMore: !exhausted.current, loadingMore: false });
    } catch (e) {
      console.error("Erro carregando mensagens antigas:", e);
      publish({ loadingMore: false });
    }
  }, [channelId, older, publish]);

  const ready = state.channelId === channelId;
  return { messages: ready ? state.list : [], hasMore: older && ready && state.hasMore, loadingMore: state.loadingMore, loadMore };
}
