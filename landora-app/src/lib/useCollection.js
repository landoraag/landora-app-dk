import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

// Os dados de cada lista ficam guardados em memória e são compartilhados entre as telas.
// Assim, ao trocar de aba, a tela nova já abre com tudo preenchido (antes ela abria vazia e os
// itens "pulavam" na tela um instante depois, o que deixava a transição dura).
// Cada lista tem uma única conexão com o Firestore, mesmo que várias telas usem.
const stores = new Map();
const LINGER_MS = 60000; // mantém a lista viva 1 min depois que ninguém usa (voltar à aba é instantâneo)

function getStore(name, orderField, direction) {
  const key = `${name}|${orderField || ""}|${direction}`;
  let s = stores.get(key);
  if (!s) {
    s = { name, orderField, direction, data: [], loaded: false, subs: new Set(), refs: 0, unsub: null, timer: null };
    stores.set(key, s);
  }
  return s;
}

function retain(s, cb) {
  s.refs += 1;
  s.subs.add(cb);
  clearTimeout(s.timer);
  s.timer = null;
  if (!s.unsub) {
    const ref = collection(db, s.name);
    const q = s.orderField ? query(ref, orderBy(s.orderField, s.direction)) : ref;
    s.unsub = onSnapshot(
      q,
      (snap) => {
        s.data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        s.loaded = true;
        s.subs.forEach((f) => f());
      },
      (err) => {
        console.error(`Erro lendo ${s.name}:`, err);
        s.loaded = true;
        s.subs.forEach((f) => f());
        // Conexão caiu (ex.: saiu da conta): deixa pronta para religar na próxima vez.
        s.unsub = null;
      }
    );
  }
  return () => {
    s.refs -= 1;
    s.subs.delete(cb);
    if (s.refs <= 0) {
      s.timer = setTimeout(() => {
        if (s.refs > 0) return;
        s.unsub?.();
        s.unsub = null;
      }, LINGER_MS);
    }
  };
}

export function useCollection(name, orderField = null, direction = "asc") {
  const s = getStore(name, orderField, direction);
  const [state, setState] = useState(() => ({ data: s.data, loading: !s.loaded }));

  useEffect(() => {
    const st = getStore(name, orderField, direction);
    const sync = () => setState({ data: st.data, loading: !st.loaded });
    const release = retain(st, sync);
    sync();
    return release;
  }, [name, orderField, direction]);

  return state;
}

// Mantém estas listas sempre carregadas enquanto o painel estiver aberto, para todas as abas
// abrirem prontas.
export function useWarmCollections(list) {
  useEffect(() => {
    const releases = list.map(([name, orderField = null, direction = "asc"]) => retain(getStore(name, orderField, direction), () => {}));
    return () => releases.forEach((r) => r());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// Ao sair da conta, desliga tudo e apaga o que estava guardado.
export function clearCollectionCache() {
  for (const s of stores.values()) {
    clearTimeout(s.timer);
    s.unsub?.();
  }
  stores.clear();
}
