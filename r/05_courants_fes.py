#!/usr/bin/env python3
"""
05_courants_fes.py — Extraction des courants de marée FES2022 sur une grille
=============================================================================

Génère data/courants_grid.json : amplitude effective (cm/s) et phase effective
(°) des principales constituantes harmoniques de courant (U=Est, V=Nord) sur
une grille régulière couvrant la baie de Saint-Malo.

Les constituantes "effectives" sont calculées à partir d'un ajustement moindres-
carrés sur une simulation FES2022 d'un mois de référence. Elles incorporent les
corrections nodales f et u propres à l'année en cours, et restent valables ~1 an.

Pré-requis FES2022 (courants) :
  fes2022/eastward_velocity/{wave}.nc.xz   (composante U)
  fes2022/northward_velocity/{wave}.nc.xz  (composante V)

Sortie :
  data/courants_grid.json
  pwa/data/courants_grid.json
  docs/data/courants_grid.json   (si le dossier existe)

Usage :
  python r/05_courants_fes.py [--test]

  --test  : trace quelques vecteurs pour vérifier la cohérence

Dépendances :
  pip install pyfes netCDF4 numpy
"""

from __future__ import annotations

import argparse
import glob
import json
import lzma
import os
import pathlib
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import netCDF4
import numpy as np
import pyfes

# ── Configuration ────────────────────────────────────────────────────────────

ROOT    = pathlib.Path(__file__).parent.parent
FES_DIR = ROOT / 'fes2022'
DATA_DIR = ROOT / 'data'
PWA_DIR  = ROOT / 'pwa' / 'data'
DOCS_DIR = ROOT / 'docs' / 'data'

# Bounding-box de la grille (baie de Saint-Malo + approches)
BBOX = dict(lat_min=48.30, lat_max=48.95, lon_min=-2.60, lon_max=-1.40)

# Résolution FES2022 (1/30°) — on utilise 1/16° pour limiter la taille du JSON
GRID_RES = 1.0 / 16.0   # ~7 km : compromis taille/précision

# Période de référence pour l'ajustement harmonique (35 jours, pas de 30 min)
REF_START = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
N_DAYS    = 35
DT_MIN    = 30   # pas de temps en minutes

# Constituantes à exporter (principales pour les courants de marée)
CONSTITUANTES = [
    'M2', 'S2', 'N2', 'K1', 'O1', 'K2', 'P1', 'Q1',
    'M4', 'MS4', 'MN4', 'Mu2', 'Nu2', 'L2', '2N2',
]

# Fréquences angulaires (degrés/heure) — utilisées côté JS
OMEGA_DEG_H = {
    'M2':   28.9841042, 'S2':   30.0000000, 'N2':  28.4397295,
    'K1':   15.0410686, 'O1':   13.9430356, 'K2':  30.0821372,
    'P1':   14.9589314, 'Q1':   13.3986609, 'M4':  57.9682084,
    'MS4':  58.9841042, 'MN4':  57.4238337, 'Mu2': 27.9682084,
    'Nu2':  28.5125831, 'L2':   29.5284789, '2N2': 27.8953548,
}

