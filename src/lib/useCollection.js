import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

export function useCollection(name, orderField = null, direction = "asc") {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(db, name);
    const q = orderField ? query(ref, orderBy(orderField, direction)) : ref;
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(`Erro lendo ${name}:`, err);
        setLoading(false);
      }
    );
    return unsub;
  }, [name, orderField, direction]);

  return { data, loading };
}
