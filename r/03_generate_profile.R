#!/usr/bin/env Rscript
# r/03_generate_profile.R
# Extraction d'un profil topographique depuis un MNT GeoTIFF
# Usage:
#   Rscript r/03_generate_profile.R <tile.tif> <lon1> <lat1> <lon2> <lat2> [datetime] [out.json] [out.png]
# datetime optionnel au format ISO 8601 (ex: "2026-04-09T10:30:00"). Si fourni, on tentera d'ajuster
# les profondeurs en fonction de la hauteur d'eau extraite depuis `pwa/data/marees.json` (ou `data/marees.json`).

suppressPackageStartupMessages({
    library(terra)
    library(sf)
    library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    cat("Usage: Rscript r/03_generate_profile.R <tile.tif> <lon1> <lat1> <lon2> <lat2> [datetime] [out.json] [out.png]\n")
    quit(status = 1)
}

tile_path <- args[1]
lon1 <- as.numeric(args[2])
lat1 <- as.numeric(args[3])
lon2 <- as.numeric(args[4])
lat2 <- as.numeric(args[5])
datetime_iso <- if (length(args) >= 6) args[6] else NA
out_json <- if (length(args) >= 7) args[7] else file.path("data", "profile_result.json")
out_png <- if (length(args) >= 8) args[8] else file.path("data", "profile_plot.png")

if (!file.exists(tile_path)) stop(sprintf("MNT introuvable : %s", tile_path))

mnt <- terra::rast(tile_path)
crs_mnt <- terra::crs(mnt)

# Construire la ligne entre les deux points en WGS84 puis reprojeter vers le CRS du MNT
line_wgs <- st_sfc(st_linestring(matrix(c(lon1, lat1, lon2, lat2), ncol = 2, byrow = TRUE)), crs = 4326)
line_mnt <- st_transform(line_wgs, crs = crs_mnt)

# Échantillonnage le long de la ligne
n_points <- 200
pts_on_line <- st_line_sample(line_mnt, n = n_points, type = "regular")
pts_coords <- st_coordinates(pts_on_line)

# terra expects a SpatVector / vect
pts_vect <- terra::vect(pts_coords, type = "points", crs = crs_mnt)

# Extraire les valeurs Z (élévation) depuis le raster
vals <- terra::extract(mnt, pts_vect)
z_vals <- as.numeric(vals[, 2])

# Calculer les distances cumulées le long du profil (en mètres) en utilisant géométrie projetée
dist_m <- as.numeric(c(0, cumsum(sqrt(rowSums((pts_coords[-1, 1:2] - pts_coords[-nrow(pts_coords), 1:2])^2)))))

# Détermination de la hauteur d'eau (m) à datetime_iso si disponible
tide_height <- NA_real_
if (!is.na(datetime_iso)) {
    # Cherche marees.json en pwa/data puis data
    marees_paths <- c("pwa/data/marees.json", "data/marees.json")
    marees_file <- marees_paths[file.exists(marees_paths)][1]
    if (!is.na(marees_file) && file.exists(marees_file)) {
        cat(sprintf("Lecture des marées depuis %s\n", marees_file))
        marees <- tryCatch(fromJSON(marees_file), error = function(e) NULL)
        if (!is.null(marees)) {
            # marees expected format: an array or named object keyed by ISO date-time or by day.
            # We'll try a few heuristics: if named by ISO datetimes, pick exact or nearest.
            times <- NULL
            heights <- NULL
            if (is.list(marees) && length(marees) > 0) {
                # try extract if it's an array of records with fields date/time and height
                if (!is.null(marees[[1]]$date) && !is.null(marees[[1]]$height)) {
                    times <- sapply(marees, function(x) x$date)
                    heights <- sapply(marees, function(x) x$height)
                } else if (!is.null(names(marees))) {
                    # named list: names are datetimes
                    names_m <- names(marees)
                    # if values are numbers
                    if (all(sapply(marees, is.numeric))) {
                        times <- names_m
                        heights <- as.numeric(unlist(marees))
                    }
                }
            }
            if (!is.null(times) && !is.null(heights)) {
                # parse times and find nearest
                times_parsed <- as.POSIXct(times, format = "%Y-%m-%dT%H:%M:%S", tz = "UTC")
                target <- as.POSIXct(datetime_iso, format = "%Y-%m-%dT%H:%M:%S", tz = "UTC")
                if (is.na(target)) {
                    warning("datetime_iso non parsable : %s", datetime_iso)
                } else {
                    idx <- which.min(abs(difftime(times_parsed, target, units = "secs")))
                    tide_height <- as.numeric(heights[idx])
                    cat(sprintf("Hauteur d'eau approchée à %s : %.2f m\n", datetime_iso, tide_height))
                }
            } else {
                cat("Format de marees.json non reconnu — saut de l'ajustement maree\n")
            }
        }
    } else {
        cat("Aucun fichier marees.json trouvé — saut de l'ajustement maree\n")
    }
}

# Calcul profondeur depuis la surface : depth = water_elev - z_elev
# On considère z_vals comme élévation (m). Si tide_height NA, water_elev assumed 0.
water_elev <- ifelse(is.na(tide_height), 0, tide_height)
depth_m <- water_elev - z_vals

# Organiser le résultat
res <- list(
    meta = list(
        tile = tile_path,
        datetime = ifelse(is.na(datetime_iso), NULL, datetime_iso),
        water_elev = ifelse(is.na(tide_height), NULL, tide_height),
        n_points = length(z_vals)
    ),
    profile = list(
        dist_m = round(dist_m, 2),
        z_elev_m = round(z_vals, 3),
        depth_m = round(depth_m, 3)
    )
)

jsonlite::write_json(res, out_json, auto_unbox = TRUE, pretty = TRUE)
cat(sprintf("Profil exporté : %s\n", out_json))

# Dessiner le profil en PNG
png(out_png, width = 1000, height = 400)
par(mar = c(4, 4, 2, 2))
plot(dist_m, depth_m,
    type = "l", col = "blue", lwd = 2,
    xlab = "Distance (m)", ylab = "Profondeur (m)",
    main = sprintf("Profil (n=%d) — eau=%.2f m", length(depth_m), water_elev)
)
grid()
points(dist_m, depth_m, pch = 20, cex = 0.6, col = "blue")
dev.off()
cat(sprintf("PNG profil généré : %s\n", out_png))

invisible(NULL)
