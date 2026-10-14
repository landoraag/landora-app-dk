import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";

const EMPTY = { name: "", phone: "", location: "", email: "", brandName: "" };

export default function Clientes() {
  const { data: clientes } = useCollection("clients", "createdAt", "desc");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (editingId) {
      await updateDoc(doc(db, "clients", editingId), form);
      setEditingId(null);
    } else {
      await addDoc(collection(db, "clients"), { ...form, createdAt: serverTimestamp() });
    }
    setForm(EMPTY);
  }

  function startEdit(c) {
    setForm({ name: c.name, phone: c.phone, location: c.location, email: c.email, brandName: c.brandName });
    setEditingId(c.id);
  }

  function cancelEdit() {
    setForm(EMPTY);
    setEditingId(null);
  }

  async function handleDelete(id) {
    if (!confirm("Remover este cliente? Vendas já lançadas não serão alteradas.")) return;
    await deleteDoc(doc(db, "clients", id));
  }

  return (
    <div>
      <header className="content-header">
        <h2>Clientes</h2>
        <p className="muted">Cadastro simples para linkar nas vendas.</p>
      </header>

      <form onSubmit={handleSubmit} className="inline-form">
        <label className="grow">
          Nome
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Telefone
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" />
        </label>
        <label>
          Localização
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </label>
        <label>
          E-mail
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Marca
          <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
        </label>
        <div className="modal-actions">
          {editingId && <button type="button" className="btn-link" onClick={cancelEdit}>cancelar</button>}
          <button className="btn btn-gradient" type="submit">{editingId ? "Salvar" : "Adicionar"}</button>
        </div>
      </form>

      <table className="ledger-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Marca</th>
            <th>Telefone</th>
            <th>Localização</th>
            <th>E-mail</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.brandName || "—"}</td>
              <td>{c.phone || "—"}</td>
              <td>{c.location || "—"}</td>
              <td className="muted">{c.email || "—"}</td>
              <td className="row-actions">
                <button className="btn-link" onClick={() => startEdit(c)}>editar</button>
                <button className="btn-link danger" onClick={() => handleDelete(c.id)}>remover</button>
              </td>
            </tr>
          ))}
          {clientes.length === 0 && (
            <tr><td colSpan={6} className="muted empty">Nenhum cliente cadastrado ainda.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
