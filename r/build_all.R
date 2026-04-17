# =============================================================================
# build_all.R — PHASE 5 : Script maître — Build pipeline complet
# Projet : Catalogue Sites de Plongée SMPE — Baie de Saint-Malo
# Date   : 2026-04-17
#
# Tâches couvertes :
#   5.1 source() des scripts R + system() python
#   5.2 Logs + timings à chaque étape
#   5.3 Copie automatique data/ → pwa/data/
#   5.4 Validation end-to-end
#
# Usage :
#   Depuis la racine du projet :
#     Rscript r/build_all.R
#   Ou dans RStudio :
#     source("r/build_all.R")
# =============================================================================

# ---------------------------------------------------------------------------
# Utilitaires internes
# ---------------------------------------------------------------------------

.log <- function(msg, level = "INFO") {
    ts <- format(Sys.time(), "%H:%M:%S")
    cat(sprintf("[%s] [%s] %s\n", ts, level, msg))
}

.step <- function(label, expr) {
    .log(sprintf("=== DÉBUT : %s ===", label))
    t0 <- proc.time()
    tryCatch(
        {
            force(expr)
            elapsed <- (proc.time() - t0)[["elapsed"]]
            .log(sprintf("=== FIN   : %s  (%.1f s) ===\n", label, elapsed))
        },
        error = function(e) {
            .log(sprintf("ERREUR dans '%s' : %s", label, conditionMessage(e)), level = "ERROR")
            stop(e)
        }
    )
}

# ---------------------------------------------------------------------------
# Répertoire de travail — toujours la racine du projet
# ---------------------------------------------------------------------------

# Stratégie : on résout le chemin du script (via source() ou Rscript),
# puis on remonte d'un niveau. Si tout échoue, getwd() est déjà la racine.
.get_project_root <- function() {
    # 1) Via source() dans RStudio : sys.frame(1)$ofile
    ofile <- tryCatch(sys.frame(1)$ofile, error = function(e) NULL)
    if (!is.null(ofile) && nzchar(ofile)) {
        return(normalizePath(dirname(ofile), mustWork = FALSE))
    }
    # 2) Via Rscript --file= : argument de la ligne de commande
    args <- commandArgs(trailingOnly = FALSE)
    file_arg <- grep("^--file=", args, value = TRUE)
    if (length(file_arg) > 0) {
        script_path <- sub("^--file=", "", file_arg[1])
        # Résoudre relativement au cwd si chemin relatif
        if (!startsWith(script_path, "/")) {
            script_path <- file.path(getwd(), script_path)
        }
        script_dir <- normalizePath(dirname(script_path), mustWork = FALSE)
        return(normalizePath(file.path(script_dir, ".."), mustWork = FALSE))
    }
    # 3) Fallback : le cwd est déjà la racine du projet
    return(getwd())
}

project_root <- .get_project_root()
setwd(project_root)
.log(sprintf("Racine projet : %s", project_root))

# ---------------------------------------------------------------------------
# Configuration — chemins
# ---------------------------------------------------------------------------

DATA_DIR <- "data"
PWA_DATA_DIR <- "pwa/data"

# Fichiers à synchroniser data/ → pwa/data/
FILES_TO_SYNC <- c(
    "sites.geojson",
    "bathy_sites.json",
    "marees.json"
)

# ---------------------------------------------------------------------------
# ÉTAPE 1 — BDD Excel → GeoJSON  (Phase 2)
# ---------------------------------------------------------------------------

.step("Phase 2 — BDD → GeoJSON", {
    source("r/02_process_bdd.R", echo = FALSE, local = new.env())
})

# ---------------------------------------------------------------------------
# ÉTAPE 2 — LiDAR → Bathymétrie  (Phase 3)
# ---------------------------------------------------------------------------

.step("Phase 3 — LiDAR → Bathymétrie", {
    source("r/01_process_las.R", echo = FALSE, local = new.env())
})

# ---------------------------------------------------------------------------
# ÉTAPE 3 — Tables de marées FES2022  (Phase 4)
# ---------------------------------------------------------------------------

.step("Phase 4 — Marées FES2022", {
    # Chercher python3 (conda ou système)
    python_cmd <- Sys.which("python3")
    if (!nzchar(python_cmd)) python_cmd <- Sys.which("python")
    if (!nzchar(python_cmd)) stop("python3 introuvable dans PATH")

    cmd <- sprintf('"%s" "r/04_marees_fes.py"', python_cmd)
    .log(sprintf("Commande : %s", cmd))
    ret <- system(cmd)
    if (ret != 0) stop(sprintf("Le script Python a retourné le code %d", ret))
})

