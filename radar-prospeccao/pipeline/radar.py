#!/usr/bin/env python3
"""Radar de Prospecção - pipeline de atualização.

Uso (sempre dentro de um diretório de trabalho vazio, ex.: ~/radar_work):
  python3 radar.py download  cidades.json        # baixa e filtra a base da Receita (mês mais recente)
  python3 radar.py build     cidades.json        # monta leads, detecta sites, calcula nota
  python3 radar.py verify-list [N]               # lista os N leads "Muito fácil" ainda não verificados online
  python3 radar.py rec '{"<cnpj>": {...}}'       # grava verificações online em state/web.json
  python3 radar.py score                          # recalcula nota/faixa (usa state/web.json)
  python3 radar.py geocode                        # geolocaliza endereços (cache em state/geo.json)
  python3 radar.py tiles     cidades.json        # gera o mapa base offline de cidades novas (data/tiles_<slug>.json)
  python3 radar.py manual    manuais.json        # cruza prospecções feitas no mapa com a base oficial
  python3 radar.py export    cidades.json        # gera data/leads.json para o site

cidades.json = [{"nome": "Itapeva", "uf": "SP"}, ...]
Arquivos de estado (persistem entre execuções, guardados no próprio site):
  state/web.json  verificações online (Instagram/Facebook/WhatsApp/site)
  state/geo.json  cache de geolocalização por rua
"""
import csv, datetime, glob, io, json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request, zipfile
import concurrent.futures as cf
from collections import Counter

if os.path.exists("/root/.ccr/ca-bundle.crt"):
    os.environ.setdefault("SSL_CERT_FILE", "/root/.ccr/ca-bundle.crt")  # só no sandbox do Claude
SHARE = "https://arquivos.receitafederal.gov.br/public.php/webdav"
AUTH = "YggdBLfdninEJX9:"
UA = {"User-Agent": "radar-prospeccao/1.0"}
TODAY = datetime.date.today()
os.makedirs("state", exist_ok=True); os.makedirs("data", exist_ok=True); os.makedirs("raw", exist_ok=True)


def jload(p, d):
    try: return json.load(open(p))
    except Exception: return d


def jsave(p, o): json.dump(o, open(p, "w"), ensure_ascii=False)


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9 ]", " ", t).split()


def slug(t): return "-".join(norm(t)).lower()


# ------------------------------------------------------------------ download
def latest_month():
    out = subprocess.run(["curl", "-s", "-u", AUTH, "-X", "PROPFIND", "-H", "Depth: 1", SHARE + "/"],
                         capture_output=True, text=True).stdout
    ms = sorted(set(re.findall(r"/webdav/(\d{4}-\d{2})/", out)))
    if not ms: sys.exit("Não consegui listar os meses da Receita (PROPFIND). Verifique o acesso a arquivos.receitafederal.gov.br")
    return ms[-1]


def receita_fingerprint():
    """Mês mais recente + tamanho e data de cada arquivo usado. Muda só quando a Receita publica uma base nova."""
    month = latest_month()
    out = subprocess.run(["curl", "-s", "-u", AUTH, "-X", "PROPFIND", "-H", "Depth: 1", f"{SHARE}/{month}/"],
                         capture_output=True, text=True).stdout
    files = []
    for resp in re.findall(r"<d:response>(.*?)</d:response>", out, re.S):
        href = re.search(r"<d:href>([^<]+)</d:href>", resp)
        name = href.group(1).rstrip("/").split("/")[-1] if href else ""
        if not re.match(r"(Estabelecimentos|Empresas|Socios|Simples)\d*\.zip$", name): continue
        size = re.search(r"<d:getcontentlength>(\d+)<", resp)
        mod = re.search(r"<d:getlastmodified>([^<]+)<", resp)
        files.append((name, size.group(1) if size else "", mod.group(1) if mod else ""))
    files.sort()
    if len(files) < 31:
        raise RuntimeError(f"Base da Receita de {month} incompleta ({len(files)} de 31 arquivos): provavelmente ainda está sendo publicada")
    import hashlib
    return {"mes": month, "arquivos": len(files), "bytes": sum(int(f[1] or 0) for f in files),
            "fp": month + ":" + hashlib.sha1(json.dumps(files).encode()).hexdigest()[:16]}


