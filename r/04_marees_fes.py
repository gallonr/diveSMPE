#!/usr/bin/env python3
"""
04_marees_fes.py — Calcul des marées FES2022 pour Saint-Malo
=============================================================
Stratégie :
  1. Décompresser chaque fichier .nc.xz un par un, extraire amp/phase à Saint-Malo,
     supprimer le .nc temporaire → pas de 18 Go sur disque en simultané.
  2. Sauvegarder les constituantes dans data/constituantes_stmalo.json.
  3. Calculer les marées ±365 jours via pyfes.evaluate_tide_from_constituents.
  4. Détecter PM/BM, calculer les coefficients.
  5. Exporter data/marees.json + pwa/data/marees.json.
"""

from __future__ import annotations

import glob
import json
import lzma
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from datetime import date, timedelta

import netCDF4
import numpy as np
import pyfes
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
FES_DIR   = pathlib.Path(__file__).parent.parent / 'fes2022'
DATA_DIR  = pathlib.Path(__file__).parent.parent / 'data'
PWA_DIR   = pathlib.Path(__file__).parent.parent / 'pwa' / 'data'

# Coordonnées Saint-Malo (point de référence marégraphique)
STMALO_LAT =  48.637
STMALO_LON = -2.025   # en degrés décimaux classiques (-180, 180)
STMALO_LON_FES = STMALO_LON + 360  # FES utilise 0-360 → 357.975

# Résolution du modèle FES2022 (1/30°)
FES_RES = 1.0 / 30.0

# Fuseau horaire de sortie (heures locales françaises)
TZ_LOCAL = ZoneInfo('Europe/Paris')

# Référence marnage vives-eaux Saint-Malo pour coefficient 120 (SHOM)
# Calibré le 17/04/2026 sur 2 PM SHOM → marnage moyen FES / coeff = 1366 cm
MARNAGE_VE_REF_CM = 1366.0

# Période de calcul
TODAY = date.today()
DATE_START = TODAY - timedelta(days=365)
DATE_END   = TODAY + timedelta(days=365)

# Pas de temps pour la détection des extrema (10 min)
DT_MIN = 10

# Mappage nom de fichier → nom de constituante pyfes
# (basé sur les noms reconnus par pyfes.core.known_constituents)
FILENAME_TO_CONSTITUENT = {
    '2n2':    '2N2',
    'eps2':   'Eps2',
    'j1':     'J1',
    'k1':     'K1',
    'k2':     'K2',
    'l2':     'L2',
    'lambda2':'Lambda2',
    'm2':     'M2',
    'm3':     'M3',
    'm4':     'M4',
    'm6':     'M6',
    'm8':     'M8',
    'mf':     'Mf',
    'mks2':   'MKS2',
    'mm':     'Mm',
    'mn4':    'MN4',
    'ms4':    'MS4',
    'msf':    'Msf',
    'msqm':   'MSqm',
    'mtm':    'Mtm',
    'mu2':    'Mu2',
    'n2':     'N2',
    'n4':     'N4',
    'nu2':    'Nu2',
    'o1':     'O1',
    'p1':     'P1',
    'q1':     'Q1',
    'r2':     'R2',
    's1':     'S1',
    's2':     'S2',
    's4':     'S4',
    'sa':     'Sa',
    'ssa':    'Ssa',
    't2':     'T2',
}


# ---------------------------------------------------------------------------
# Étape 1 : Extraction des constituantes harmoniques à Saint-Malo
# ---------------------------------------------------------------------------

def extract_constituent_at_point(nc_path: str) -> tuple[float, float] | None:
    """Extrait (amplitude cm, phase deg) au point Saint-Malo depuis un .nc."""
    try:
        with netCDF4.Dataset(nc_path, 'r') as ds:
            lon = ds.variables['lon'][:]  # 0-360
            lat = ds.variables['lat'][:]  # -90 to 90

            # Indice le plus proche
            i_lon = int(np.argmin(np.abs(lon - STMALO_LON_FES)))
            i_lat = int(np.argmin(np.abs(lat - STMALO_LAT)))

            amp_var = ds.variables['amplitude']
            pha_var = ds.variables['phase']

            # Shape peut être (lat, lon) ou (lon, lat)
            if amp_var.shape == (len(lat), len(lon)):
                amp = float(amp_var[i_lat, i_lon])
                pha = float(pha_var[i_lat, i_lon])
            else:
                amp = float(amp_var[i_lon, i_lat])
                pha = float(pha_var[i_lon, i_lat])

            # Vérification valeurs valides (masquées = NaN)
            if np.isnan(amp) or np.isnan(pha):
                return None
            return (round(float(amp), 4), round(float(pha), 4))
    except Exception as e:
        print(f'  ⚠️  Erreur lecture {nc_path}: {e}')
        return None


