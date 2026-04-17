# =============================================================================
# 01_explore.R — PHASE 1 : Exploration et validation des données sources
# Projet : Catalogue Sites de Plongée SMPE — Baie de Saint-Malo
# Date   : 2026-04-08
# =============================================================================

library(readxl)
library(sf)
library(lidR)

# Chemins relatifs au projet (lancer depuis la racine du projet)
PATH_XLSX <- "bdd/bddAtlasPlongeeSMPE.xlsx"
PATH_LAS  <- "las/LITTO3D_BaieSaintMalo.las"

cat("=============================================================\n")
cat("PHASE 1 — Exploration et validation des données sources\n")
cat("=============================================================\n\n")

# -----------------------------------------------------------------------------
# 1.1 / 1.2 — Inspection du fichier XLSX
# -----------------------------------------------------------------------------
cat("--- 1.1 Inspection du fichier XLSX ---\n")

# Lister les feuilles disponibles
feuilles <- excel_sheets(PATH_XLSX)
cat("Feuilles disponibles :", paste(feuilles, collapse = ", "), "\n\n")

# Lire toutes les feuilles
sheets <- lapply(feuilles, function(sh) read_excel(PATH_XLSX, sheet = sh))
names(sheets) <- feuilles

for (sh in feuilles) {
  df <- sheets[[sh]]
  cat(sprintf(">>> Feuille : '%s'\n", sh))
  cat(sprintf("    Dimensions   : %d lignes × %d colonnes\n", nrow(df), ncol(df)))
  cat(sprintf("    Colonnes     : %s\n", paste(names(df), collapse = ", ")))
  cat(sprintf("    Types        : %s\n", paste(sapply(df, class), collapse = ", ")))
  cat("\n")
}

# Travailler sur la première feuille pour la suite
df_main <- sheets[[feuilles[1]]]

# -----------------------------------------------------------------------------
# 1.2 — Vérifier la projection/CRS
# -----------------------------------------------------------------------------
cat("--- 1.2 Vérification du CRS (projection) ---\n")

# Chercher des colonnes de coordonnées (noms courants)
coord_patterns <- c("lon", "lat", "lng", "x", "y", "coord", "wgs", "lambert",
                    "e_", "n_", "longitude", "latitude")
col_lower <- tolower(names(df_main))
coord_cols <- names(df_main)[sapply(col_lower, function(cn)
  any(sapply(coord_patterns, function(p) grepl(p, cn, fixed = TRUE)))
)]

if (length(coord_cols) > 0) {
  cat("Colonnes potentiellement géographiques :", paste(coord_cols, collapse = ", "), "\n")
  for (cc in coord_cols) {
    vals <- df_main[[cc]][!is.na(df_main[[cc]])]
    if (length(vals) > 0 && is.numeric(vals)) {
      cat(sprintf("  %s : min=%.4f  max=%.4f  (n=%d valeurs non-NA)\n",
                  cc, min(vals), max(vals), length(vals)))
    }
  }
  # Heuristique CRS
  # WGS84 : lon [-180,180], lat [-90,90] — valeurs petites
  # Lambert-93 : X ~200000-1200000, Y ~6000000-7200000 — très grandes valeurs
  for (cc in coord_cols) {
    vals <- df_main[[cc]][!is.na(df_main[[cc]])]
    if (length(vals) > 0 && is.numeric(vals)) {
      if (abs(max(vals)) > 10000) {
        cat(sprintf("  → '%s' semble en Lambert-93 ou coordonnées métriques (valeurs > 10 000)\n", cc))
      } else {
        cat(sprintf("  → '%s' semble en degrés décimaux WGS84 (valeurs < 10 000)\n", cc))
      }
    }
  }
} else {
  cat("Aucune colonne de coordonnées détectée automatiquement.\n")
  cat("Toutes les colonnes :", paste(names(df_main), collapse = ", "), "\n")
}
cat("\n")

# -----------------------------------------------------------------------------
# 1.5 — Champs utiles pour la PWA
# -----------------------------------------------------------------------------
cat("--- 1.5 Aperçu des données (10 premières lignes, colonnes clés) ---\n")
print(head(df_main, 10))
cat("\n")

# -----------------------------------------------------------------------------
# 1.6 — Données manquantes
# -----------------------------------------------------------------------------
cat("--- 1.6 Données manquantes par colonne ---\n")
na_counts <- sapply(df_main, function(col) sum(is.na(col)))
na_pct    <- round(na_counts / nrow(df_main) * 100, 1)
na_df     <- data.frame(
  colonne    = names(na_counts),
  nb_NA      = as.integer(na_counts),
  pct_NA     = na_pct,
  row.names  = NULL
)
na_df <- na_df[order(-na_df$nb_NA), ]
print(na_df)
cat(sprintf("\nNombre total de sites : %d\n", nrow(df_main)))