def fetch(month, name):
    dst = f"raw/{name}.zip"
    for t in range(6):
        r = subprocess.run(["curl", "-s", "--fail", "-u", AUTH, "-o", dst, f"{SHARE}/{month}/{name}.zip"])
        if r.returncode == 0 and zipfile.is_zipfile(dst): return dst
        time.sleep(5 * (t + 1))
    raise RuntimeError("falha ao baixar " + name)


def rows_of(zpath):
    z = zipfile.ZipFile(zpath)
    for n in z.namelist():
        with z.open(n) as f:
            yield from csv.reader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")


def city_codes(cidades):
    """nome+UF -> código de município da Receita (o UF é conferido nas linhas de Estabelecimentos)."""
    muni = {r[0]: r[1] for r in rows_of(fetch_cached("Municipios"))}
    want = {}
    for c in cidades:
        key = " ".join(norm(c["nome"]))
        codes = [k for k, v in muni.items() if " ".join(norm(v)) == key]
        if not codes: print("AVISO: cidade não encontrada na Receita:", c["nome"]); continue
        for k in codes: want[k] = (c["nome"], c["uf"].upper())
    return want


_MONTH = None
def fetch_cached(name):
    global _MONTH
    _MONTH = _MONTH or latest_month()
    p = f"raw/{name}.zip"
    return p if os.path.exists(p) else fetch(_MONTH, name)


def filt_est(name, want):
    out = []
    for row in rows_of(fetch_cached(name)):
        if len(row) > 20 and row[20] in want and row[19] == want[row[20]][1]:
            out.append(row)
    os.remove(f"raw/{name}.zip")
    return name, out


def filt_by_basico(name, keep):
    out = [row for row in rows_of(fetch_cached(name)) if row and row[0] in keep]
    os.remove(f"raw/{name}.zip")
    return name, out


def cmd_download(cfg):
    cidades = json.load(open(cfg))
    month = latest_month(); global _MONTH; _MONTH = month
    print("Mês da Receita:", month)
    for n in ("Municipios", "Qualificacoes"):
        fetch_cached(n)
    want = city_codes(cidades)
    print("Municípios:", want)
    est = []
    with cf.ThreadPoolExecutor(5) as ex:
        for name, rows in ex.map(lambda i: filt_est(f"Estabelecimentos{i}", want), range(10)):
            print("ok", name, len(rows), flush=True); est += rows
    keep = {r[0] for r in est}
    res = {"est": est, "emp": [], "soc": [], "sim": []}
    jobs = [(f"Empresas{i}", "emp") for i in range(10)] + [(f"Socios{i}", "soc") for i in range(10)] + [("Simples", "sim")]
    with cf.ThreadPoolExecutor(5) as ex:
        futs = {ex.submit(filt_by_basico, n, keep): k for n, k in jobs}
        for f in cf.as_completed(futs):
            name, rows = f.result(); res[futs[f]] += rows; print("ok", name, len(rows), flush=True)
    res["qual"] = list(rows_of("raw/Qualificacoes.zip"))
    res["muni"] = {k: v for k, v in want.items()}
    res["mes"] = month
    jsave("raw/receita.json", res)
    print("DOWNLOAD OK", month, len(est), "estabelecimentos")