def extract_all_constituents() -> dict[str, tuple[float, float]]:
    """Parcourt tous les .nc.xz, extrait les constituantes à Saint-Malo."""
    constituents: dict[str, tuple[float, float]] = {}
    xz_files = sorted(glob.glob(str(FES_DIR / '*_fes2022.nc.xz')))

    print(f'📂 {len(xz_files)} fichiers atlas FES2022 trouvés')

    for xz_path in xz_files:
        # Extraire le nom de la constituante depuis le nom de fichier
        # ex: m2_fes2022.nc.xz → m2_fes2022.nc → m2_fes2022 → m2
        fname = pathlib.Path(xz_path).name  # m2_fes2022.nc.xz
        wave_key = fname.replace('_fes2022.nc.xz', '').lower()
        wave_name = FILENAME_TO_CONSTITUENT.get(wave_key)
        if wave_name is None:
            print(f'  ⚠️  Constituante inconnue : {wave_key} — ignorée')
            continue

        print(f'  🔄 {wave_name:10s} ({pathlib.Path(xz_path).name})', end='', flush=True)

        # Décompresser dans un fichier temporaire
        with tempfile.NamedTemporaryFile(suffix='.nc', delete=False) as tmp:
            tmp_path = tmp.name

        try:
            # Décompression xz → .nc temporaire
            with lzma.open(xz_path, 'rb') as xz_in:
                with open(tmp_path, 'wb') as nc_out:
                    shutil.copyfileobj(xz_in, nc_out)

            result = extract_constituent_at_point(tmp_path)
            if result is not None:
                constituents[wave_name] = result
                print(f'  ✅  amp={result[0]:.2f} cm, phase={result[1]:.1f}°')
            else:
                print(f'  ❌  valeur masquée ou invalide')
        finally:
            os.unlink(tmp_path)

    return constituents


# ---------------------------------------------------------------------------
# Étape 2 : Calcul des marées par pyfes
# ---------------------------------------------------------------------------

def compute_tides(
    constituents: dict[str, tuple[float, float]],
    date_start: date,
    date_end: date,
    dt_minutes: int = DT_MIN,
) -> tuple[np.ndarray, np.ndarray]:
    """Calcule la hauteur de marée (cm) sur la période avec un pas dt_minutes."""
    t_start = np.datetime64(date_start.isoformat(), 'ms')
    t_end   = np.datetime64(date_end.isoformat(), 'ms')
    step    = np.timedelta64(dt_minutes, 'm')

    dates = np.arange(t_start, t_end, step)
    print(f'\n⏱️  {len(dates)} pas de temps ({dt_minutes} min) sur {date_start} → {date_end}')

    tide, lp = pyfes.evaluate_tide_from_constituents(
        constituents,
        dates,
        STMALO_LAT,
        settings=pyfes.FESSettings(),
    )
    total = tide + lp
    print(f'   Hauteur min: {total.min():.1f} cm, max: {total.max():.1f} cm (/ MSL)')
    return dates, total


# ---------------------------------------------------------------------------
# Étape 3 : Détection des PM/BM
# ---------------------------------------------------------------------------

def find_extrema(
    dates: np.ndarray,
    heights: np.ndarray,
) -> tuple[list, list]:
    """Trouve les indices des PM (maxima locaux) et BM (minima locaux)."""
    pm_indices = []
    bm_indices = []

    for i in range(1, len(heights) - 1):
        if heights[i] > heights[i - 1] and heights[i] > heights[i + 1]:
            pm_indices.append(i)
        elif heights[i] < heights[i - 1] and heights[i] < heights[i + 1]:
            bm_indices.append(i)

    return pm_indices, bm_indices


def compute_coefficients(
    pm_indices: list[int],
    bm_indices: list[int],
    heights: np.ndarray,
) -> list[int]:
    """Calcule le coefficient (0-120) pour chaque PM.

    Utilise la référence officielle SHOM Saint-Malo :
    marnage VE (coeff 120) = 1310 cm (PMVE 13.50m − BMVE 0.40m ZH).
    coeff = round(120 × marnage_PM / MARNAGE_VE_REF_CM)
    """
    coeffs = []
    for pm_i in pm_indices:
        prev_bm = [b for b in bm_indices if b < pm_i]
        next_bm = [b for b in bm_indices if b > pm_i]
        bm_val = None
        if prev_bm and next_bm:
            bm_val = (heights[prev_bm[-1]] + heights[next_bm[0]]) / 2
        elif prev_bm:
            bm_val = heights[prev_bm[-1]]
        elif next_bm:
            bm_val = heights[next_bm[0]]
        if bm_val is not None:
            marnage = float(heights[pm_i] - bm_val)
            coeff = int(round(120 * marnage / MARNAGE_VE_REF_CM))
            coeff = max(20, min(120, coeff))
        else:
            coeff = 70
        coeffs.append(coeff)
    return coeffs


# ---------------------------------------------------------------------------
# Étape 4 : Construction du JSON de marées
# ---------------------------------------------------------------------------

def numpy_dt_to_str(dt64: np.datetime64, fmt: str = '%H:%M') -> str:
    """Convertit numpy.datetime64 (UTC) en string heure locale Europe/Paris."""
    ts = (dt64 - np.datetime64('1970-01-01T00:00:00', 'ms')) / np.timedelta64(1, 's')
    from datetime import datetime, timezone
    dt_utc = datetime.fromtimestamp(float(ts), tz=timezone.utc)
    dt_local = dt_utc.astimezone(TZ_LOCAL)
    return dt_local.strftime(fmt)


