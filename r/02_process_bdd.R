# =============================================================================
# 02_process_bdd.R — PHASE 2 : BDD Excel → GeoJSON
# Projet : Catalogue Sites de Plongée SMPE — Baie de Saint-Malo
# Date   : 2026-04-08
#
# Tâches couvertes :
#   2.1 Lecture du XLSX avec readxl
#   2.2 Conversion en objet sf + vérification CRS WGS84
#   2.3 Sélection et renommage des colonnes utiles
#   2.4 Export data/sites.geojson
# =============================================================================

library(readxl)
library(sf)
library(jsonlite)

# Chemins (lancer depuis la racine du projet)
PATH_XLSX    <- "bdd/bddAtlasPlongeeSMPE.xlsx"
PATH_GEOJSON <- "data/sites.geojson"

cat("=============================================================\n")
cat("PHASE 2 — Preprocessing BDD : Excel → GeoJSON\n")
cat("=============================================================\n\n")

# =============================================================================
# 2.1 — Lecture du XLSX
# =============================================================================
cat("--- 2.1 Lecture du XLSX ---\n")

df_raw <- read_excel(PATH_XLSX, sheet = "site")

cat(sprintf("Chargé : %d lignes × %d colonnes\n", nrow(df_raw), ncol(df_raw)))
cat("Colonnes disponibles :", paste(names(df_raw), collapse = ", "), "\n\n")

# =============================================================================
# 2.2 — Conversion en objet sf + vérification CRS
# =============================================================================
cat("--- 2.2 Conversion sf + CRS WGS84 ---\n")

# Supprimer les lignes sans coordonnées (sites SR047–SR053, SE015)
df_coords <- df_raw[!is.na(df_raw$latitude) & !is.na(df_raw$longitude), ]
n_sans_coords <- nrow(df_raw) - nrow(df_coords)
cat(sprintf("Sites sans coordonnées exclus : %d  (conservés : %d)\n",
            n_sans_coords, nrow(df_coords)))

# Conversion en objet sf — coordonnées déjà en WGS84 (degrés décimaux)
sf_sites <- st_as_sf(
  df_coords,
  coords = c("longitude", "latitude"),
  crs    = 4326,   # WGS84 — confirmé phase 1
  remove = FALSE   # Conserver les colonnes lon/lat dans les attributs
)

cat(sprintf("CRS assigné : %s\n", st_crs(sf_sites)$input))
cat(sprintf("Nombre de features : %d\n", nrow(sf_sites)))
cat(sprintf("Emprise : %s\n\n", paste(round(st_bbox(sf_sites), 4), collapse = ", ")))

# Vérification sanity (bornes attendues pour la Baie de Saint-Malo)
bbox <- st_bbox(sf_sites)
stopifnot(
  "longitude hors plage attendue [-3, -1.5]" = bbox["xmin"] > -3 && bbox["xmax"] < -1.5,
  "latitude hors plage attendue [48, 49.5]"  = bbox["ymin"] > 48 && bbox["ymax"] < 49.5
)
cat("✅ CRS et emprise validés\n\n")

# =============================================================================
# 2.3 — Sélection et renommage des colonnes utiles (pour la PWA)
# =============================================================================
cat("--- 2.3 Sélection des colonnes PWA ---\n")

# Champs utiles identifiés en phase 1.5
# Colonnes attendues dans la feuille "site" (noms exacts du XLSX)
# On utilise setdiff pour signaler proprement les colonnes manquantes
cols_voulues <- c(
  "siteID", "siteNom",
  "latitude", "longitude",
  "typeSite", "accessibilite", "typePlongee", "niveauPlongee",
  "accesVent", "houle", "mouillage", "maree", "tpsEtale",
  "commentaire", "photoSite"
)

cols_absentes <- setdiff(cols_voulues, names(sf_sites))
if (length(cols_absentes) > 0) {
  warning(sprintf(
    "Colonnes voulues absentes du XLSX : %s\n→ Elles seront ignorées",
    paste(cols_absentes, collapse = ", ")
  ))
}

cols_presentes <- intersect(cols_voulues, names(sf_sites))
# Toujours garder la géométrie (sf la gère automatiquement)
sf_pwa <- sf_sites[, cols_presentes]

cat(sprintf("Colonnes retenues (%d) : %s\n\n",
            length(cols_presentes),
            paste(cols_presentes, collapse = ", ")))

# Nettoyage des valeurs texte : remplacer NA par NULL (JSON natif)
# Convertir les colonnes character NA → NA (jsonlite les gérera en null)
for (col in cols_presentes) {
  if (is.character(sf_pwa[[col]])) {
    sf_pwa[[col]] <- trimws(sf_pwa[[col]])
    sf_pwa[[col]][sf_pwa[[col]] == ""] <- NA_character_
  }
}

# =============================================================================
# 2.4 — Export GeoJSON
# =============================================================================
cat("--- 2.4 Export GeoJSON ---\n")

# Créer le dossier data/ si absent
dir.create(dirname(PATH_GEOJSON), showWarnings = FALSE, recursive = TRUE)

# Supprimer l'éventuel fichier existant (sf::st_write refuse d'écraser)
if (file.exists(PATH_GEOJSON)) file.remove(PATH_GEOJSON)

st_write(
  sf_pwa,
  dsn            = PATH_GEOJSON,
  driver         = "GeoJSON",
  layer_options  = c("COORDINATE_PRECISION=6"),  # 6 décimales ≈ 11 cm, suffisant
  quiet          = FALSE
)

# Vérification taille fichier
taille_ko <- round(file.size(PATH_GEOJSON) / 1024, 1)
cat(sprintf("Fichier généré : %s  (%.1f Ko)\n\n", PATH_GEOJSON, taille_ko))

# =============================================================================
# 2.5 — Validation rapide du GeoJSON produit
# =============================================================================
cat("--- 2.5 Validation du GeoJSON ---\n")

check <- st_read(PATH_GEOJSON, quiet = TRUE)
cat(sprintf("Features    : %d\n", nrow(check)))
cat(sprintf("Colonnes    : %s\n", paste(names(check), collapse = ", ")))
cat(sprintf("CRS (EPSG)  : %s\n", st_crs(check)$input))
cat(sprintf("Géométries  : %s\n", paste(unique(st_geometry_type(check)), collapse = ", ")))

# Vérification que tous les siteID sont uniques
if (anyDuplicated(check$siteID) > 0) {
  warning("⚠️  Des siteID dupliqués ont été détectés !")
} else {
  cat("siteID      : tous uniques ✅\n")
}

cat(sprintf("Taille      : %.1f Ko ✅\n", taille_ko))

cat("\n=============================================================\n")
cat("PHASE 2 terminée — data/sites.geojson prêt pour la PWA ✅\n")
cat("=============================================================\n")