# ------------------------------------------------------------------ build
R = {
 "5611201": ("Restaurante", 3), "5611203": ("Lanchonete / Hamburgueria", 3), "5611204": ("Bar", 2), "5611205": ("Bar", 2),
 "5620104": ("Delivery / Marmitaria", 3), "5620102": ("Buffet / Eventos", 3), "8230002": ("Buffet / Eventos", 3),
 "1091102": ("Padaria / Confeitaria", 2), "4721102": ("Padaria / Confeitaria", 2), "4721104": ("Doceria", 3),
 "9602501": ("Salão / Barbearia", 3), "9602502": ("Estética", 3), "9609206": ("Estúdio de Tatuagem", 3),
 "8630504": ("Odontologia", 3), "8650004": ("Fisioterapia / Pilates", 3), "8650002": ("Nutrição", 3), "8650003": ("Psicologia", 2),
 "8630503": ("Clínica Médica", 1), "8630502": ("Clínica Médica", 1), "8630501": ("Clínica Médica", 1),
 "7500100": ("Veterinária", 3), "4789004": ("Pet Shop", 3), "9609208": ("Pet Shop", 3),
 "9313100": ("Academia", 3), "8591100": ("Academia", 3), "8592901": ("Escola de Dança", 3), "8593700": ("Escola de Idiomas", 2),
 "4511101": ("Revenda de Veículos", 3), "4511102": ("Revenda de Veículos", 3), "4541203": ("Revenda de Motos", 3), "4541204": ("Revenda de Motos", 3),
 "4520001": ("Oficina Mecânica", 2), "4520002": ("Funilaria e Pintura", 2), "4520005": ("Lava-rápido / Estética Automotiva", 2), "4520007": ("Acessórios Automotivos", 2),
 "6821801": ("Imobiliária / Corretor", 2), "6821802": ("Imobiliária / Corretor", 2),
 "6920601": ("Contabilidade", 1), "6911701": ("Advocacia", 1), "8599601": ("Autoescola", 2),
 "5510801": ("Hotel / Pousada", 3), "5590699": ("Hotel / Pousada", 3),
 "4774100": ("Ótica", 2), "4744099": ("Material de Construção", 2), "4744001": ("Material de Construção", 2),
 "3101200": ("Móveis Planejados / Marcenaria", 3), "4754701": ("Loja de Móveis", 2),
 "7420001": ("Fotografia", 3), "4781400": ("Loja de Roupas", 2),
}
FREE = {"gmail.com", "hotmail.com", "yahoo.com.br", "yahoo.com", "outlook.com", "bol.com.br", "uol.com.br", "terra.com.br", "live.com",
        "icloud.com", "msn.com", "ig.com.br", "globo.com", "hotmail.com.br", "outlook.com.br", "r7.com", "zipmail.com.br"}
BADMAIL = {"gmail.com.br", "gmai.com", "mail.com", "hotmai.com", "gmial.com"}
FRANQ = ["odontocompany", "oral sin", "oralsin", "orthodontic", "sorridents", "odontoexcellence", "odonto excellence", "cacau show",
         "boticario", "subway", "chiquinho", "kumon", "wizard", "fisk", "ccaa", "smart fit", "skyfit", "lojas cem", "casas bahia",
         "magazine luiza", "havaianas", "brasil cacau", "amor saude", "amorsaude", "vaccine", "espaco laser", "espacolaser", "lupo",
         "hering", "eudora", "jequiti", "mc donald", "bobs", "pizza hut", "dominos", "kopenhagen", "senac", "sesi", "senai",
         "chilli beans", "agua doce", "nacho man", "oakberry", "the best acai", "lacqua di fiori", "o boticario", "montana grill"]
CPF = re.compile(r"\s*\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")


def fmt_tel(ddd, t):
    t = re.sub(r"\D", "", t or ""); ddd = re.sub(r"\D", "", ddd or "")
    if not t: return None
    if len(t) == 8 and t[0] in "6789": t = "9" + t
    return f"({ddd}) {t[:-4]}-{t[-4:]}" if ddd else t


def title(s): return CPF.sub("", (s or "").strip()).strip().title()


