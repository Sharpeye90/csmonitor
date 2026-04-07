ALTER TABLE "PlayerStat"
ALTER COLUMN "kda" TYPE DOUBLE PRECISION
USING CASE
  WHEN "deaths" = 0 THEN "kills"::double precision
  ELSE "kills"::double precision / "deaths"::double precision
END;
