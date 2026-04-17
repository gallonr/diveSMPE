# =============================================================================
# 01_process_las.R — PHASE 3 : LiDAR → Bathymétrie
# Projet : Catalogue Sites de Plongée SMPE — Baie de Saint-Malo
# Date   : 2026-04-08
#
# Tâches couvertes :
#   3.1  Création du script (ce fichier)
#   3.2  Lecture du LAS par catalog
#   3.3  Note sur les classes (LAS 1.2 sans Classification)
#   3.4  Lecture des sites + reprojection Lambert-93
#   3.5  Génération du MNT par site (bbox clip + terra::rasterize mean Z)
#   3.6  Extraction profils bathymétriques (profMin, profMax, transect E→O)
#   3.7  Export data/tiles/ + data/bathy_sites.json + pwa/data/
#   3.8  Résumé et validation
#
# Contexte données :
#   LAS  : LITTO3D, Lambert-93 (EPSG:2154), 206 M pts
#          X [320725, 330690]  Y [6847262, 6855878]  Z [-25.96, +43.91] m
#   Sites: WGS84 (EPSG:4326), ~45/60 sites dans l'emprise LAS
#
# ⚠ NOTE IMPORTANTE : le fichier LAS 1.2 format 0 ne contient PAS le champ
#   Classification → rasterize_terrain et grid_terrain (lidR) échouent car
#   ils exigent ce champ. On utilise directement terra::rasterize(mean Z).
#
# Usage :
#   Rscript r/01_process_las.R                     # Traitement complet
#   Rscript r/01_process_las.R --res 4 --n 5       # Test 5 sites, résol. 4m
#   Rscript r/01_process_las.R --start 6 --n 10    # Sites 6 à 15
# =============================================================================

suppressPackageStartupMessages({
  library(lidR)
  library(terra)
  library(sf)
  library(jsonlite)
  library(future)
})

cat("=============================================================\n")
cat("PHASE 3 — Preprocessing LiDAR : LAS → Bathymétrie\n")
cat("=============================================================\n\n")
t_start <- proc.time()

# =============================================================================
# PARAMÈTRES (valeurs par défaut)
# =============================================================================

PATH_LAS <- "las/LITTO3D_BaieSaintMalo_ZH.las"
PATH_GEOJSON <- "pwa/data/sites.geojson"
DIR_TILES <- "data/tiles"
DIR_THUMBS <- "pwa/data/thumbs"
PATH_BATHY_JSON <- "data/bathy_sites.json"
PATH_BATHY_PWA <- "pwa/data/bathy_sites.json"

RESOL_MNT <- 0.5 # résolution MNT en mètres
BUFFER_SITE_M <- 300 # buffer autour du site en mètres
TRANSECT_HALF_M <- 200 # demi-longueur transect en mètres
N_TRANSECT_PTS <- 100 # nb de points sur le transect
THUMB_W <- 256
THUMB_H <- 256

SITE_START <- 1L
SITE_N <- Inf # Inf = tous les sites

# --- Surcharge par arguments CLI ---
args <- commandArgs(trailingOnly = TRUE)
if (length(args) >= 2) {
  for (i in seq(1, length(args) - 1, by = 2)) {
    key <- args[i]
    val <- args[i + 1]
    if (key == "--res") RESOL_MNT <- as.numeric(val)
    if (key == "--buffer") BUFFER_SITE_M <- as.numeric(val)
    if (key == "--n") SITE_N <- as.integer(val)
    if (key == "--start") SITE_START <- as.integer(val)
  }
}

cat(sprintf(
  "Paramètres : résolution=%gm  buffer=%gm  sites=%s à partir de %d\n\n",
  RESOL_MNT, BUFFER_SITE_M,
  if (is.infinite(SITE_N)) "tous" else as.character(SITE_N),
  SITE_START
))

# =============================================================================
# 3.2 — Lecture du LAS en mode catalog
# =============================================================================
cat("--- 3.2 Lecture du LAS par catalog ---\n")

if (!file.exists(PATH_LAS)) {
  stop("Fichier LAS introuvable : ", PATH_LAS)
}

ctg <- readLAScatalog(PATH_LAS)
opt_chunk_size(ctg) <- 2000
opt_chunk_buffer(ctg) <- 50
opt_progress(ctg) <- TRUE
future::plan(future::sequential)
opt_output_files(ctg) <- file.path(DIR_TILES, "chunks/chunk_{XLEFT}_{YBOTTOM}")

