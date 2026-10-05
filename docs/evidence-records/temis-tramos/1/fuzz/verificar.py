"""Verificador independiente de TEMIS-CF-1: reimplementa la forma canonica en Python (sin compartir codigo con src/)
y compara bytes y digests contra los casos que genero Node. Reglas de forma-canonica.md."""
import hashlib, json, sys, unicodedata

def esc(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"': out.append('\\"')
        elif ch == '\\': out.append('\\\\')
        elif ch == '\b': out.append('\\b')
        elif ch == '\t': out.append('\\t')
        elif ch == '\n': out.append('\\n')
        elif ch == '\f': out.append('\\f')
        elif ch == '\r': out.append('\\r')
        elif o < 0x20: out.append('\\u%04x' % o)
        else: out.append(ch)
    out.append('"')
    return ''.join(out)

def canon(v):
    if v is None: return 'null'
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, int): return str(v)
    if isinstance(v, str): return esc(unicodedata.normalize('NFC', v))
    if isinstance(v, list): return '[' + ','.join(canon(x) for x in v) + ']'
    if isinstance(v, dict):
        items = {}
        for k, x in v.items():
            nk = unicodedata.normalize('NFC', k)
            if nk in items: raise ValueError('clave duplicada tras NFC')
            items[nk] = x
        orden = sorted(items.keys(), key=lambda k: k.encode('utf-8'))
        return '{' + ','.join(esc(k) + ':' + canon(items[k]) for k in orden) + '}'
    raise ValueError('tipo no admitido')

casos = json.load(open(sys.argv[1], encoding='utf-8'))
ok = mal = errores_esperados = errores_discrepantes = 0
for c in casos:
    try:
        valor = json.loads(c['texto'])
        mia = canon(valor).encode('utf-8')
    except Exception as e:
        if 'error' in c: errores_esperados += 1
        else:
            errores_discrepantes += 1; print('python rechaza y node acepta:', repr(c['texto'])[:90], e)
        continue
    if 'error' in c:
        errores_discrepantes += 1; print('node rechaza y python acepta:', repr(c['texto'])[:90], c['error']); continue
    if mia.hex() == c['canonicoHex'] and hashlib.sha256(mia).hexdigest() == c['digest']: ok += 1
    else:
        mal += 1
        if mal <= 3: print('DISCREPANCIA', repr(c['texto'])[:120]); print(' node  :', bytes.fromhex(c['canonicoHex']).decode()[:120]); print(' python:', mia.decode()[:120])
print(f'iguales={ok} discrepancias={mal} rechazos_coincidentes={errores_esperados} rechazos_discrepantes={errores_discrepantes}')
sys.exit(1 if (mal or errores_discrepantes) else 0)