def cmd_build(cfg):
    rec = json.load(open("raw/receita.json"))
    emp = {r[0]: r for r in rec["emp"]}; sim = {r[0]: r for r in rec["sim"]}
    qual = {r[0]: r[1] for r in rec["qual"]}
    soc = {}
    for r in rec["soc"]: soc.setdefault(r[0], []).append(r)
    ativos = [r for r in rec["est"] if r[5] == "02"]
    telc, mailc = Counter(), Counter()
    for r in ativos:
        for t in (r[22], r[24]):
            t = re.sub(r"\D", "", t or "")
            if t: telc[t[-8:]] += 1
        if r[27].strip(): mailc[r[27].strip().lower()] += 1
    # DDD de cada cidade = o mais comum entre as empresas dela
    ddd = {}
    for code in rec["muni"]:
        c = Counter(re.sub(r"\D", "", r[21]) for r in ativos if r[20] == code and r[21].strip())
        ddd[code] = c.most_common(1)[0][0] if c else ""
    leads = []
    for r in ativos:
        cn = r[11]
        if cn not in R: continue
        bas = r[0]; e = emp.get(bas, [""] * 7); s = sim.get(bas)
        cnpj = f"{bas[:2]}.{bas[2:5]}.{bas[5:8]}/{r[1]}-{r[2]}"
        tels = [fmt_tel(r[21], r[22]), fmt_tel(r[23], r[24])]
        raw = [r[22], r[24]]
        email = (r[27] or "").strip().lower()
        dom = email.split("@")[-1] if "@" in email else ""
        ab = datetime.datetime.strptime(r[10], "%Y%m%d").date() if r[10] else None
        mei = bool(s and s[4] == "S" and not s[6].strip("0"))
        nat = e[2]
        socios = [f"{title(x[2])} ({qual.get(x[4], x[4])})" for x in soc.get(bas, [])]
        bons, ruins = [], []
        for t, rw in zip(tels, raw):
            if not t: continue
            d8 = re.sub(r"\D", "", rw)[-8:]
            if telc[d8] >= 3: ruins.append(t + " (contador)")
            elif ddd[r[20]] and not t.startswith("(" + ddd[r[20]]): ruins.append(t + " (outro DDD)")
            elif t not in bons: bons.append(t)
        mail_cont = bool(email) and (mailc[email] >= 3 or dom in BADMAIL)
        rz = (e[1] or "").strip()
        titular = title(re.sub(r"^[\d\.\s]+", "", rz)) if (mei or nat == "2135") else ""
        fant = title(r[4])
        nome = fant or titular or title(re.sub(r"^[\d\.\s]+", "", rz))
        leads.append(dict(cnpj=cnpj, basico=bas, matriz=r[3] == "1", fantasia=fant, razao=title(re.sub(r"^[\d\.\s]+", "", rz)), nome=nome,
                          cidade=rec["muni"][r[20]][0], uf=r[19], ramo=R[cn][0], peso=R[cn][1], cnae=cn,
                          endereco=f"{r[13].title()} {r[14].title()}, {r[15]}{(' - ' + r[16].title()) if r[16].strip() else ''} - {r[17].title()}".strip(),
                          rua=f"{r[13].title()} {r[14].title()}".strip(), bairro=r[17].title(), cep=r[18],
                          tel_receita=bons, tel_ruins=ruins, email="" if mail_cont else email,
                          dominio="" if (dom in FREE or mail_cont or dom in BADMAIL) else dom,
                          abertura=ab.strftime("%d/%m/%Y") if ab else "", idade=((TODAY - ab).days / 365.25) if ab else 0,
                          porte={"01": "ME", "03": "EPP", "05": "Demais"}.get(e[5], ""), mei=mei, titular=titular, socios=socios))
    # dominio usado por 3+ empresas = escritório (contador)
    dc = Counter(l["dominio"] for l in leads if l["dominio"])
    for l in leads:
        if l["dominio"] and dc[l["dominio"]] >= 3: l["dominio"] = ""
    jsave("state/base.json", leads)
    print("base:", len(leads), Counter(l["cidade"] for l in leads))
    sites(leads)
    cmd_score()


STOP = {"ltda", "me", "eireli", "epp", "de", "da", "do", "das", "dos", "e", "a", "o", "cia", "comercio", "servicos", "ss", "sp"}


