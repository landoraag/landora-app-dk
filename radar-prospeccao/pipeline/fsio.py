"""Leitura e escrita no Firestore (projeto landora-app-dk) para o pipeline do Radar.

Credencial: variável FIREBASE_SERVICE_ACCOUNT com o JSON da conta de serviço (segredo do GitHub Actions),
ou GOOGLE_APPLICATION_CREDENTIALS apontando para o arquivo. Sem credencial, usa a pasta ./fs_local
(modo de teste offline: cada documento vira um arquivo JSON).

Coleções do Radar (todas com prefixo radar_ para não misturar com o app):
  radar_base/atual            {gerado, mes_receita, cidades, total, partes, bytes}
  radar_base/atual/partes/N   {d: <pedaço do JSON gzip+base64 da base>}
  radar_state/<nome>          {partes, atualizado} + radar_state/<nome>/partes/N  (memória do pipeline)
  radar_config/geral          {cidades:[{nome,uf,dia,hora,ativa}]}
  radar_pedidos, radar_manuais, radar_funil, radar_execucoes, ...
"""
import base64, gzip, json, os

PART = 900_000  # caracteres por documento (limite do Firestore é 1 MiB)
_db = None


def db():
    global _db
    if _db is not None: return _db
    sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):  # testes com o emulador local
        from google.cloud import firestore as gfs
        _db = gfs.Client(project=os.environ.get("FIREBASE_PROJECT_ID", "landora-app-dk"))
        return _db
    if sa or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        import firebase_admin
        from firebase_admin import credentials, firestore
        cred = credentials.Certificate(json.loads(sa)) if sa else credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {"projectId": os.environ.get("FIREBASE_PROJECT_ID", "landora-app-dk")})
        _db = firestore.client()
    else:
        _db = Local()
    return _db


# --------------------------------------------------------------- modo offline (testes)
class _Snap:
    def __init__(self, id, data): self.id, self._d = id, data
    @property
    def exists(self): return self._d is not None
    def to_dict(self): return self._d
    @property
    def reference(self): return None


class _Doc:
    def __init__(self, root, path): self.root, self.path, self.id = root, path, path.split("/")[-1]
    def _f(self): return os.path.join(self.root, self.path + ".json")
    def get(self):
        try: return _Snap(self.id, json.load(open(self._f())))
        except FileNotFoundError: return _Snap(self.id, None)
    def set(self, data, merge=False):
        os.makedirs(os.path.dirname(self._f()), exist_ok=True)
        cur = self.get().to_dict() or {} if merge else {}
        cur.update(data); json.dump(cur, open(self._f(), "w"), ensure_ascii=False)
    def update(self, data): self.set(data, merge=True)
    def delete(self):
        try: os.remove(self._f())
        except FileNotFoundError: pass
    def collection(self, name): return _Col(self.root, self.path + "/" + name)


class _Col:
    def __init__(self, root, path): self.root, self.path = root, path
    def document(self, id): return _Doc(self.root, self.path + "/" + id)
    def stream(self):
        d = os.path.join(self.root, self.path)
        if not os.path.isdir(d): return []
        return [_Snap(f[:-5], json.load(open(os.path.join(d, f)))) for f in sorted(os.listdir(d)) if f.endswith(".json")]
    def where(self, *a, **k): return self


class Local:
    def __init__(self, root=None): self.root = root or os.environ.get("FS_LOCAL") or os.path.abspath("fs_local")
    def collection(self, name): return _Col(self.root, name)
    def document(self, path): return _Doc(self.root, path)


def doc(path):
    d = db()
    return d.document(path)


def col(path):
    return db().collection(path)


def stream(path):
    return [(s.id, s.to_dict()) for s in col(path).stream()]


# --------------------------------------------------------------- blobs grandes em pedaços
def _pack(obj):
    return base64.b64encode(gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), 9)).decode()


def _unpack(s):
    return json.loads(gzip.decompress(base64.b64decode(s)).decode())


def put_blob(path, obj, extra=None):
    s = _pack(obj)
    parts = [s[i:i + PART] for i in range(0, len(s), PART)] or [""]
    d = doc(path)
    for i, p in enumerate(parts):
        d.collection("partes").document(str(i)).set({"d": p})
    meta = {"partes": len(parts), "bytes": len(s), **(extra or {})}
    d.set(meta)  # o documento principal é gravado por último: o site só lê partes completas
    for i in range(len(parts), len(parts) + 20):  # limpa pedaços antigos que sobraram
        sn = d.collection("partes").document(str(i)).get()
        if not sn.exists: break
        d.collection("partes").document(str(i)).delete()
    return meta


def get_blob(path, default=None):
    m = doc(path).get()
    if not m.exists: return default
    n = m.to_dict().get("partes", 0)
    s = "".join(doc(path).collection("partes").document(str(i)).get().to_dict()["d"] for i in range(n))
    return _unpack(s) if s else default
