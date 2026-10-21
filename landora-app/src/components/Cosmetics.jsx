import { useCollection } from "../lib/useCollection";
import { equippedOf, safeEmoji } from "../lib/rpg";

// Visual da persona (loja "Visual"): moldura do avatar, tag junto ao nome e cor do nome.
// Os estilos ficam em styles.css (.fx-frame-*, .fx-tag-*, .fx-name-*).

export const frameClass = (w) => {
  const f = equippedOf(w, "frame");
  return f ? ` fx-frame-${f.fx}` : "";
};
export const nameClass = (w) => {
  const c = equippedOf(w, "color");
  return c ? ` fx-name-${c.fx}` : "";
};

// Avatar (emoji) da persona com a moldura equipada.
export function PersonaAvatar({ wallet, size = "", title }) {
  return (
    <span className={"rpg-ava" + (size ? ` ${size}` : "") + frameClass(wallet)} title={title}>
      {safeEmoji(wallet?.persona?.emoji)}
    </span>
  );
}

// Tag equipada (ex.: VIP, CHEFE). Não mostra nada se não tiver.
export function TagChip({ wallet }) {
  const t = equippedOf(wallet, "tag");
  if (!t) return null;
  return <span className={`rpg-tag fx-tag-${t.fx}`}>{t.label}</span>;
}

// Nome com a cor equipada + a tag ao lado.
export function PersonaName({ wallet, name, tag = true }) {
  return (
    <span className="rpg-namewrap">
      <span className={"rpg-name" + nameClass(wallet)}>{name ?? wallet?.persona?.name}</span>
      {tag && <TagChip wallet={wallet} />}
    </span>
  );
}

// Para o chat e outras telas que só têm o uid: busca a carteira (lista compartilhada, uma conexão só)
// e mostra o nome com cor e a tag. Sem visual equipado, vira só o texto do nome.
export function NameWithTag({ uid, name }) {
  const { data } = useCollection("wallets");
  const wallet = data.find((w) => w.id === uid);
  if (!wallet) return <span>{name}</span>;
  return <PersonaName wallet={wallet} name={name} />;
}

// Mostra o item da loja como será visto (moldura no avatar, tag, nome colorido).
export function CosmeticPreview({ item, wallet }) {
  if (item.type === "frame") return <span className={`rpg-ava sm fx-frame-${item.fx}`}>{safeEmoji(wallet?.persona?.emoji) || "😎"}</span>;
  if (item.type === "tag") return <span className={`rpg-tag fx-tag-${item.fx}`}>{item.label}</span>;
  return <span className={`rpg-name fx-name-${item.fx}`}>{wallet?.persona?.name || "Nome"}</span>;
}