def words(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    return [x for x in re.findall(r"[a-z0-9]+", t) if x not in STOP and not x.isdigit()]


def http_json(u, headers=None):
    try:
        return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=headers or {}), timeout=15).read())
    except Exception:
        return None


def resolves(d):
    j = http_json(f"https://dns.google/resolve?name={d}&type=A", {"accept": "application/dns-json"})
    return bool(j and j.get("Status") == 0 and j.get("Answer"))


def rdap_docs(d):
    if not d.endswith(".br"): return None
    j = http_json(f"https://rdap.registro.br/domain/{d}")
    if not j: return None
    out = []
    for e in j.get("entities", []):
        for p in e.get("publicIds", []): out.append(re.sub(r"\D", "", p.get("identifier", "")))
    return out


def sites(leads):
    cache = jload("state/sites.json", {})
    def work(l):
        key = l["cnpj"]
        if key in cache and cache[key].get("t", "") >= (TODAY - datetime.timedelta(days=60)).isoformat():
            return key, cache[key]
        cand = []
        if l["dominio"]: cand.append(l["dominio"])
        city = "".join(words(l["cidade"]))
        w = [x for x in words(l["fantasia"]) if x != city]
        if 1 <= len(w) <= 4 and len("".join(w)) >= 5:
            j = "".join(w); cand += [j + ".com.br", j + ".com", j + city + ".com.br"]
        site, prov = "", ""
        toks = {x for x in words(l["fantasia"] + " " + l["razao"]) if len(x) >= 4 and x != city}
        for d in dict.fromkeys(cand):
            if not resolves(d): continue
            docs = rdap_docs(d) or []
            mine = any(x.startswith(l["basico"]) for x in docs if len(x) >= 8)
            if mine or (d == l["dominio"] and any(t in d for t in toks)): site = d; break
            if docs and any(len(x) == 14 for x in docs): continue  # domínio é de outra empresa
            core = d.split(".")[0]
            if not prov and (len(core) >= 12 or (city and city in core and len(core) >= 10)): prov = d
        return key, {"site": site, "prov": "" if site else prov, "t": TODAY.isoformat()}
    with cf.ThreadPoolExecutor(30) as ex:
        for k, v in ex.map(work, leads): cache[k] = v
    jsave("state/sites.json", cache)
    print("sites próprios:", sum(1 for v in cache.values() if v["site"]), "a conferir:", sum(1 for v in cache.values() if v["prov"]))


def cmd_score():
    L = jload("state/base.json", [])
    web = jload("state/web.json", {}); st = jload("state/sites.json", {})
    for l in L:
        w = web.get(l["cnpj"], {}); s0 = st.get(l["cnpj"], {})
        bons = list(l["tel_receita"])
        if w.get("whatsapp") and w["whatsapp"] not in bons: bons.insert(0, w["whatsapp"])
        l["tel_bons"] = bons
        cel = any(re.search(r"\) 9\d{4}-", t) for t in bons)
        l["whats"] = cel
        socs = l["socios"]
        if l["titular"]: l["decisor"] = l["titular"] + (" (MEI)" if l["mei"] else " (titular)")
        elif socs: l["decisor"] = socs[0] if len(socs) == 1 else "; ".join(socs[:3]) + (" e outros" if len(socs) > 3 else "")
        else: l["decisor"] = ""
        sozinho = bool(l["titular"]) or len(socs) == 1
        nm = " ".join(words(l["fantasia"] + " " + l["razao"]))
        l["franquia"] = any(f in nm for f in FRANQ)
        s, why = 0, []
        if cel: s += 30; why.append("WhatsApp direto")
        elif bons: s += 10; why.append("telefone fixo")
        if sozinho: s += 15; why.append("dono decide sozinho")
        s += {3: 20, 2: 12, 1: 3}[l["peso"]]
        if l["peso"] == 3: why.append("ramo em que site gera cliente")
        i = l["idade"] or 0
        if i < 1: s += 8; why.append("aberta há menos de 1 ano")
        elif i <= 8: s += 12; why.append(f"{max(1, int(i))} ano{'s' if int(i) > 1 else ''} de casa, crescendo")
        elif i <= 20: s += 6; why.append(f"{int(i)} anos de mercado")
        else: s += 3; why.append(f"{int(i)} anos de mercado")
        if l["fantasia"]: s += 8; why.append("tem marca (nome fantasia)")
        if l["mei"]: s -= 4
        if not l["matriz"]: s -= 15; why.append("é filial")
        if w.get("instagram"): s += 6; why.append("ativo no Instagram")
        if w.get("plataforma"): s += 6; why.append("já paga " + w["plataforma"])
        if not bons: s -= 40; why.append("sem telefone confiável")
        l["web"] = w
        l["site_proprio"] = w.get("site") or s0.get("site", "")
        l["conferir_site"] = "" if l["site_proprio"] else s0.get("prov", "")
        l["excluir"] = "franquia" if l["franquia"] else ("site: " + l["site_proprio"] if l["site_proprio"] else "")
        l["nota"] = max(0, min(100, s)); l["porque"] = why
        l["faixa"] = "A" if l["nota"] >= 75 else ("B" if l["nota"] >= 58 else "C")
    jsave("state/leads.json", L)
    ok = [l for l in L if not l["excluir"]]
    print("leads:", len(L), "prospectáveis:", len(ok), Counter(l["faixa"] for l in ok))