cat(sprintf("Catalog chargé : %s\n", PATH_LAS))
cat(sprintf("  Emprise X : [%.1f, %.1f]\n", ctg@data$Min.X[1], ctg@data$Max.X[1]))
cat(sprintf("  Emprise Y : [%.1f, %.1f]\n", ctg@data$Min.Y[1], ctg@data$Max.Y[1]))
cat(sprintf("  Emprise Z : [%.2f, %.2f]\n", ctg@data$Min.Z[1], ctg@data$Max.Z[1]))

if (is.na(st_crs(ctg))) {
  projection(ctg) <- sp::CRS(SRS_string = "EPSG:2154")
  cat("CRS absent dans l'en-tête LAS → assigné manuellement : EPSG:2154 (Lambert-93)\n")
}
cat(sprintf(
  "  CRS : %s\n\n",
  tryCatch(st_crs(ctg)$input, error = function(e) "EPSG:2154")
))

# =============================================================================
# 3.3 — Note sur le LAS
# =============================================================================
cat("--- 3.3 Note sur le LAS ---\n")
cat("Format LAS 1.2 point 0 : pas de champ Classification.\n")
cat("MNT généré via terra::rasterize(mean Z) — pas de dépendance à Classification.\n\n")

# =============================================================================
# 3.4 — Lecture des sites + reprojection Lambert-93
# =============================================================================
cat("--- 3.4 Lecture des sites et reprojection Lambert-93 ---\n")

dir.create(DIR_TILES, showWarnings = FALSE, recursive = TRUE)
dir.create(DIR_THUMBS, showWarnings = FALSE, recursive = TRUE)

sites_wgs <- st_read(PATH_GEOJSON, quiet = TRUE)
cat(sprintf("Sites chargés : %d features\n", nrow(sites_wgs)))

sites_l93 <- st_transform(sites_wgs, crs = 2154)

bbox_las <- c(
  xmin = ctg@data$Min.X[1], xmax = ctg@data$Max.X[1],
  ymin = ctg@data$Min.Y[1], ymax = ctg@data$Max.Y[1]
)

coords_l93 <- st_coordinates(sites_l93)
in_las <- coords_l93[, 1] >= bbox_las["xmin"] & coords_l93[, 1] <= bbox_las["xmax"] &
  coords_l93[, 2] >= bbox_las["ymin"] & coords_l93[, 2] <= bbox_las["ymax"]
sites_in_mnt <- sites_l93[in_las, ]

cat(sprintf(
  "Sites dans l'emprise LiDAR : %d / %d\n\n",
  nrow(sites_in_mnt), nrow(sites_l93)
))

# =============================================================================
# 3.5 + 3.6 — Génération MNT et profils bathymétriques par site
# =============================================================================
total_sites <- nrow(sites_in_mnt)
end_idx <- min(total_sites, SITE_START + SITE_N - 1L)

cat(sprintf(
  "--- 3.5/3.6 Extraction des profils bathymétriques (%d sites, indices %d à %d) ---\n\n",
  total_sites, SITE_START, end_idx
))

# Palette bathy pour miniatures
# Zones émergées (Z > 0) : beige → brun rocheux
# Rupture à 0 m (ZH) puis zones sous-marines : cyan clair → bleu profond
# On construit une palette asymétrique : 64 couleurs pour le positif, 192 pour le négatif
bathy_palette <- c(
  colorRampPalette(c("#c8b87a", "#8b7355", "#6b5a3e"))(64), # émergé : sable → roche
  colorRampPalette(c(
    "#b3e5fc", "#4fc3f7", "#0288d1", # sub-littoral clair
    "#01579b", "#003d6b", "#001f3f"
  ))(192) # bathyal profond
)

bathy_results <- vector("list", total_sites)