# Mappage nom de constituante → nom de fichier FES (minuscules)
CONSTITUENT_TO_FILE = {
    'M2': 'm2', 'S2': 's2', 'N2': 'n2', 'K1': 'k1', 'O1': 'o1',
    'K2': 'k2', 'P1': 'p1', 'Q1': 'q1', 'M4': 'm4', 'MS4': 'ms4',
    'MN4': 'mn4', 'Mu2': 'mu2', 'Nu2': 'nu2', 'L2': 'l2', '2N2': '2n2',
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _nc_path(component: str, wave: str) -> pathlib.Path | None:
    """Retourne le chemin du fichier NetCDF (décompressé ou non) pour un composant."""
    fname = CONSTITUENT_TO_FILE.get(wave, wave.lower())
    # Chercher en priorité un .nc déjà décompressé
    p_nc  = FES_DIR / component / f'{fname}.nc'
    p_xz  = FES_DIR / component / f'{fname}.nc.xz'
    if p_nc.exists():  return p_nc
    if p_xz.exists():  return p_xz
    return None


def _extract_nc_xz(xz_path: pathlib.Path, tmp_dir: str) -> pathlib.Path:
    """Décompresse un .nc.xz dans un dossier temporaire, retourne le path .nc."""
    nc_name = xz_path.stem  # supprime .xz → garde .nc
    out_path = pathlib.Path(tmp_dir) / nc_name
    with lzma.open(xz_path, 'rb') as f_in, open(out_path, 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
    return out_path


def _read_amp_phase(nc_path: pathlib.Path, lats: np.ndarray, lons_fes: np.ndarray):
    """
    Lit amplitude (cm/s) et phase (°) depuis un fichier FES NetCDF.
    Les points (lat, lon) sont interpolés bilinéairement sur la grille FES.
    Retourne (amp, phase) tableaux 1-D, NaN là où les données sont masquées.
    """
    with netCDF4.Dataset(nc_path) as ds:
        # Variables standards FES2022
        var_amp   = 'amplitude' if 'amplitude' in ds.variables else 'amp'
        var_phase = 'phase'     if 'phase'     in ds.variables else 'pha'
        lat_var   = 'lat'       if 'lat'       in ds.variables else 'latitude'
        lon_var   = 'lon'       if 'lon'       in ds.variables else 'longitude'

        fes_lat = ds.variables[lat_var][:].astype(float)   # croissant
        fes_lon = ds.variables[lon_var][:].astype(float)   # 0–360

        amp_full   = ds.variables[var_amp][:].astype(float)
        phase_full = ds.variables[var_phase][:].astype(float)

        # Remplacement des valeurs masquées / fill_value par NaN
        fill_amp   = ds.variables[var_amp]._FillValue   if hasattr(ds.variables[var_amp], '_FillValue') else 9999.0
        fill_phase = ds.variables[var_phase]._FillValue if hasattr(ds.variables[var_phase], '_FillValue') else 9999.0
        amp_full[amp_full   >= fill_amp   * 0.9] = np.nan
        phase_full[phase_full >= fill_phase * 0.9] = np.nan

    amps   = np.full(len(lats), np.nan)
    phases = np.full(len(lats), np.nan)

    for i, (lat, lon_fes) in enumerate(zip(lats, lons_fes)):
        # Indices encadrants
        j0 = np.searchsorted(fes_lat, lat) - 1
        k0 = np.searchsorted(fes_lon, lon_fes) - 1
        j0 = max(0, min(j0, len(fes_lat) - 2))
        k0 = max(0, min(k0, len(fes_lon) - 2))

        # Pondération bilinéaire
        dlat = fes_lat[j0 + 1] - fes_lat[j0]
        dlon = fes_lon[k0 + 1] - fes_lon[k0]
        fy = (lat     - fes_lat[j0]) / dlat if dlat else 0
        fx = (lon_fes - fes_lon[k0]) / dlon if dlon else 0

        a00 = amp_full[j0,   k0];   p00 = phase_full[j0,   k0]
        a10 = amp_full[j0+1, k0];   p10 = phase_full[j0+1, k0]
        a01 = amp_full[j0,   k0+1]; p01 = phase_full[j0,   k0+1]
        a11 = amp_full[j0+1, k0+1]; p11 = phase_full[j0+1, k0+1]

        # Ignorer si n'importe quel coin est NaN
        if any(np.isnan(v) for v in [a00, a10, a01, a11, p00, p10, p01, p11]):
            continue

        # Interpolation bilinéaire des parties réelles et imaginaires
        re_f = lambda p: np.cos(np.radians(p))
        im_f = lambda p: np.sin(np.radians(p))

        def interp(c00, c10, c01, c11):
            return ((1-fy)*(1-fx)*c00 + fy*(1-fx)*c10 +
                    (1-fy)*fx*c01     + fy*fx*c11)

        # Amp = interpolation directe (cm/s)
        amps[i] = interp(a00, a10, a01, a11)

        # Phase = interpolation sur le cercle unité
        re = interp(re_f(p00), re_f(p10), re_f(p01), re_f(p11))
        im = interp(im_f(p00), im_f(p10), im_f(p01), im_f(p11))
        phases[i] = np.degrees(np.arctan2(im, re))

    return amps, phases


def _compute_effective_constituents(
    lats: np.ndarray,
    lons: np.ndarray,
    constituents_u: dict,  # wave → {'amp': np.ndarray, 'phase': np.ndarray}
    constituents_v: dict,
) -> dict:
    """
    Calcule les constituantes harmoniques "effectives" (intégrant les
    corrections nodales) par synthèse pyfes + ajustement moindres-carrés.
    Retourne un dict par point avec U_n, V_n (amp cm/s, phase_eff °).
    """
    # Série temporelle de référence (30 min pendant N_DAYS jours)
    n_steps = N_DAYS * 24 * (60 // DT_MIN)
    times = np.array([
        REF_START + timedelta(minutes=i * DT_MIN)
        for i in range(n_steps)
    ])
    t_hours = np.array([i * DT_MIN / 60.0 for i in range(n_steps)])  # heures depuis REF_START

    n_pts = len(lats)
    n_const = len(CONSTITUANTES)

    # Résultats
    out_u = np.full((n_pts, n_const, 2), np.nan)  # [:, :, 0]=amp, [:, :, 1]=phase_eff
    out_v = np.full((n_pts, n_const, 2), np.nan)

    # Pour chaque point : évaluation de la série temporelle par pyfes
    # puis ajustement harmonique par moindres-carrés.
    print(f"  Ajustement harmonique sur {n_pts} points × {n_const} constituantes...")

    # Construction du design matrix pour le fit (sinus + cosinus)
    # x(t) = Σ [a_n*cos(ω_n*t) + b_n*sin(ω_n*t)]
    # → H_n = sqrt(a_n²+b_n²), phi_n = atan2(b_n, a_n)
    omegas_rad = np.array([np.radians(OMEGA_DEG_H[c]) for c in CONSTITUANTES])  # rad/h
    A = np.zeros((n_steps, 2 * n_const))
    for k, omega in enumerate(omegas_rad):
        A[:, 2*k]   = np.cos(omega * t_hours)
        A[:, 2*k+1] = np.sin(omega * t_hours)

    for i in range(n_pts):
        if i % 50 == 0:
            print(f"    Point {i+1}/{n_pts}...", end='\r', flush=True)

        # Vérifier que toutes les constituantes ont des données pour ce point
        u_ok = all(not np.isnan(constituents_u[c]['amp'][i]) for c in CONSTITUANTES)
        v_ok = all(not np.isnan(constituents_v[c]['amp'][i]) for c in CONSTITUANTES)
        if not (u_ok and v_ok):
            continue

        # Construire le dict pyfes pour ce point
        pyfes_u = {
            c: (float(constituents_u[c]['amp'][i]),
                float(constituents_u[c]['phase'][i]))
            for c in CONSTITUANTES
        }
        pyfes_v = {
            c: (float(constituents_v[c]['amp'][i]),
                float(constituents_v[c]['phase'][i]))
            for c in CONSTITUANTES
        }

        try:
            # Évaluation par pyfes (gère les corrections nodales)
            u_ts = pyfes.evaluate_tide_from_constituents(times, pyfes_u)
            v_ts = pyfes.evaluate_tide_from_constituents(times, pyfes_v)
        except Exception as e:
            print(f"\n    ⚠ pyfes erreur au point {i}: {e}")
            continue

        # Ajustement moindres-carrés
        for ts, out in [(u_ts, out_u), (v_ts, out_v)]:
            coefs, _, _, _ = np.linalg.lstsq(A, ts, rcond=None)
            for k, c_name in enumerate(CONSTITUANTES):
                a = coefs[2*k]
                b = coefs[2*k+1]
                out[i, k, 0] = np.sqrt(a**2 + b**2)     # amplitude effective
                out[i, k, 1] = np.degrees(np.arctan2(b, a))  # phase effective (°)

    print()
    return {'u': out_u, 'v': out_v}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Extraction courants FES2022')
    parser.add_argument('--test', action='store_true', help='Afficher un résumé de test')
    args = parser.parse_args()

    # ── 1. Grille ────────────────────────────────────────────────────────────
    lats_1d = np.arange(BBOX['lat_min'], BBOX['lat_max'] + GRID_RES/2, GRID_RES)
    lons_1d = np.arange(BBOX['lon_min'], BBOX['lon_max'] + GRID_RES/2, GRID_RES)
    lats_2d, lons_2d = np.meshgrid(lats_1d, lons_1d, indexing='ij')
    lats_flat = lats_2d.ravel()
    lons_flat = lons_2d.ravel()
    lons_fes_flat = lons_flat + 360.0  # FES utilise 0-360

    n_pts = len(lats_flat)
    print(f"Grille : {len(lats_1d)} × {len(lons_1d)} = {n_pts} points")

    # ── 2. Lecture des fichiers FES2022 ──────────────────────────────────────
    print("Lecture des fichiers FES2022 courants…")
    constituents_u = {}
    constituents_v = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        for wave in CONSTITUANTES:
            for component, store in [('eastward_velocity', constituents_u),
                                      ('northward_velocity', constituents_v)]:
                fpath = _nc_path(component, wave)
                if fpath is None:
                    print(f"  ⚠ Fichier manquant : fes2022/{component}/{CONSTITUENT_TO_FILE[wave]}.nc[.xz] — {wave} ignoré")
                    store[wave] = {'amp': np.full(n_pts, np.nan), 'phase': np.full(n_pts, np.nan)}
                    continue

                print(f"  Lecture {component}/{fpath.name}…")
                nc_path = _extract_nc_xz(fpath, tmpdir) if fpath.suffix == '.xz' else fpath
                amp, phase = _read_amp_phase(nc_path, lats_flat, lons_fes_flat)
                store[wave] = {'amp': amp, 'phase': phase}
                # Supprimer le .nc temporaire pour libérer la mémoire disque
                if fpath.suffix == '.xz' and nc_path.exists():
                    nc_path.unlink()

    # Vérifier que des données ont été trouvées
    n_valid = sum(
        1 for i in range(n_pts)
        if not np.isnan(constituents_u['M2']['amp'][i])
    )
    if n_valid == 0:
        print("\n❌ Aucun fichier FES2022 courant trouvé dans fes2022/eastward_velocity/ et fes2022/northward_velocity/")
        print("   Installez les fichiers FES2022 (eastward_velocity, northward_velocity) et relancez.")
        sys.exit(1)
    print(f"  {n_valid}/{n_pts} points avec données valides")

    # ── 3. Calcul des constituantes effectives ───────────────────────────────
    print("Calcul des constituantes effectives (ajustement harmonique)…")
    eff = _compute_effective_constituents(lats_flat, lons_flat, constituents_u, constituents_v)

    # ── 4. Construction du JSON ──────────────────────────────────────────────
    print("Construction du JSON…")
    points = []
    for i in range(n_pts):
        # Sauter les points entièrement NaN (mer non-couverte ou terre)
        if np.all(np.isnan(eff['u'][i, :, 0])):
            continue
        u_vals = []
        v_vals = []
        for k in range(len(CONSTITUANTES)):
            a_u = eff['u'][i, k, 0]
            p_u = eff['u'][i, k, 1]
            a_v = eff['v'][i, k, 0]
            p_v = eff['v'][i, k, 1]
            # Conserver uniquement si l'amplitude est significative (> 0.1 cm/s)
            u_vals.append(round(float(a_u), 3) if not np.isnan(a_u) else 0.0)
            u_vals.append(round(float(p_u), 2) if not np.isnan(p_u) else 0.0)
            v_vals.append(round(float(a_v), 3) if not np.isnan(a_v) else 0.0)
            v_vals.append(round(float(p_v), 2) if not np.isnan(p_v) else 0.0)
        points.append({
            'lat': round(float(lats_flat[i]), 4),
            'lon': round(float(lons_flat[i]), 4),
            'u':   u_vals,   # [amp0, phi0, amp1, phi1, ...] en cm/s et degrés
            'v':   v_vals,
        })

    output = {
        'meta': {
            'description': 'Courants de marée FES2022 — Baie de Saint-Malo',
            'bbox': [BBOX['lon_min'], BBOX['lat_min'], BBOX['lon_max'], BBOX['lat_max']],
            'res_deg': GRID_RES,
            't_ref': REF_START.isoformat(),      # référence temporelle pour la synthèse JS
            'units_amp': 'cm/s',
            'units_phase': 'degrees',
            'formula': 'u(t) = sum_n amp_n * cos(omega_n * dt_hours + phi_n)',
            'dt_hours': 'heures écoulées depuis t_ref (UTC)',
            'constituants': CONSTITUANTES,
            'omega_deg_h': {c: OMEGA_DEG_H[c] for c in CONSTITUANTES},
            'n_points': len(points),
            'generated': datetime.now(timezone.utc).isoformat(),
        },
        'points': points,
    }

    json_str = json.dumps(output, separators=(',', ':'))  # compact
    size_kb  = len(json_str.encode()) / 1024
    print(f"  {len(points)} points, {size_kb:.0f} kB")

    # ── 5. Écriture ──────────────────────────────────────────────────────────
    for dest_dir in [DATA_DIR, PWA_DIR, DOCS_DIR]:
        if not dest_dir.exists():
            print(f"  ↷ Dossier inexistant, ignoré : {dest_dir}")
            continue
        out_path = dest_dir / 'courants_grid.json'
        out_path.write_text(json_str, encoding='utf-8')
        print(f"  ✅ {out_path}")

    # ── 6. Test optionnel ─────────────────────────────────────────────────────
    if args.test and points:
        print("\n── Test : courant calculé à Saint-Malo (2026-01-15 00:00 UTC) ──")
        # Chercher le point le plus proche de Saint-Malo
        target_lat, target_lon = 48.637, -2.025
        best = min(points, key=lambda p: (p['lat']-target_lat)**2 + (p['lon']-target_lon)**2)
        dt_h = (datetime(2026, 1, 15, 0, 0, tzinfo=timezone.utc) - REF_START).total_seconds() / 3600
        u = v = 0.0
        for k, c in enumerate(CONSTITUANTES):
            omega = np.radians(OMEGA_DEG_H[c])
            amp_u = best['u'][2*k];   phi_u = np.radians(best['u'][2*k+1])
            amp_v = best['v'][2*k];   phi_v = np.radians(best['v'][2*k+1])
            u += amp_u * np.cos(omega * dt_h + phi_u)
            v += amp_v * np.cos(omega * dt_h + phi_v)
        speed = np.hypot(u, v)
        direction = np.degrees(np.arctan2(u, v)) % 360
        print(f"  Point : lat={best['lat']}, lon={best['lon']}")
        print(f"  U={u:.2f} cm/s, V={v:.2f} cm/s → vitesse={speed:.2f} cm/s, dir={direction:.0f}°")

    print("\nTerminé.")


if __name__ == '__main__':
    main()