def cmd_verify_list(n=60):
    L = jload("state/leads.json", []); web = jload("state/web.json", {})
    pri = jload("state/pedidos_verif.json", [])
    todo = [l for l in L if l["cnpj"] in pri and l["cnpj"] not in web]
    todo += sorted([l for l in L if not l["excluir"] and l["faixa"] == "A" and l["cnpj"] not in web and l not in todo],
                   key=lambda l: -l["nota"])
    out = [{"cnpj": l["cnpj"], "nome": l["nome"], "razao": l["razao"], "ramo": l["ramo"], "cidade": l["cidade"], "uf": l["uf"],
            "endereco": l["endereco"], "tel": l["tel_bons"]} for l in todo[:int(n)]]
    print(json.dumps(out, ensure_ascii=False, indent=0))


def cmd_rec(js):
    web = jload("state/web.json", {})
    for k, v in json.loads(js).items():
        v["data"] = TODAY.isoformat(); web[k] = v
    jsave("state/web.json", web); print(len(web), "verificações gravadas")


# ------------------------------------------------------------------ geocode
def nominatim(params):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({**params, "format": "json", "limit": 1, "countrycodes": "br"})
    for _ in range(3):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read())
            time.sleep(1.1); return r
        except Exception:
            time.sleep(5)
    return []


UFN = {"SP": "São Paulo", "PR": "Paraná", "MG": "Minas Gerais", "RJ": "Rio de Janeiro", "SC": "Santa Catarina", "RS": "Rio Grande do Sul",
       "MS": "Mato Grosso do Sul", "GO": "Goiás", "MT": "Mato Grosso", "BA": "Bahia", "ES": "Espírito Santo", "DF": "Distrito Federal"}


def photon(q, city):
    url = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 3, "lang": "default"})
    for _ in range(3):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read())
            for f in r.get("features", []):
                p = f["properties"]
                if " ".join(norm(p.get("city", "") or p.get("county", ""))) == " ".join(norm(city)) or \
                   " ".join(norm(city)) in " ".join(norm(p.get("city", "") + " " + p.get("county", "") + " " + p.get("district", ""))):
                    lon, lat = f["geometry"]["coordinates"]; return [lat, lon]
            return None
        except Exception:
            time.sleep(3)
    return None