def numpy_dt_to_date_str(dt64: np.datetime64) -> str:
    """Convertit numpy.datetime64 (UTC) en date locale Europe/Paris YYYY-MM-DD."""
    return numpy_dt_to_str(dt64, '%Y-%m-%d')


def build_marees_json(
    dates: np.ndarray,
    heights: np.ndarray,
    pm_indices: list[int],
    bm_indices: list[int],
    pm_coeffs: list[int],
) -> dict:
    """Construit le dictionnaire JSON indexé par date."""
    print('\n📅 Construction du JSON marees ...')

    # Indexer PM et BM par date
    pm_by_day: dict[str, list] = {}
    bm_by_day: dict[str, list] = {}

    for idx, coeff in zip(pm_indices, pm_coeffs):
        d = numpy_dt_to_date_str(dates[idx])
        h = numpy_dt_to_str(dates[idx])
        hauteur_cm = round(float(heights[idx]))
        pm_by_day.setdefault(d, []).append({
            'h': h,
            'coeff': coeff,
            'hauteur_cm': hauteur_cm,
        })

    for idx in bm_indices:
        d = numpy_dt_to_date_str(dates[idx])
        h = numpy_dt_to_str(dates[idx])
        hauteur_cm = round(float(heights[idx]))
        bm_by_day.setdefault(d, []).append({
            'h': h,
            'hauteur_cm': hauteur_cm,
        })

    # Construire le JSON par jour
    all_days = sorted(set(list(pm_by_day.keys()) + list(bm_by_day.keys())))
    result = {}

    for d in all_days:
        pms = pm_by_day.get(d, [])
        bms = bm_by_day.get(d, [])

        entry: dict = {'date': d}

        for i, pm in enumerate(pms[:2]):  # max 2 PM/jour
            n = i + 1
            entry[f'PM{n}_h']      = pm['h']
            entry[f'PM{n}_coeff']  = pm['coeff']
            entry[f'PM{n}_hcm']    = pm['hauteur_cm']

        for i, bm in enumerate(bms[:3]):  # max 3 BM/jour
            n = i + 1
            entry[f'BM{n}_h']   = bm['h']
            entry[f'BM{n}_hcm'] = bm['hauteur_cm']

        result[d] = entry

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PWA_DIR.mkdir(parents=True, exist_ok=True)

    # --- 1. Extraction des constituantes ---
    constituantes_path = DATA_DIR / 'constituantes_stmalo.json'

    if constituantes_path.exists():
        print(f'📂 Lecture constituantes existantes : {constituantes_path}')
        with open(constituantes_path) as f:
            raw = json.load(f)
        # Reconvertir en tuples
        constituents = {k: (v[0], v[1]) for k, v in raw.items()}
    else:
        print('🔍 Extraction des constituantes harmoniques à Saint-Malo...')
        constituents = extract_all_constituents()

        if not constituents:
            print('❌ Aucune constituante extraite — arrêt.')
            sys.exit(1)

        print(f'\n✅ {len(constituents)} constituantes extraites')
        with open(constituantes_path, 'w') as f:
            json.dump(constituents, f, indent=2, ensure_ascii=False)
        print(f'💾 Sauvegardé : {constituantes_path}')

    # --- 2. Calcul des marées ---
    print('\n🌊 Calcul des marées FES2022 ...')
    dates, heights = compute_tides(constituents, DATE_START, DATE_END)

    # --- 3. Détection des extrêmes ---
    print('🔎 Détection PM/BM ...')
    pm_indices, bm_indices = find_extrema(dates, heights)
    print(f'   {len(pm_indices)} PM et {len(bm_indices)} BM détectés')

    # --- 4. Calcul des coefficients ---
    pm_coeffs = compute_coefficients(pm_indices, bm_indices, heights)

    # --- 5. Construction JSON ---
    marees = build_marees_json(dates, heights, pm_indices, bm_indices, pm_coeffs)
    print(f'   {len(marees)} jours dans le JSON')

    # --- 6. Export ---
    out_data = DATA_DIR / 'marees.json'
    out_pwa  = PWA_DIR / 'marees.json'

    with open(out_data, 'w', encoding='utf-8') as f:
        json.dump(marees, f, ensure_ascii=False, separators=(',', ':'))
    print(f'\n💾 {out_data} ({out_data.stat().st_size // 1024} Ko)')

    shutil.copy2(out_data, out_pwa)
    print(f'📋 Copié → {out_pwa}')

    # Aperçu
    sample_date = TODAY.isoformat()
    if sample_date in marees:
        print(f'\n📋 Aperçu {sample_date} :')
        print(json.dumps(marees[sample_date], ensure_ascii=False, indent=2))
    else:
        # Prendre le premier jour disponible
        first = next(iter(marees))
        print(f'\n📋 Premier jour disponible ({first}) :')
        print(json.dumps(marees[first], ensure_ascii=False, indent=2))

    print('\n✅ Phase 4 terminée — marees.json généré avec FES2022')


if __name__ == '__main__':
    main()
