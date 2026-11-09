#!/usr/bin/env python3
"""Orquestrador do Radar (roda de hora em hora no GitHub Actions).

1. Lê radar_config/geral e a fila radar_pedidos.
2. Decide se há trabalho: cidade com agenda nesta hora (horário de Brasília), pedido "atualizar agora",
   cidade nova ou verificações online novas. Se não houver, sai em segundos.
3. Confere tamanho e data dos arquivos da Receita. Só baixa (20-60 min) se a Receita publicou base nova
   ou se entrou cidade nova. Senão, recalcula a partir da base guardada no Firestore.
4. Cruza prospecções do mapa, recalcula nota, geolocaliza, publica a base e registra a execução.

Uso: python3 run.py [--forcar] [--sem-download] [--agora "AAAA-MM-DDTHH:MM"]
"""
import datetime, json, os, re, sys, time, traceback
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
WORK = os.environ.get("RADAR_WORK", os.path.join(os.getcwd(), "radar_work"))
os.makedirs(WORK, exist_ok=True); os.chdir(WORK)
import fsio  # noqa: E402
import radar  # noqa: E402  (cria state/ data/ raw/ no diretório atual)

BRT = ZoneInfo("America/Sao_Paulo")
ARGS = sys.argv[1:]
NOW = datetime.datetime.now(BRT)
if "--agora" in ARGS: NOW = datetime.datetime.fromisoformat(ARGS[ARGS.index("--agora") + 1]).replace(tzinfo=BRT)
DEFAULT_CIDADES = [{"nome": "Itapeva", "uf": "SP", "dia": 1, "hora": "14:00", "ativa": True},
                   {"nome": "Piraju", "uf": "SP", "dia": 1, "hora": "14:00", "ativa": True}]
STATES = ["web", "geo", "sites"]


def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)


def js_weekday(d): return (d.weekday() + 1) % 7  # 0 = domingo, igual ao site


def due(c):
    if c.get("ativa") is False: return False
    h = int(str(c.get("hora", "14:00")).split(":")[0])
    return js_weekday(NOW) == int(c.get("dia", 1)) and NOW.hour == h


def key(c): return f'{radar.slug(c["nome"])}/{c.get("uf", "SP").upper()}'