def cmd_geocode():
    """Geolocaliza cada rua (Photon, 4 em paralelo; reserva: Nominatim por rua e por CEP)."""
    L = jload("state/leads.json", []); geo = jload("state/geo.json", {})
    for cid, uf in {(l["cidade"], l["uf"]) for l in L}:
        k = "__city__|" + cid
        if not geo.get(k):
            r = nominatim({"city": cid, "state": UFN.get(uf, uf)}); geo[k] = [float(r[0]["lat"]), float(r[0]["lon"]), "cidade"] if r else None
    keys = {}
    for l in L:
        keys.setdefault(f'{l["rua"]}|{l["cidade"]}', (l["rua"], l["cidade"], l["uf"], l["cep"]))
    todo = [k for k in keys if k not in geo]
    def work(k):
        rua, cid, uf, cep = keys[k]
        p = photon(f"{rua}, {cid}, {uf}", cid)
        return k, (p + ["rua"]) if p else None
    with cf.ThreadPoolExecutor(4) as ex:
        for i, (k, v) in enumerate(ex.map(work, todo)):
            geo[k] = v
            if i % 100 == 99: jsave("state/geo.json", geo); print("geo", i + 1, "/", len(todo), flush=True)
    for k in [k for k in todo if not geo.get(k)]:  # reserva: Nominatim (1 req/s)
        rua, cid, uf, cep = keys[k]
        r = nominatim({"street": rua, "city": cid, "state": UFN.get(uf, uf)}); prec = "rua"
        if not r and cep: r = nominatim({"postalcode": f"{cep[:5]}-{cep[5:]}", "country": "Brazil"}); prec = "cep"
        geo[k] = [float(r[0]["lat"]), float(r[0]["lon"]), prec] if r else None
    jsave("state/geo.json", geo); print("geocode ok", sum(1 for v in geo.values() if v), "/", len(geo))


def place(l, geo):
    import hashlib
    g = geo.get(f'{l["rua"]}|{l["cidade"]}')
    prec = g[2] if g else "cidade"
    if g and prec == "cep":
        c = geo.get("__city__|" + l["cidade"])
        if c and (abs(g[0] - c[0]) > 0.25 or abs(g[1] - c[1]) > 0.25): g = None  # CEP fora da cidade: descarta
    if g:
        # valida: precisa estar a até ~15 km do centro da cidade
        c = geo.get("__city__|" + l["cidade"])
        if c and (abs(g[0] - c[0]) > 0.14 or abs(g[1] - c[1]) > 0.14): g = None
    if not g:
        g = geo.get("__city__|" + l["cidade"]); prec = "cidade"
    if not g: return None, None, None
    h = int(hashlib.md5(l["cnpj"].encode()).hexdigest()[:8], 16)
    j = 0.00035 if prec == "rua" else (0.0015 if prec == "cep" else 0.006)
    dx = ((h & 0xFFFF) / 0xFFFF - .5) * 2 * j; dy = ((h >> 16) / 0xFFFF - .5) * 2 * j
    return round(g[0] + dy, 6), round(g[1] + dx, 6), prec


# ------------------------------------------------------------------ tiles (mapa base offline)
import math, base64


def deg2num(lat, lon, z):
    n = 2 ** z; x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def cmd_tiles(cfg, force=False):
    L = jload("state/leads.json", []); geo = jload("state/geo.json", {})
    for c in json.load(open(cfg)):
        out = f"data/tiles_{slug(c['nome'])}.json"
        if os.path.exists(out) and not force: continue
        pts = [place(l, geo) for l in L if l["cidade"] == c["nome"]]
        pts = sorted([p for p in pts if p[0]], key=lambda p: p[0])
        if not pts: continue
        lats = sorted(p[0] for p in pts); lons = sorted(p[1] for p in pts)
        q = lambda a, f: a[int(f * (len(a) - 1))]
        s, n, w, e = q(lats, .02) - .01, q(lats, .98) + .01, q(lons, .02) - .01, q(lons, .98) + .01
        tiles = {}
        for z in range(11, 17):
            pad = {11: .15, 12: .08, 13: .03}.get(z, 0)
            x0, y0 = deg2num(n + pad, w - pad, z); x1, y1 = deg2num(s - pad, e + pad, z)
            if (x1 - x0 + 1) * (y1 - y0 + 1) > 220: continue
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    for _ in range(3):
                        try:
                            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read(); break
                        except Exception: time.sleep(3); b = None
                    if b: tiles[f"{z}/{x}/{y}"] = base64.b64encode(b).decode()
                    time.sleep(0.15)
        jsave(out, {"cidade": c["nome"], "bounds": [s, w, n, e], "attr": "© OpenStreetMap contributors", "tiles": tiles})
        print("tiles", c["nome"], len(tiles))