for (i in seq.int(SITE_START, end_idx)) {
  site <- sites_in_mnt[i, ]
  sid <- site$siteID
  coords <- st_coordinates(site)
  cx <- coords[1]
  cy <- coords[2]

  cat(sprintf("  [%d/%d] %s (X=%.0f, Y=%.0f)\n", i, total_sites, sid, cx, cy))

  # ---- Lecture LAS locale (bbox autour du site) ----
  las_site <- tryCatch(
    readLAS(
      PATH_LAS,
      filter = sprintf(
        "-keep_xy %.1f %.1f %.1f %.1f",
        cx - BUFFER_SITE_M, cy - BUFFER_SITE_M,
        cx + BUFFER_SITE_M, cy + BUFFER_SITE_M
      ),
      select = "xyz"
    ),
    error = function(e) {
      message(sprintf("    ⚠ Erreur lecture LAS pour %s : %s", sid, conditionMessage(e)))
      NULL
    }
  )

  if (is.null(las_site) || nrow(las_site@data) < 50) {
    n_pts <- if (is.null(las_site)) 0L else nrow(las_site@data)
    cat(sprintf("    ⚠ Trop peu de points (%d) — site ignoré\n", n_pts))
    bathy_results[[i]] <- list(
      siteID = sid,
      profMin = NA_real_,
      profMax = NA_real_,
      transect = NULL
    )
    next
  }

  suppressWarnings(projection(las_site) <- "EPSG:2154")
  npts <- nrow(las_site@data)
  cat(sprintf("    %d points lus\n", npts))

  # ---- Génération du MNT via interpIDW ----
  # Interpolation IDW directe (Inverse Distance Weighting) : plus propre que
  # rasterize+focal car les valeurs interpolées sont pondérées par la distance
  # aux points mesurés. Pas de dépendance au champ Classification.
  # Sous-échantillonnage à 2M pts max pour éviter OOM.
  mnt_site <- tryCatch(
    {
      samp_n <- min(2000000L, npts)
      idx <- if (samp_n == npts) seq_len(npts) else sort(sample.int(npts, samp_n))
      df <- las_site@data[idx, c("X", "Y", "Z"), with = FALSE]

      if (samp_n < npts) {
        cat(sprintf("    (sous-échantillon : %d / %d pts)\n", samp_n, npts))
      }

      xs <- df$X
      ys <- df$Y
      zs <- df$Z

      ex <- terra::ext(min(xs), max(xs), min(ys), max(ys))
      r_tmpl <- terra::rast(ext = ex, res = RESOL_MNT, crs = "EPSG:2154")
      # ⚠ field= doit être un nom de colonne → atts= pour attacher les Z
      pts_v <- terra::vect(cbind(xs, ys),
        atts = data.frame(z = zs),
        type = "points", crs = "EPSG:2154"
      )

      # interpIDW : signature interpIDW(SpatRaster_template, SpatVector, field)
      # radius=5m garantit 0 NA avec densité LITTO3D (~1 pt/m²) à résolution 50cm
      raster_z <- terra::interpIDW(r_tmpl, pts_v,
        field = "z",
        radius = 5, power = 2, smooth = 0
      )

      rm(df, pts_v, r_tmpl)

      # Vérification — si NA résiduels (zones sans points) : focal fill de secours
      n_na <- sum(is.na(terra::values(raster_z)))
      if (n_na > 0) {
        for (.pass in seq_len(15L)) {
          n_before <- sum(is.na(terra::values(raster_z)))
          raster_z <- terra::focal(raster_z,
            w = 3, fun = "mean",
            na.policy = "only", na.rm = TRUE
          )
          n_after <- sum(is.na(terra::values(raster_z)))
          if (n_after == 0L || n_after == n_before) break
        }
        cat(sprintf(
          "    (focal fill secours : %d passes, NA résiduels : %d)\n",
          .pass, sum(is.na(terra::values(raster_z)))
        ))
      }

      raster_z
    },
    error = function(e) {
      message(sprintf("    ⚠ MNT échoué pour %s : %s", sid, conditionMessage(e)))
      NULL
    }
  )

  rm(las_site) # libérer la RAM immédiatement

  if (is.null(mnt_site)) {
    bathy_results[[i]] <- list(
      siteID = sid,
      profMin = NA_real_,
      profMax = NA_real_,
      transect = NULL
    )
    next
  }

  # ---- Statistiques de profondeur ----
  vals <- terra::values(mnt_site, na.rm = TRUE)
  vals_sub <- vals[vals < 0]
  if (length(vals_sub) < 10) vals_sub <- vals # site terrestre / peu de points sous-marins

  prof_min <- round(abs(max(vals_sub, na.rm = TRUE)), 1)
  prof_max <- round(abs(min(vals_sub, na.rm = TRUE)), 1)

  # ---- Transect bathymétrique E→O ----
  xs_t <- seq(cx - TRANSECT_HALF_M, cx + TRANSECT_HALF_M, length.out = N_TRANSECT_PTS)
  ys_t <- rep(cy, N_TRANSECT_PTS)
  pts_t <- terra::vect(cbind(xs_t, ys_t), type = "points", crs = terra::crs(mnt_site))
  z_transect <- terra::extract(mnt_site, pts_t)[, 2]
  dist_m_t <- seq(0, 2 * TRANSECT_HALF_M, length.out = N_TRANSECT_PTS)

  # ---- Grille Z @ 5m (pour transects libres côté JS) ----
  GRID_RES <- 5 # m — compromis taille/précision
  mnt_5m <- terra::aggregate(mnt_site, fact = round(GRID_RES / RESOL_MNT), fun = "mean")

  # Emprise WGS84 (pour overlay Leaflet)
  mnt_wgs84 <- terra::project(mnt_5m, "EPSG:4326")
  ext_wgs84 <- terra::ext(mnt_wgs84)

  grid_vals <- round(as.vector(t(terra::values(mnt_5m))), 2) # row-major → col-major
  # Attention : terra::values() retourne col-major (colonne par colonne),
  # on transpose pour obtenir row-major (ligne ouest→est par ligne sud→nord)
  # afin de faciliter l'accès xy côté JS : z[row][col] où row=0 = Sud
  grid_vals_rm <- as.vector(terra::values(mnt_5m, mat = TRUE)) # col-major brut
  # Construire matrice nrow x ncol puis convertir en row-major
  nc <- terra::ncol(mnt_5m)
  nr <- terra::nrow(mnt_5m)
  mat_z <- matrix(grid_vals_rm, nrow = nr, ncol = nc, byrow = FALSE)
  # row 1 = Nord dans terra → inverser pour row 0 = Sud (convention JS bas=bas)
  mat_z <- mat_z[rev(seq_len(nrow(mat_z))), ]
  grid_flat <- round(as.vector(t(mat_z)), 2) # row-major, Sud→Nord, Ouest→Est
  grid_flat[is.na(grid_flat)] <- -9999 # sentinel NA

  ext_l93 <- terra::ext(mnt_5m)

  cat(sprintf(
    "    🗺  Grille Z %dx%d @ %gm  → %.1f Ko\n",
    nc, nr, GRID_RES, length(grid_flat) * 6 / 1024
  ))

  bathy_results[[i]] <- list(
    siteID = sid,
    profMin = prof_min,
    profMax = prof_max,
    transect = list(
      dist_m = round(dist_m_t, 0),
      z_m    = round(z_transect, 2)
    ),
    grid = list(
      ncol = nc,
      nrow = nr,
      res = GRID_RES,
      # Emprise Lambert-93 (pour interpolation JS)
      xmin = round(ext_l93$xmin, 1),
      ymin = round(ext_l93$ymin, 1),
      # Emprise WGS84 (pour overlay Leaflet)
      bounds_wgs84 = list(
        west  = round(ext_wgs84$xmin, 6),
        south = round(ext_wgs84$ymin, 6),
        east  = round(ext_wgs84$xmax, 6),
        north = round(ext_wgs84$ymax, 6)
      ),
      # Coordonnées Lambert-93 du centre (pour référencer les pixels)
      cx_l93 = round(cx, 1),
      cy_l93 = round(cy, 1),
      z = grid_flat
    )
  )

  # ---- Export GeoTIFF ----
  tile_path <- file.path(DIR_TILES, paste0(sid, "_bathy.tif"))
  terra::writeRaster(mnt_site,
    filename = tile_path, overwrite = TRUE,
    gdal = c("COMPRESS=LZW")
  )

  # ---- Miniature PNG (RGBA — compatible Leaflet imageOverlay) ----
  thumb_path <- file.path(DIR_THUMBS, paste0(sid, "_thumb.png"))
  thumb_tmp <- paste0(thumb_path, ".tmp.png")
  tryCatch(
    {
      # 1. Générer le PNG via terra::plot (produit un PNG mode palette P)
      png(thumb_tmp, width = THUMB_W, height = THUMB_H, bg = "transparent")
      par(mar = c(0, 0, 0, 0))
      terra::plot(mnt_site, col = bathy_palette, legend = FALSE, axes = FALSE, box = FALSE)
      dev.off()
      # 2. Convertir en RGBA avec Python pour éviter les problèmes de
      #    transparence par index dans les navigateurs (Leaflet imageOverlay)
      py_cmd <- sprintf(
        "python3 -c \"from PIL import Image; Image.open('%s').convert('RGBA').save('%s', 'PNG')\"",
        thumb_tmp, thumb_path
      )
      ret <- system(py_cmd, ignore.stdout = TRUE, ignore.stderr = TRUE)
      if (ret != 0) {
        # Fallback : conserver le PNG original si Python échoue
        file.copy(thumb_tmp, thumb_path, overwrite = TRUE)
        warning(sprintf("Conversion RGBA échouée pour %s — PNG palette conservé", sid))
      }
      file.remove(thumb_tmp)
    },
    error = function(e) {
      warning(sprintf("Miniature PNG échouée pour %s : %s", sid, conditionMessage(e)))
      if (dev.cur() > 1) dev.off()
      if (file.exists(thumb_tmp)) file.remove(thumb_tmp)
    }
  )

  cat(sprintf(
    "    ✅ profMin=%.1f m  profMax=%.1f m  → %s\n",
    prof_min, prof_max, basename(tile_path)
  ))
}

