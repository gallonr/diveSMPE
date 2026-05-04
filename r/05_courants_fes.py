#!/usr/bin/env python3
"""
05_courants_fes.py — Extraction des courants de marée FES2014 sur une grille
=============================================================================

Génère data/courants_grid.json à partir des fichiers FES2014 disponibles dans
currents/eastward_velocity.tar.xz et currents/northward_velocity.tar.xz.

Stratégie :
  1. Extraire les archives .tar.xz dans un dossier temporaire.
  2. Pour chaque fichier .nc extrait, lire amp/phase à chaque point de grille.
  3. Synthèse harmonique par ajustement moindres-carrés sur une simulation d'un mois.
  4. Export courants_grid.json.

⚠️  FES2014 complet : 34 constituantes — Téléchargement depuis AVISO :
      https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html
    Constituantes nécessaires pour la Manche : M2, S2, N2, K1, O1 a minima.

Sortie :
  data/courants_grid.json
  pwa/data/courants_grid.json
  docs/data/courants_grid.json   (si le dossier existe)

Usage :
  python r/05_courants_fes.py [--test] [--no-pyfes] [--force]

  --test     : affiche un résumé de test au point Saint-Malo
  --no-pyfes : synthèse directe (sans pyfes, sans corrections nodales)
  --force    : continuer même si les constituantes majeures sont manquantes

Dépendances :
  pip install netCDF4 numpy
  pip install pyfes   (optionnel, recommandé)
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone

import netCDF4
import numpy as np

# ── Configuration ─────────────────────────────────────────────────────────────

ROOT     = pathlib.Path(__file__).parent.parent
CURR_DIR = ROOT / 'currents'
DATA_DIR = ROOT / 'data'
PWA_DIR  = ROOT / 'pwa' / 'data'
DOCS_DIR = ROOT / 'docs' / 'data'

ARCHIVE_U = CURR_DIR / 'eastward_velocity.tar.xz'
ARCHIVE_V = CURR_DIR / 'northward_velocity.tar.xz'

BBOX = dict(lat_min=48.20, lat_max=49.00, lon_min=-2.70, lon_max=-1.30)
GRID_RES = 1.0 / 30.0

REF_START = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
N_DAYS = 35
DT_MIN = 30

OMEGA_DEG_H = {
    '2N2': 27.8953548, 'Eps2': 27.4238337, 'J1':  15.5854433,
    'K1':  15.0410686, 'K2':   30.0821372, 'L2':  29.5284789,
    'La2': 29.4556253, 'M2':   28.9841042, 'M3':  43.4761563,
    'M4':  57.9682084, 'M6':   86.9523126, 'M8': 115.9364168,
    'Mf':   1.0980331, 'MKS2': 29.0662887, 'Mm':   0.5443747,
    'MN4': 57.4238337, 'MS4':  58.9841042, 'MSf':  1.0158958,
    'MSqm': 0.5722428, 'Mtm':   1.6424078, 'Mu2': 27.9682084,
    'N2':  28.4397295, 'N4':   56.8794590, 'Nu2': 28.5125831,
    'O1':  13.9430356, 'P1':   14.9589314, 'Q1':  13.3986609,
    'R2':  30.0410686, 'S1':   15.0000000, 'S2':  30.0000000,
    'S4':  60.0000000, 'Sa':    0.0410686, 'Ssa':  0.0821373,
    'T2':  29.9589314,
}

CONSTITUENT_TO_FILE = {
    '2N2': '2n2', 'Eps2': 'eps2', 'J1': 'j1',
    'K1': 'k1',   'K2': 'k2',    'L2': 'l2',
    'La2': 'la2', 'M2': 'm2',    'M3': 'm3',
    'M4': 'm4',   'M6': 'm6',    'M8': 'm8',
    'Mf': 'mf',   'MKS2': 'mks2','Mm': 'mm',
    'MN4': 'mn4', 'MS4': 'ms4',  'MSf': 'msf',
    'MSqm': 'msqm','Mtm': 'mtm', 'Mu2': 'mu2',
    'N2': 'n2',   'N4': 'n4',    'Nu2': 'nu2',
    'O1': 'o1',   'P1': 'p1',    'Q1': 'q1',
    'R2': 'r2',   'S1': 's1',    'S2': 's2',
    'S4': 's4',   'Sa': 'sa',    'Ssa': 'ssa',
    'T2': 't2',
}

FILE_TO_CONSTITUENT = {v: k for k, v in CONSTITUENT_TO_FILE.items()}

MUST_HAVE = {'M2', 'S2', 'N2', 'K1', 'O1'}

# ── Extraction ────────────────────────────────────────────────────────────────

def _extraire_archive(archive: pathlib.Path, dest: str) -> dict[str, pathlib.Path]:
    result = {}
    print(f"  Extraction {archive.name}…")
    try:
        with tarfile.open(archive, 'r:xz') as tf:
            for member in tf.getmembers():
                if not member.name.endswith('.nc'):
                    continue
                fname = pathlib.Path(member.name).stem
                out_path = pathlib.Path(dest) / f'{fname}.nc'
                try:
                    f_in = tf.extractfile(member)
                    if f_in is None:
                        continue
                    with open(out_path, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out)
                    try:
                        with netCDF4.Dataset(out_path):
                            pass
                        result[fname] = out_path
                        print(f"    ✓ {fname}.nc ({out_path.stat().st_size//1024//1024} MB)")
                    except Exception:
                        out_path.unlink(missing_ok=True)
                        print(f"    ✗ {fname}.nc — NetCDF invalide (tronqué)")
                except Exception as e:
                    print(f"    ✗ {fname}.nc — erreur : {e}")
    except EOFError:
        print(f"    ⚠ Archive tronquée — seuls les fichiers ci-dessus sont utilisables")
    except Exception as e:
        print(f"  ❌ {e}")
    return result


def _read_amp_phase(nc_path: pathlib.Path, lats: np.ndarray, lons_fes: np.ndarray):
    with netCDF4.Dataset(nc_path) as ds:
        vnames = list(ds.variables.keys())
        # FES2022 : 'amplitude' / 'phase'
        # FES2014 : 'Ua' (amplitude) / 'Ug' (Greenwich phase)
        if 'amplitude' in vnames:
            var_amp, var_phase = 'amplitude', 'phase'
        elif 'Ua' in vnames:
            var_amp, var_phase = 'Ua', 'Ug'
        elif 'Va' in vnames:
            var_amp, var_phase = 'Va', 'Vg'
        else:
            var_amp   = next((v for v in vnames if 'amp' in v.lower()), None)
            var_phase = next((v for v in vnames if 'pha' in v.lower() or v.lower() in ('ug','g')), None)
            if var_amp is None or var_phase is None:
                raise KeyError(f"Variables amp/phase introuvables dans {nc_path.name}. Disponibles : {vnames}")

        lat_var = 'lat' if 'lat' in vnames else 'latitude'
        lon_var = 'lon' if 'lon' in vnames else 'longitude'

        fes_lat = np.array(ds.variables[lat_var][:], dtype=float)
        fes_lon = np.array(ds.variables[lon_var][:], dtype=float)
        amp_full   = np.array(ds.variables[var_amp][:],   dtype=float)
        phase_full = np.array(ds.variables[var_phase][:], dtype=float)

        fv_amp   = getattr(ds.variables[var_amp],   '_FillValue', 9.96921e+36)
        fv_phase = getattr(ds.variables[var_phase], '_FillValue', 9.96921e+36)
        amp_full[amp_full     >= fv_amp   * 0.9] = np.nan
        phase_full[phase_full >= fv_phase * 0.9] = np.nan

    amps   = np.full(len(lats), np.nan)
    phases = np.full(len(lats), np.nan)

    for i, (lat, lon_f) in enumerate(zip(lats, lons_fes)):
        j0 = max(0, min(int(np.searchsorted(fes_lat, lat)) - 1, len(fes_lat)-2))
        k0 = max(0, min(int(np.searchsorted(fes_lon, lon_f)) - 1, len(fes_lon)-2))
        dlat = fes_lat[j0+1]-fes_lat[j0] or 1
        dlon = fes_lon[k0+1]-fes_lon[k0] or 1
        fy = (lat   - fes_lat[j0]) / dlat
        fx = (lon_f - fes_lon[k0]) / dlon
        ca = [amp_full[j0,k0],   amp_full[j0+1,k0],   amp_full[j0,k0+1],   amp_full[j0+1,k0+1]]
        cp = [phase_full[j0,k0], phase_full[j0+1,k0], phase_full[j0,k0+1], phase_full[j0+1,k0+1]]
        if any(np.isnan(v) for v in ca+cp):
            continue
        def bil(c00,c10,c01,c11): return (1-fy)*(1-fx)*c00+fy*(1-fx)*c10+(1-fy)*fx*c01+fy*fx*c11
        amps[i] = bil(*ca)
        re = bil(*[np.cos(np.radians(p)) for p in cp])
        im = bil(*[np.sin(np.radians(p)) for p in cp])
        phases[i] = float(np.degrees(np.arctan2(im, re)))

    return amps, phases


def _ajustement(lats, lons, cu, cv, use_pyfes):
    noms    = list(cu.keys())
    n_pts   = len(lats)
    n_const = len(noms)
    n_steps = N_DAYS * 24 * (60 // DT_MIN)
    t_h     = np.arange(n_steps) * DT_MIN / 60.0
    omegas  = np.array([np.radians(OMEGA_DEG_H[c]) for c in noms])

    A = np.zeros((n_steps, 2*n_const))
    for k, w in enumerate(omegas):
        A[:,2*k] = np.cos(w*t_h); A[:,2*k+1] = np.sin(w*t_h)

    out_u = np.full((n_pts, n_const, 2), np.nan)
    out_v = np.full((n_pts, n_const, 2), np.nan)

    pyfes_mod = None
    if use_pyfes:
        try:
            import pyfes as _pyfes; pyfes_mod = _pyfes
        except ImportError:
            print("  ⚠ pyfes non installé — synthèse directe")

    times = [REF_START + timedelta(minutes=int(i*DT_MIN)) for i in range(n_steps)]
    print(f"  Ajustement : {n_pts} pts × {n_const} constituantes…")

    for i in range(n_pts):
        if i % 200 == 0: print(f"    {i+1}/{n_pts}…", end='\r', flush=True)
        if any(np.isnan(cu[c]['amp'][i]) or np.isnan(cv[c]['amp'][i]) for c in noms):
            continue
        for store, out in [(cu, out_u), (cv, out_v)]:
            if pyfes_mod:
                d = {c: (float(store[c]['amp'][i]), float(store[c]['phase'][i])) for c in noms}
                try:
                    ts = pyfes_mod.evaluate_tide_from_constituents(times, d)
                except Exception:
                    ts = sum(store[c]['amp'][i]*np.cos(omegas[k]*t_h - np.radians(store[c]['phase'][i]))
                             for k,c in enumerate(noms))
            else:
                ts = sum(store[c]['amp'][i]*np.cos(omegas[k]*t_h - np.radians(store[c]['phase'][i]))
                         for k,c in enumerate(noms))
            coefs,_,_,_ = np.linalg.lstsq(A, ts, rcond=None)
            for k,c in enumerate(noms):
                a,b = coefs[2*k], coefs[2*k+1]
                out[i,k,0] = np.sqrt(a**2+b**2)
                out[i,k,1] = float(np.degrees(np.arctan2(b,a)))
    print()
    return out_u, out_v


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--test',     action='store_true')
    parser.add_argument('--no-pyfes', action='store_true')
    parser.add_argument('--force',    action='store_true')
    args = parser.parse_args()

    for arc in [ARCHIVE_U, ARCHIVE_V]:
        if not arc.exists():
            print(f"❌ Archive manquante : {arc}")
            print("   Téléchargez FES2014 (courants) depuis AVISO :")
            print("   https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html")
            sys.exit(1)

    lats_1d = np.arange(BBOX['lat_min'], BBOX['lat_max']+GRID_RES/2, GRID_RES)
    lons_1d = np.arange(BBOX['lon_min'], BBOX['lon_max']+GRID_RES/2, GRID_RES)
    lats_2d, lons_2d = np.meshgrid(lats_1d, lons_1d, indexing='ij')
    lats_flat = lats_2d.ravel(); lons_flat = lons_2d.ravel()
    lons_fes  = lons_flat + 360.0
    n_pts = len(lats_flat)
    print(f"Grille : {len(lats_1d)} × {len(lons_1d)} = {n_pts} points\n")

    # Dossier d'extraction permanent — évite de tout ré-extraire à chaque run
    EXTRACT_DIR = ROOT / 'currents' / 'extracted'
    du = str(EXTRACT_DIR / 'u')
    dv = str(EXTRACT_DIR / 'v')
    os.makedirs(du, exist_ok=True)
    os.makedirs(dv, exist_ok=True)

    def _nc_files_cached(directory: str) -> dict[str, pathlib.Path]:
        """Retourne les .nc déjà extraits dans le dossier (valides)."""
        result = {}
        for p in pathlib.Path(directory).glob('*.nc'):
            try:
                with netCDF4.Dataset(p):
                    pass
                result[p.stem] = p
            except Exception:
                pass
        return result

    nc_u_cached = _nc_files_cached(du)
    nc_v_cached = _nc_files_cached(dv)

    n_total = 34  # nombre attendu de constituantes
    if len(nc_u_cached) >= n_total and len(nc_v_cached) >= n_total:
        print(f"Extraction ignorée — {len(nc_u_cached)} fichiers U et {len(nc_v_cached)} fichiers V déjà présents dans currents/extracted/")
        nc_u = nc_u_cached
        nc_v = nc_v_cached
    else:
        print("Extraction archives…")
        if len(nc_u_cached) < n_total:
            nc_u = _extraire_archive(ARCHIVE_U, du)
        else:
            print(f"  → U déjà extrait ({len(nc_u_cached)} fichiers), skip")
            nc_u = nc_u_cached
        if len(nc_v_cached) < n_total:
            nc_v = _extraire_archive(ARCHIVE_V, dv)
        else:
            print(f"  → V déjà extrait ({len(nc_v_cached)} fichiers), skip")
            nc_v = nc_v_cached

    available = sorted(
        {FILE_TO_CONSTITUENT[f] for f in nc_u if f in FILE_TO_CONSTITUENT} &
        {FILE_TO_CONSTITUENT[f] for f in nc_v if f in FILE_TO_CONSTITUENT} &
        set(OMEGA_DEG_H),
        key=lambda c: -OMEGA_DEG_H[c]
    )

    if not available:
        print("❌ Aucune constituante valide commune U/V.")
        sys.exit(1)

    print(f"\nConstituantes disponibles ({len(available)}) : {', '.join(available)}")
    missing = MUST_HAVE - set(available)
    if missing:
        print(f"\n⚠️  MANQUANTES (majeures) : {', '.join(sorted(missing))}")
        print("   Le courant calculé sera TRÈS imprécis sans M2, S2, N2, K1, O1.")
        print("   Re-téléchargez les archives FES2014 complètes depuis AVISO.")
        if not args.force:
            resp = input("   Continuer quand même ? (o/N) : ").strip().lower()
            if resp not in ('o','oui','y','yes'):
                sys.exit(0)

    print("\nLecture amp/phase…")
    cu, cv = {}, {}
    for c in available:
        fname = CONSTITUENT_TO_FILE[c]
        print(f"  {c}…", end=' ', flush=True)
        au, pu = _read_amp_phase(pathlib.Path(nc_u[fname]), lats_flat, lons_fes)
        av, pv = _read_amp_phase(pathlib.Path(nc_v[fname]), lats_flat, lons_fes)
        cu[c] = {'amp': au, 'phase': pu}
        cv[c] = {'amp': av, 'phase': pv}
        print(f"{int(np.sum(~np.isnan(au)))}/{n_pts} pts valides")

    print("\nAjustement harmonique…")
    out_u, out_v = _ajustement(lats_flat, lons_flat, cu, cv, not args.no_pyfes)

    print("Construction JSON…")
    points = []
    for i in range(n_pts):
        if np.all(np.isnan(out_u[i,:,0])): continue
        uv, vv = [], []
        for k in range(len(available)):
            uv += [round(float(out_u[i,k,0]),3) if not np.isnan(out_u[i,k,0]) else 0.0,
                   round(float(out_u[i,k,1]),2) if not np.isnan(out_u[i,k,1]) else 0.0]
            vv += [round(float(out_v[i,k,0]),3) if not np.isnan(out_v[i,k,0]) else 0.0,
                   round(float(out_v[i,k,1]),2) if not np.isnan(out_v[i,k,1]) else 0.0]
        points.append({'lat': round(float(lats_flat[i]),4),
                       'lon': round(float(lons_flat[i]),4),
                       'u': uv, 'v': vv})

    output = {
        'meta': {
            'description': 'Courants de marée FES2014 — Baie de Saint-Malo',
            'source': 'FES2014a, AVISO/CNES — archives partielles',
            'bbox': [BBOX['lon_min'],BBOX['lat_min'],BBOX['lon_max'],BBOX['lat_max']],
            'res_deg': GRID_RES,
            't_ref': REF_START.isoformat(),
            'units_amp': 'cm/s', 'units_phase': 'degrees',
            'formula': 'u(t) = sum_n amp_n * cos(omega_n * dt_hours + phi_n)',
            'dt_hours': 'heures depuis t_ref (UTC)',
            'constituants': available,
            'omega_deg_h': {c: OMEGA_DEG_H[c] for c in available},
            'constituants_manquants': sorted(MUST_HAVE - set(available)),
            'precision': '~3.7 km (FES2014 1/30°) — effets locaux non résolus',
            'n_points': len(points),
            'generated': datetime.now(timezone.utc).isoformat(),
        },
        'points': points,
    }

    js = json.dumps(output, separators=(',',':'))
    print(f"  {len(points)} points, {len(js.encode())//1024} kB")

    for d in [DATA_DIR, PWA_DIR, DOCS_DIR]:
        if not d.exists(): print(f"  ↷ ignoré : {d}"); continue
        p = d / 'courants_grid.json'
        p.write_text(js, encoding='utf-8')
        print(f"  ✅ {p}")

    if args.test and points:
        print("\n── Test Saint-Malo (2026-01-15 00:00 UTC) ──")
        best = min(points, key=lambda p: (p['lat']-48.637)**2+(p['lon']+2.025)**2)
        dt_h = (datetime(2026,1,15,0,0,tzinfo=timezone.utc)-REF_START).total_seconds()/3600
        u=v=0.0
        for k,c in enumerate(available):
            w=np.radians(OMEGA_DEG_H[c])
            u += best['u'][2*k]*np.cos(w*dt_h+np.radians(best['u'][2*k+1]))
            v += best['v'][2*k]*np.cos(w*dt_h+np.radians(best['v'][2*k+1]))
        print(f"  U={u:.2f} cm/s, V={v:.2f} cm/s → {np.hypot(u,v):.2f} cm/s, dir={(np.degrees(np.arctan2(u,v))+360)%360:.0f}°")

    print("\nTerminé.")

if __name__ == '__main__':
    main()
