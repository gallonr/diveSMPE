#!/usr/bin/env Rscript
# fix_bounds_wgs84.R — Correctif one-shot : recalcule les bounds_wgs84
# dans pwa/data/bathy_sites.json à partir des coordonnées Lambert-93
# (xmin, ymin, ncol, nrow, res) et reprojeté en WGS84 via terra.
#
# Cause du bug : write_json(..., digits = 2) tronquait les coordonnées
# WGS84 à 2 décimales → south == north pour certains sites → overlay invisible.
#
# Usage : Rscript r/fix_bounds_wgs84.R

suppressPackageStartupMessages({
    library(jsonlite)
    library(terra)
})

PATH_JSON <- "pwa/data/bathy_sites.json"

cat("Chargement de", PATH_JSON, "...\n")
data <- jsonlite::read_json(PATH_JSON, simplifyVector = FALSE)
cat(sprintf("  %d sites chargés\n", length(data)))

n_fixed <- 0

for (i in seq_along(data)) {
    entry <- data[[i]]
    sid <- entry$siteID
    g <- entry$grid

    if (is.null(g) || is.null(g$xmin) || is.null(g$ymin)) next

    xmin_l93 <- g$xmin
    ymin_l93 <- g$ymin
    ncol_g <- g$ncol
    nrow_g <- g$nrow
    res_g <- g$res
    xmax_l93 <- xmin_l93 + ncol_g * res_g
    ymax_l93 <- ymin_l93 + nrow_g * res_g

    # Créer un raster vide juste pour la reprojection de l'emprise
    r <- terra::rast(
        xmin = xmin_l93, xmax = xmax_l93,
        ymin = ymin_l93, ymax = ymax_l93,
        ncols = ncol_g, nrows = nrow_g,
        crs = "EPSG:2154"
    )
    r_wgs <- terra::project(r, "EPSG:4326")
    ext_w <- terra::ext(r_wgs)

    new_bounds <- list(
        west  = round(ext_w$xmin, 6),
        south = round(ext_w$ymin, 6),
        east  = round(ext_w$xmax, 6),
        north = round(ext_w$ymax, 6)
    )

    old_bounds <- g$bounds_wgs84
    changed <- is.null(old_bounds) ||
        abs(old_bounds$south - new_bounds$south) > 1e-5 ||
        abs(old_bounds$north - new_bounds$north) > 1e-5 ||
        abs(old_bounds$west - new_bounds$west) > 1e-5 ||
        abs(old_bounds$east - new_bounds$east) > 1e-5

    if (changed) {
        cat(sprintf(
            "  %-8s CORRIGÉ : S=%.2f→%.6f N=%.2f→%.6f W=%.2f→%.6f E=%.2f→%.6f\n",
            sid,
            ifelse(is.null(old_bounds), NA, old_bounds$south), new_bounds$south,
            ifelse(is.null(old_bounds), NA, old_bounds$north), new_bounds$north,
            ifelse(is.null(old_bounds), NA, old_bounds$west),  new_bounds$west,
            ifelse(is.null(old_bounds), NA, old_bounds$east),  new_bounds$east
        ))
        data[[i]]$grid$bounds_wgs84 <- new_bounds
        n_fixed <- n_fixed + 1
    }
}

cat(sprintf("\n%d sites corrigés sur %d.\n", n_fixed, length(data)))

if (n_fixed > 0) {
    # Sauvegarde du fichier original
    backup <- paste0(PATH_JSON, ".bak")
    file.copy(PATH_JSON, backup, overwrite = TRUE)
    cat(sprintf("Backup : %s\n", backup))

    jsonlite::write_json(data,
        path = PATH_JSON,
        auto_unbox = TRUE, pretty = FALSE
    )
    cat(sprintf("✅ %s mis à jour.\n", PATH_JSON))
} else {
    cat("Aucune correction nécessaire.\n")
}