# =============================================================================
# 3.7 — Export JSON + GeoJSON mis à jour
# =============================================================================
cat("\n--- 3.7 Export bathy_sites.json ---\n")

bathy_results_clean <- Filter(Negate(is.null), bathy_results)

sites_wgs_updated <- sites_wgs
if (!("profMin" %in% names(sites_wgs_updated))) sites_wgs_updated$profMin <- NA_real_
if (!("profMax" %in% names(sites_wgs_updated))) sites_wgs_updated$profMax <- NA_real_

for (res in bathy_results_clean) {
  if (!is.na(res$profMin)) {
    idx <- which(sites_wgs_updated$siteID == res$siteID)
    if (length(idx) == 1) {
      sites_wgs_updated$profMin[idx] <- res$profMin
      sites_wgs_updated$profMax[idx] <- res$profMax
    }
  }
}

writeLines(
  jsonlite::toJSON(bathy_results_clean, auto_unbox = TRUE, digits = NA),
  PATH_BATHY_JSON
)
# Note : digits = NA conserve la précision complète pour les bounds_wgs84
# (6 décimales essentielles pour Leaflet). Les valeurs z ont déjà été arrondies
# à 2 décimales dans la structure R (via round(..., 2)), donc pas d'inflation.
cat(sprintf("✅ Exporté : %s  (%d sites)\n", PATH_BATHY_JSON, length(bathy_results_clean)))