def main():
    cfg_doc = fsio.doc("radar_config/geral").get()
    cfg = cfg_doc.to_dict() if cfg_doc.exists else {}
    cidades = cfg.get("cidades") or DEFAULT_CIDADES
    ativas = [c for c in cidades if c.get("ativa") is not False]
    pedidos = [(i, p) for i, p in fsio.stream("radar_pedidos") if p.get("status") == "pendente"]
    novas_verif = [(i, v) for i, v in fsio.stream("radar_verificacoes") if not v.get("aplicada")]
    rstate = fsio.doc("radar_state/receita").get()
    rstate = rstate.to_dict() if rstate.exists else {}
    cidades_feitas = set(rstate.get("cidades", []))
    novas_cidades = [c for c in ativas if key(c) not in cidades_feitas]
    agendadas = [c for c in ativas if due(c)]
    pedidos_atualizar = [p for p in pedidos if p[1].get("tipo") in ("cidade", "atualizar")]
    forcar = "--forcar" in ARGS

    log("agora", NOW.isoformat(timespec="minutes"), "| agendadas:", [c["nome"] for c in agendadas],
        "| novas:", [c["nome"] for c in novas_cidades], "| pedidos:", len(pedidos), "| verificações novas:", len(novas_verif))
    if not (forcar or agendadas or novas_cidades or pedidos_atualizar or novas_verif):
        log("Nada a fazer nesta hora."); return 0

    inicio = datetime.datetime.now(BRT).isoformat(timespec="seconds")
    resumo, ok = [], True
    try:
        # ---------- memória do pipeline
        for n in STATES:
            data = fsio.get_blob(f"radar_state/{n}")
            if data is None:
                seed = os.path.join(HERE, "seed", f"{n}.json")
                data = json.load(open(seed)) if os.path.exists(seed) else {}
            radar.jsave(f"state/{n}.json", data)
        web = radar.jload("state/web.json", {})
        for i, v in novas_verif:
            for cnpj, info in (v.get("itens") or {}).items():
                info = {k: info[k] for k in ("status", "instagram", "facebook", "whatsapp", "site", "plataforma", "obs") if info.get(k)}
                if info.get("status") in ("confirmado", "nao_encontrado"):
                    info["data"] = v.get("data", NOW.date().isoformat()); web[cnpj] = info
        radar.jsave("state/web.json", web)
        if novas_verif: resumo.append(f"{sum(len(v.get('itens') or {}) for _, v in novas_verif)} verificações online aplicadas")
        verif_pedidos = [p.get("alvo") for _, p in pedidos if p.get("tipo") == "verificar"]
        radar.jsave("state/pedidos_verif.json", verif_pedidos)

        # ---------- a Receita mudou?
        fp = radar.receita_fingerprint()
        log("Receita:", fp)
        mudou = fp["fp"] != rstate.get("fp")
        precisa_baixar = (forcar or mudou or novas_cidades) and "--sem-download" not in ARGS
        base = None if precisa_baixar else fsio.get_blob("radar_state/base")
        if base is None and "--sem-download" not in ARGS: precisa_baixar = True
        json.dump([{"nome": c["nome"], "uf": c.get("uf", "SP")} for c in ativas], open("cidades.json", "w"), ensure_ascii=False)
        if precisa_baixar:
            log("Baixando a base da Receita", fp["mes"], "(", "base nova" if mudou else "cidade nova/forçado", ")")
            radar.cmd_download("cidades.json")
            radar.cmd_build("cidades.json")
            fsio.put_blob("radar_state/base", radar.jload("state/base.json", []))
            resumo.append(f"base da Receita {fp['mes']} baixada")
        else:
            log("Receita sem mudança desde", rstate.get("conferido", "?"), "— recalculando sem baixar")
            base = [l for l in (base or []) if any(l["cidade"] == c["nome"] for c in ativas)]
            radar.jsave("state/base.json", base)
            radar.cmd_score()
            resumo.append(f"Receita sem novidade ({fp['mes']}), base reaproveitada")

        # ---------- prospecções feitas no mapa
        manuais = [{"id": i, **m} for i, m in fsio.stream("radar_manuais") if m.get("status") != "incorporado"]
        incorporadas = 0
        if manuais:
            json.dump(manuais, open("manuais.json", "w"), ensure_ascii=False)
            radar.cmd_manual("manuais.json")
            match = radar.jload("state/manual_match.json", {})
            for m in manuais:
                hit = match.get(m["id"])
                if hit:
                    novo = re.sub(r"\D", "", hit["cnpj"])
                    old = fsio.doc(f"radar_funil/M-{m['id']}").get()
                    if old.exists and not fsio.doc(f"radar_funil/{novo}").get().exists:
                        fsio.doc(f"radar_funil/{novo}").set(old.to_dict())
                    if old.exists: fsio.doc(f"radar_funil/M-{m['id']}").delete()
                    fsio.doc(f"radar_manuais/{m['id']}").delete(); incorporadas += 1
                else:
                    falhas = int(m.get("falhas", 0)) + 1
                    f = fsio.doc(f"radar_funil/M-{m['id']}").get()
                    etapa = (f.to_dict() or {}).get("etapa", "novo") if f.exists else "novo"
                    if falhas >= 3 and etapa == "novo": fsio.doc(f"radar_manuais/{m['id']}").delete()
                    else: fsio.doc(f"radar_manuais/{m['id']}").update({"status": "nao_encontrado", "falhas": falhas})
            resumo.append(f"{incorporadas} de {len(manuais)} prospecções do mapa achadas na Receita")

        # ---------- nota, mapa, exportação
        radar.cmd_score()
        radar.cmd_geocode()
        radar.cmd_export("cidades.json")
        out = json.load(open("data/leads.json"))
        out["meta"]["mes_receita"] = fp["mes"]
        L = out["leads"]
        antes = fsio.doc("radar_base/atual").get()
        antes_total = (antes.to_dict() or {}).get("total", 0) if antes.exists else 0
        if antes_total and len(L) < 0.7 * antes_total and not forcar and len(ativas) >= len((antes.to_dict() or {}).get("cidades", [])):
            raise RuntimeError(f"a base caiu de {antes_total} para {len(L)} empresas; publicação cancelada para não perder dados")
        if not L: raise RuntimeError("a base ficou vazia; publicação cancelada")
        assert not any(re.search(r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}", l["n"] + l.get("d", "")) for l in L), "CPF em nome"
        fsio.put_blob("radar_base/atual", out, {**out["meta"], "total": len(L)})
        prosp = [l for l in L if not l.get("x")]
        from collections import Counter
        cnt = Counter(l["f"] for l in prosp)
        br = lambda n: f"{n:,}".replace(",", ".")
        resumo.insert(0, f"{br(len(prosp))} prospectáveis ({br(cnt['A'])} muito fácil, {br(cnt['B'])} fácil)")

        # ---------- lista para a verificação online (lida pelo Claude a partir do GitHub)
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf): radar.cmd_verify_list(60)
        todo = json.loads(buf.getvalue())
        for t in todo: t.pop("tel", None)
        json.dump({"gerado": NOW.isoformat(timespec="minutes"), "empresas": todo}, open("verify_todo.json", "w"), ensure_ascii=False, indent=1)

        # ---------- salva memória
        for n in STATES: fsio.put_blob(f"radar_state/{n}", radar.jload(f"state/{n}.json", {}))
        fsio.doc("radar_state/receita").set({"fp": fp["fp"], "mes": fp["mes"], "bytes": fp["bytes"],
                                             "cidades": sorted({key(c) for c in ativas}), "conferido": NOW.isoformat(timespec="minutes")})
        for i, _ in novas_verif: fsio.doc(f"radar_verificacoes/{i}").update({"aplicada": True})
        agora = datetime.datetime.now(BRT).isoformat(timespec="seconds")
        for i, _ in pedidos: fsio.doc(f"radar_pedidos/{i}").update({"status": "feito", "feitoEm": agora})
    except Exception as e:
        ok = False; traceback.print_exc()
        resumo = [f"falhou: {str(e)[:180]}"]
    fim = datetime.datetime.now(BRT)
    fsio.doc(f"radar_execucoes/{fim.strftime('%Y%m%d-%H%M')}").set({
        "inicio": inicio, "fim": fim.isoformat(timespec="seconds"), "ok": ok,
        "cidades": [c["nome"] for c in ativas], "motivo": "agenda" if agendadas else ("pedido" if pedidos_atualizar else ("cidade nova" if novas_cidades else ("verificação" if novas_verif else "forçado"))),
        "resumo": " · ".join(resumo)})
    log("FIM", "ok" if ok else "FALHOU", "·", " · ".join(resumo))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
