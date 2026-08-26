# =============================================================================
# 02_process_bdd.R — PHASE 2 : BDD Excel → GeoJSON
# Projet : Catalogue Sites de Plongée SMPE — Baie de Saint-Malo
# Date   : 2026-04-08
#
# Tâches couvertes :
#   2.1 Lecture de la BDD (Google Sheet) avec googlesheets4
#   2.2 Conversion en objet sf + vérification CRS WGS84
#   2.3 Sélection et renommage des colonnes utiles
#   2.4 Export data/sites.geojson
#
# La BDD source n'est plus un fichier XLSX versionne (migration de securite
# 2026-08-26 : ne plus exposer la BDD complete sur le depot public). Elle vit
# desormais dans un Google Sheet, identifie par GOOGLE_SHEET_BDD_ID defini
# dans r/config_local.R (gitignore, cf. r/config_local.R.example). Auth via
# googlesheets4::gs4_auth() -- navigateur au premier lancement, token mis en
# cache localement ensuite.
# =============================================================================

library(googlesheets4)
library(sf)
library(jsonlite)

# Config locale (gitignoree) : GOOGLE_SHEET_BDD_ID
CONFIG_LOCAL <- "r/config_local.R"
if (!file.exists(CONFIG_LOCAL)) {
  stop(sprintf(
    "Fichier manquant : %s\nCopier r/config_local.R.example vers r/config_local.R et renseigner GOOGLE_SHEET_BDD_ID.",
    CONFIG_LOCAL
  ))
}
source(CONFIG_LOCAL)
stopifnot(
  "GOOGLE_SHEET_BDD_ID doit etre defini dans r/config_local.R" =
    exists("GOOGLE_SHEET_BDD_ID") && nzchar(GOOGLE_SHEET_BDD_ID)
)

PATH_GEOJSON <- "data/sites.geojson"

cat("=============================================================\n")
cat("PHASE 2 -- Preprocessing BDD : Google Sheet -> GeoJSON\n")
cat("=============================================================\n\n")

# =============================================================================
# 2.1 — Lecture de la BDD (Google Sheet)
# =============================================================================
cat("--- 2.1 Lecture de la BDD (Google Sheet) ---\n")

gs4_auth()  # navigateur au premier lancement, token cache ensuite
df_raw <- read_sheet(GOOGLE_SHEET_BDD_ID, sheet = "site")

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

# Vocabulaire contrôlé pour "mouillage" (fixe/ancre/gueuse/vide) — cf.
# specs/2026-07-28-type-mouillage-design.md. Les anciennes valeurs texte
# libre (ex. "Ancre - Tête de roche") pas encore reformulées dans le Sheet
# ne bloquent pas le build, mais sont signalées ici pour être corrigées.
if ("mouillage" %in% names(sf_pwa)) {
  valeurs_autorisees <- c("fixe", "ancre", "gueuse")
  mouillage_vals <- tolower(trimws(sf_pwa$mouillage))
  anomalies <- sf_pwa$siteID[!is.na(mouillage_vals) & !(mouillage_vals %in% valeurs_autorisees)]
  if (length(anomalies) > 0) {
    warning(sprintf(
      "Valeurs 'mouillage' non conformes (attendu fixe/ancre/gueuse/vide) pour : %s\n→ À reformuler dans le Google Sheet.",
      paste(anomalies, collapse = ", ")
    ))
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