# Sites sans coordonnées (si colonnes détectées)
if (length(coord_cols) >= 2) {
  sites_sans_coord <- df_main[
    rowSums(is.na(df_main[, coord_cols, drop = FALSE])) > 0, ]
  cat(sprintf("Sites avec au moins une coordonnée manquante : %d\n",
              nrow(sites_sans_coord)))
  if (nrow(sites_sans_coord) > 0) {
    print(sites_sans_coord[, union(coord_cols,
          intersect(names(df_main), c("Nom", "nom", "Site", "site", "ID", "id"))),
          drop = FALSE])
  }
}
cat("\n")

# -----------------------------------------------------------------------------
# 1.3 — Inspection du header LAS
# -----------------------------------------------------------------------------
cat("--- 1.3 Inspection du header LAS ---\n")
if (file.exists(PATH_LAS)) {
  hdr <- readLASheader(PATH_LAS)
  print(hdr)
  cat("\n")
  cat("Résumé :\n")
  cat(sprintf("  CRS LAS   : %s\n",
              tryCatch(st_crs(hdr)$input, error = function(e) "inconnu")))
  cat(sprintf("  Nb points : %s\n",
              format(hdr@PHB$`Number of point records`, big.mark = " ")))
  cat(sprintf("  Extent X  : %.2f → %.2f\n", hdr@PHB$`Min X`, hdr@PHB$`Max X`))
  cat(sprintf("  Extent Y  : %.2f → %.2f\n", hdr@PHB$`Min Y`, hdr@PHB$`Max Y`))
  cat(sprintf("  Extent Z  : %.2f → %.2f\n", hdr@PHB$`Min Z`, hdr@PHB$`Max Z`))

  # Densité estimée (points/m²)
  area_m2 <- (hdr@PHB$`Max X` - hdr@PHB$`Min X`) *
             (hdr@PHB$`Max Y` - hdr@PHB$`Min Y`)
  density  <- hdr@PHB$`Number of point records` / area_m2
  cat(sprintf("  Densité   : ~%.1f pts/m²\n", density))
} else {
  cat("⚠ Fichier LAS non trouvé :", PATH_LAS, "\n")
  cat("  (Le fichier fait ~3,8 Go, s'assurer qu'il est bien présent)\n")
}
cat("\n")

# -----------------------------------------------------------------------------
# 1.4 — Couverture spatiale LAS vs sites BDD
# -----------------------------------------------------------------------------
cat("--- 1.4 Couverture spatiale LAS vs sites BDD ---\n")
if (file.exists(PATH_LAS) && length(coord_cols) >= 2) {

  hdr <- readLASheader(PATH_LAS)

  # Identifier colonnes lon/lat
  lon_col <- coord_cols[grepl("lon|lng|x", tolower(coord_cols))][1]
  lat_col <- coord_cols[grepl("lat|y",     tolower(coord_cols))][1]

  if (!is.na(lon_col) && !is.na(lat_col)) {
    df_geo <- df_main[!is.na(df_main[[lon_col]]) & !is.na(df_main[[lat_col]]), ]
    sites_sf <- st_as_sf(df_geo,
                         coords = c(lon_col, lat_col),
                         crs = 4326)  # Supposé WGS84 — à ajuster si Lambert-93

    # Bbox LAS dans son CRS natif
    las_crs <- tryCatch(st_crs(hdr), error = function(e) NA)
    cat(sprintf("CRS LAS : %s\n",
                tryCatch(st_crs(hdr)$input, error = function(e) "inconnu")))

    bbox_las <- st_bbox(c(
      xmin = hdr@PHB$`Min X`, xmax = hdr@PHB$`Max X`,
      ymin = hdr@PHB$`Min Y`, ymax = hdr@PHB$`Max Y`
    ))

    cat(sprintf("Bbox LAS : X [%.2f, %.2f]  Y [%.2f, %.2f]\n",
                bbox_las["xmin"], bbox_las["xmax"],
                bbox_las["ymin"], bbox_las["ymax"]))
    cat(sprintf("Sites valides (avec coordonnées) : %d / %d\n",
                nrow(df_geo), nrow(df_main)))
    cat("(Vérification spatiale fine possible après confirmation du CRS LAS)\n")
  } else {
    cat("Impossible d'identifier colonnes lon/lat avec certitude.\n")
  }
} else if (!file.exists(PATH_LAS)) {
  cat("LAS absent — vérification spatiale ignorée.\n")
} else {
  cat("Coordonnées BDD non détectées — vérification spatiale ignorée.\n")
}

cat("\n=============================================================\n")
cat("PHASE 1 — Exploration terminée\n")
cat("=============================================================\n")