# ------------------------------------------------------------------ manual (prospecções do mapa)
def cmd_manual(path):
    """manuais.json = lista de docs da coleção 'manuais' do site. Gera state/manual_match.json:
    {doc_id: {"cnpj": ..., "nome": ...} | null}"""
    L = jload("state/leads.json", []); M = json.load(open(path))
    idx_tel = {}; idx_nome = {}
    for l in L:
        for t in l["tel_bons"]: idx_tel[re.sub(r"\D", "", t)[-8:]] = l
        idx_nome.setdefault((" ".join(words(l["nome"])), l["cidade"]), l)
        idx_nome.setdefault((" ".join(words(l["razao"])), l["cidade"]), l)
    res = {}
    for m in M:
        d = m.get("data", m); hit = None
        t = re.sub(r"\D", "", d.get("tel", ""))[-8:]
        if t and t in idx_tel: hit = idx_tel[t]
        if not hit: hit = idx_nome.get((" ".join(words(d.get("nome", ""))), d.get("cidade", "")))
        res[m.get("id", d.get("id"))] = {"cnpj": hit["cnpj"], "nome": hit["nome"]} if hit else None
    jsave("state/manual_match.json", res)
    print(json.dumps(res, ensure_ascii=False))


# ------------------------------------------------------------------ export
def cmd_export(cfg):
    L = jload("state/leads.json", []); geo = jload("state/geo.json", {})
    rec = jload("raw/receita.json", {})
    out = []
    for l in L:
        lat, lon, prec = place(l, geo)
        w = l["web"]
        out.append({k: v for k, v in {
            "id": l["cnpj"], "n": l["nome"], "rz": l["razao"] if l["razao"] != l["nome"] else "", "r": l["ramo"], "c": l["cidade"], "uf": l["uf"],
            "f": l["faixa"], "s": l["nota"], "w": 1 if l["whats"] else 0, "t": l["tel_bons"], "e": l["email"], "d": l["decisor"],
            "so": l["socios"], "a": l["endereco"], "b": l["bairro"], "cep": l["cep"], "ab": l["abertura"], "po": l["porte"],
            "mei": 1 if l["mei"] else 0, "mz": 1 if l["matriz"] else 0, "ig": w.get("instagram", ""), "fb": w.get("facebook", ""),
            "pl": w.get("plataforma", ""), "ob": w.get("obs", ""), "vs": w.get("status", ""), "vd": w.get("data", ""),
            "cs": l["conferir_site"], "pq": l["porque"], "x": l["excluir"], "lat": lat, "lon": lon, "gp": prec,
        }.items() if v not in ("", None, [], 0) or k in ("s", "w")})
    from zoneinfo import ZoneInfo
    meta = {"gerado": datetime.datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="minutes"),  # horário de Brasília, com fuso "mes_receita": rec.get("mes", ""),
            "cidades": json.load(open(cfg)), "total": len(out)}
    jsave("data/leads.json", {"meta": meta, "leads": out})
    print("export ok", len(out), "->", "data/leads.json", os.path.getsize("data/leads.json") // 1024, "KB")


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else ""
    a = sys.argv[2:]
    {"download": lambda: cmd_download(a[0]), "build": lambda: cmd_build(a[0]), "score": cmd_score,
     "verify-list": lambda: cmd_verify_list(*(a or [60])), "rec": lambda: cmd_rec(a[0]), "geocode": cmd_geocode,
     "tiles": lambda: cmd_tiles(a[0], "--force" in a), "manual": lambda: cmd_manual(a[0]), "export": lambda: cmd_export(a[0])
     }.get(c, lambda: print(__doc__))()