# ---------------------------------------------------------------------------
# ÉTAPE 4 — Copie data/ → pwa/data/
# ---------------------------------------------------------------------------

.step("Phase 5.3 — Copie data/ → pwa/data/", {
    if (!dir.exists(PWA_DATA_DIR)) {
        dir.create(PWA_DATA_DIR, recursive = TRUE)
        .log(sprintf("Dossier créé : %s", PWA_DATA_DIR))
    }

    for (f in FILES_TO_SYNC) {
        src <- file.path(DATA_DIR, f)
        dest <- file.path(PWA_DATA_DIR, f)
        if (!file.exists(src)) {
            .log(sprintf("ABSENT (ignoré) : %s", src), level = "WARN")
            next
        }
        ok <- file.copy(src, dest, overwrite = TRUE)
        if (ok) {
            size_kb <- round(file.info(dest)$size / 1024, 1)
            .log(sprintf("Copié : %s → %s  (%s Ko)", src, dest, size_kb))
        } else {
            .log(sprintf("Échec copie : %s → %s", src, dest), level = "ERROR")
        }
    }

    # Copie du dossier thumbs/ (miniatures bathymétriques)
    src_thumbs <- file.path("pwa", "data", "thumbs") # déjà géré par 01_process_las.R
    # (les thumbs sont directement écrits dans pwa/data/thumbs par le script LiDAR)
    .log("Dossier thumbs/ géré directement par 01_process_las.R — pas de copie supplémentaire.")
})

# ---------------------------------------------------------------------------
# ÉTAPE 5 — Validation end-to-end
# ---------------------------------------------------------------------------

.step("Phase 5.4 — Validation", {
    errors <- character(0)

    # Fichiers attendus
    expected_files <- c(
        file.path(DATA_DIR, "sites.geojson"),
        file.path(DATA_DIR, "bathy_sites.json"),
        file.path(DATA_DIR, "marees.json"),
        file.path(PWA_DATA_DIR, "sites.geojson"),
        file.path(PWA_DATA_DIR, "bathy_sites.json"),
        file.path(PWA_DATA_DIR, "marees.json")
    )

    for (f in expected_files) {
        if (!file.exists(f)) {
            errors <- c(errors, sprintf("MANQUANT : %s", f))
        } else {
            size_kb <- round(file.info(f)$size / 1024, 1)
            .log(sprintf("OK  %s  (%s Ko)", f, size_kb))
        }
    }

    # Vérification GeoJSON (nombre de features)
    geojson_path <- file.path(DATA_DIR, "sites.geojson")
    if (file.exists(geojson_path)) {
        library(jsonlite)
        gj <- fromJSON(geojson_path)
        n <- length(gj$features[[1]])
        .log(sprintf("sites.geojson : %d features", n))
        if (n < 50) errors <- c(errors, sprintf("sites.geojson : seulement %d features (attendu ≥ 50)", n))
    }

    # Vérification marees.json (nombre de jours)
    marees_path <- file.path(DATA_DIR, "marees.json")
    if (file.exists(marees_path)) {
        library(jsonlite)
        mr <- fromJSON(marees_path)
        n <- nrow(mr)
        .log(sprintf("marees.json : %d jours", n))
        if (n < 360) errors <- c(errors, sprintf("marees.json : seulement %d jours (attendu ≥ 360)", n))
    }

    # Vérification bathy_sites.json (nombre de sites)
    bathy_path <- file.path(DATA_DIR, "bathy_sites.json")
    if (file.exists(bathy_path)) {
        library(jsonlite)
        bs <- fromJSON(bathy_path)
        n <- length(bs)
        .log(sprintf("bathy_sites.json : %d sites", n))
        if (n < 40) errors <- c(errors, sprintf("bathy_sites.json : seulement %d sites (attendu ≥ 40)", n))
    }

    if (length(errors) > 0) {
        .log("RÉSUMÉ DES ERREURS :", level = "ERROR")
        for (e in errors) .log(e, level = "ERROR")
        stop("Build incomplet — voir erreurs ci-dessus.")
    } else {
        .log("✅ Tous les fichiers sont présents et valides.")
    }
})

# ---------------------------------------------------------------------------
# Résumé final
# ---------------------------------------------------------------------------

.log("============================================")
.log("✅  BUILD COMPLET — Toutes les étapes OK")
.log("============================================")