bathy_lite <- lapply(bathy_results_clean, function(r) {
  list(siteID = r$siteID, profMin = r$profMin, profMax = r$profMax)
})
dir.create(dirname(PATH_BATHY_PWA), showWarnings = FALSE, recursive = TRUE)
jsonlite::write_json(bathy_lite, path = PATH_BATHY_PWA, auto_unbox = TRUE, pretty = FALSE)
cat(sprintf("✅ Exporté (lite) : %s\n", PATH_BATHY_PWA))

st_write(sites_wgs_updated, "pwa/data/sites.geojson", delete_dsn = TRUE, quiet = TRUE)
cat("✅ GeoJSON mis à jour avec profMin/profMax : pwa/data/sites.geojson\n\n")

# =============================================================================
# 3.8 — Résumé et validation
# =============================================================================
cat("--- 3.8 Résumé et validation ---\n")

n_ok <- sum(sapply(bathy_results_clean, function(r) !is.na(r$profMin)))
n_skip <- sum(sapply(bathy_results_clean, function(r) is.na(r$profMin)))

cat(sprintf("Sites traités          : %d\n", length(bathy_results_clean)))
cat(sprintf("  Avec données bathy   : %d\n", n_ok))
cat(sprintf("  Sans données (NA)    : %d\n", n_skip))

if (n_ok > 0) {
  profs <- sapply(Filter(function(r) !is.na(r$profMax), bathy_results_clean), `[[`, "profMax")
  cat(sprintf("Profondeur max globale : %.1f m\n", max(profs, na.rm = TRUE)))
  cat(sprintf("Profondeur max médiane : %.1f m\n", median(profs, na.rm = TRUE)))
}

tif_files <- list.files(DIR_TILES, pattern = "_bathy\\.tif$", full.names = TRUE)
png_files <- list.files(DIR_THUMBS, pattern = "_thumb\\.png$", full.names = TRUE)
cat(sprintf(
  "\nFichiers GeoTIFF  : %d  (%.1f Mo)\n",
  length(tif_files), sum(file.size(tif_files)) / 1024^2
))
cat(sprintf(
  "Miniatures PNG    : %d  (%.1f Mo)\n",
  length(png_files), sum(file.size(png_files)) / 1024^2
))

dt <- proc.time() - t_start
cat(sprintf(
  "\n✅ PHASE 3 terminée en %.1f s (%.1f min)\n",
  dt["elapsed"], dt["elapsed"] / 60
))
cat("=============================================================\n")
cat("Prochaine étape : vérifier les tuiles dans QGIS\n")
cat("  → ouvrir data/tiles/*.tif dans QGIS pour validation visuelle\n")
cat("=============================================================\n")
