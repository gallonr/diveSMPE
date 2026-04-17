/**
 * bathy.js — Module bathymétrie LiDAR LITTO3D (Phase 3 data → PWA)
 *
 * Charge data/bathy_sites.json (généré par r/01_process_las.R)
 * et expose :
 *   Bathy.init()             → charge le JSON
 *   Bathy.get(siteID)        → { siteID, profMin, profMax, transect } | null
 *   Bathy.dessiner(canvas, siteID, hMaree?)  → dessine le profil dans le canvas
 */

const Bathy = (() => {

  /** @type {Map<string, {siteID:string, profMin:number, profMax:number, transect:{dist_m:number[], z_m:number[]}|null}>} */
  let _data = new Map();
  let _loaded = false;

  // ── Chargement ────────────────────────────────────────────

  async function init() {
    try {
      const res = await fetch(CONFIG.DATA.bathy);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      arr.forEach(entry => _data.set(entry.siteID, entry));
      _loaded = true;
      console.log(`✅ Bathy chargé : ${_data.size} sites`);
    } catch (e) {
      console.warn('⚠ Bathy non disponible :', e.message);
    }
  }

  // ── Accesseurs ────────────────────────────────────────────

  function get(siteID) {
    return _data.get(siteID) || null;
  }

  function isLoaded() { return _loaded; }

  // ── Dessin profil transect dans un canvas ─────────────────

  /**
   * Dessine le profil bathymétrique E→O dans le canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {string} siteID
   * @param {number|null} hMaree  Hauteur de marée actuelle en m (ZHMM). Null = non disponible.
   */
  function dessiner(canvas, siteID, hMaree = null) {
    if (!canvas) return;
    const entry = get(siteID);
    if (!entry || !entry.transect) {
      const ctx = canvas.getContext('2d');
      _dessinerVide(ctx, canvas.width, canvas.height);
      return;
    }
    _dessinerProfil(canvas, entry, hMaree, 'LiDAR LITTO3D — transect E→O');
  }

  // ── Dessin interne (factorisation) ────────────────────────

  function _dessinerProfil(canvas, entry, hMaree, label) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    const { dist_m, z_m } = entry.transect;
    const n = dist_m.length;

    // Filtrer les nulls issus de l'interpolation
    const z_valid = z_m.filter(v => v !== null && v !== -9999);
    if (z_valid.length < 2) { _dessinerVide(ctx, W, H); return; }

    // ── Calcul des bornes ──────────────────────────────────
    const zMin = Math.min(...z_valid);
    const zMax = Math.max(...z_valid);
    const zRange = zMax - zMin || 1;

    const zSurface = hMaree !== null ? hMaree : 0;

    // ── Fond dégradé ───────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d1b2a');
    bg.addColorStop(1, '#001524');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Grille horizontale légère ─────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = Math.round(H * g / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ── Ligne de surface (marée) ──────────────────────────
    const ySurface = _zToY(zSurface, zMin, zRange, H);
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(0,200,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.moveTo(0, ySurface);
    ctx.lineTo(W, ySurface);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(0,200,255,0.75)';
    ctx.font = '10px sans-serif';
    const labelSurface = hMaree !== null
      ? `Surface (marée ${hMaree >= 0 ? '+' : ''}${hMaree.toFixed(2)} m ZH)`
      : 'Zéro hydrographique';
    ctx.fillText(labelSurface, 6, Math.max(ySurface - 4, 12));

    // ── Profil bathymétrique ──────────────────────────────
    ctx.beginPath();
    let firstValid = true;
    for (let i = 0; i < n; i++) {
      if (z_m[i] === null || z_m[i] === -9999) continue;
      const x = (i / (n - 1)) * W;
      const y = _zToY(z_m[i], zMin, zRange, H);
      if (firstValid) { ctx.moveTo(x, y); firstValid = false; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,119,182,0.75)');
    grad.addColorStop(0.6, 'rgba(2,62,138,0.85)');
    grad.addColorStop(1, 'rgba(3,4,94,0.95)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    firstValid = true;
    for (let i = 0; i < n; i++) {
      if (z_m[i] === null || z_m[i] === -9999) continue;
      const x = (i / (n - 1)) * W;
      const y = _zToY(z_m[i], zMin, zRange, H);
      if (firstValid) { ctx.moveTo(x, y); firstValid = false; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#48cae4';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Annotations profondeurs min/max ───────────────────
    if (entry.profMax > 0) {
      const depMax = entry.profMax + (hMaree || 0);
      const yAnnot = _zToY(zMin, zMin, zRange, H);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`↓ ${depMax.toFixed(1)} m`, 6, Math.min(yAnnot - 4, H - 4));
    }

    // ── Axe horizontal ────────────────────────────────────
    // Distances en m tous les 100m
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    const totalDist = dist_m[n - 1] - dist_m[0];
    const step100 = Math.round(totalDist / 100);
    for (let k = 0; k <= step100; k++) {
      const d = dist_m[0] + k * 100;
      const x = ((d - dist_m[0]) / totalDist) * W;
      ctx.fillText(`${k * 100}m`, x + 2, H - 2);
    }

    // ── Note LiDAR ────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    const noteLabel = label || 'LiDAR LITTO3D — transect E→O';
    ctx.fillText(noteLabel, W - 4, H - 2);
    ctx.textAlign = 'left';
  }

  // ── Transect libre (2 points Lambert-93) ─────────────────

  /**
   * Calcule et dessine un profil le long d'un segment L93 arbitraire.
   * @param {HTMLCanvasElement} canvas
   * @param {string} siteID
   * @param {{x:number,y:number}} ptA   Point A en Lambert-93
   * @param {{x:number,y:number}} ptB   Point B en Lambert-93
   * @param {number|null} hMaree
   */
  function dessinerTransectLibre(canvas, siteID, ptA, ptB, hMaree = null) {
    const entry = get(siteID);
    if (!canvas || !entry || !entry.grid) return;

    const { dist_m, z_m } = _interpolerTransect(entry.grid, ptA, ptB, 80);
    if (!z_m || z_m.length < 2) return;

    // Construire un objet transect compatible avec dessiner()
    const fakeEntry = {
      siteID:   entry.siteID,
      profMin:  entry.profMin,
      profMax:  entry.profMax,
      transect: { dist_m, z_m },
    };

    const distTotal = Math.round(Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y));
    const labelNote = `LiDAR LITTO3D — transect libre (${distTotal} m)`;

    _dessinerProfil(canvas, fakeEntry, hMaree, labelNote);
  }

  /**
   * Interpole les valeurs Z le long d'un segment dans la grille 5m.
   * Interpolation bilinéaire.
   * @returns {{ dist_m: number[], z_m: number[] }}
   */
  function _interpolerTransect(grid, ptA, ptB, nPts = 80) {
    const { ncol, nrow, res, xmin, ymin, z } = grid;

    const dist_m = [];
    const z_m    = [];
    const totalDist = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);

    for (let i = 0; i < nPts; i++) {
      const t  = i / (nPts - 1);
      const xL = ptA.x + t * (ptB.x - ptA.x);
      const yL = ptA.y + t * (ptB.y - ptA.y);
      const d  = Math.round(t * totalDist);

      // Position dans la grille (col-major avec row 0 = Sud)
      const col = (xL - xmin) / res;
      const row = (yL - ymin) / res;

      const zVal = _bilinear(z, ncol, nrow, col, row);
      dist_m.push(d);
      z_m.push(zVal !== null ? Math.round(zVal * 100) / 100 : null);
    }
    return { dist_m, z_m };
  }

  /** Interpolation bilinéaire dans un tableau flat row-major (row 0 = Sud) */
  function _bilinear(z, ncol, nrow, col, row) {
    const c0 = Math.floor(col), r0 = Math.floor(row);
    const c1 = c0 + 1,          r1 = r0 + 1;
    if (c0 < 0 || r0 < 0 || c1 >= ncol || r1 >= nrow) return null;

    const fc = col - c0, fr = row - r0;

    const z00 = z[r0 * ncol + c0];
    const z10 = z[r0 * ncol + c1];
    const z01 = z[r1 * ncol + c0];
    const z11 = z[r1 * ncol + c1];

    if (z00 === -9999 || z10 === -9999 || z01 === -9999 || z11 === -9999) return null;

    return z00 * (1 - fc) * (1 - fr)
         + z10 * fc       * (1 - fr)
         + z01 * (1 - fc) * fr
         + z11 * fc       * fr;
  }

  // ── Helpers internes ──────────────────────────────────────

  /** Convertit une valeur Z en position Y dans le canvas (Z haut = Y bas) */
  function _zToY(z, zMin, zRange, H) {
    const PAD = 16;
    return H - PAD - ((z - zMin) / zRange) * (H - 2 * PAD);
  }

  function _dessinerVide(ctx, W, H) {
    ctx.fillStyle = '#1e2d3d';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Données bathymétriques non disponibles', W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  return { init, get, isLoaded, dessiner, dessinerTransectLibre };
})();
