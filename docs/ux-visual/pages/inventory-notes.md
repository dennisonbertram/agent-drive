# Inventory notes (share, settings, billing inspector)

Pages and states reached (all at 1440x900, 768x1024, 390x844):

- /s/<id>#k=<key>: ready (seeded share, signed out view), missing key (no fragment), bad key format (#k=notakey), wrong key (valid-format other key, after clicking Download), revoked (throwaway share revoked via CLI), not found (unknown id), loading (fetch stalled), decrypting (ciphertext fetch stalled after Download click).
- Not reached: expired (no way to create one without DB access; CLI minimum 30m), completed download/success, "Try again"/unavailable error, long file name, large file progress.
- /console/settings: default (audit log populated 25 rows with Load older events, Delete one drive, Delete your account, Deletion requests empty). Not reached: audit log empty/error, deletion confirmed/in progress (not submitted), expanded "When is data actually removed?".
- /console/billing: default (summary tiles, plans with checkout disabled, spending controls, usage by agent table, export). Not reached: paid checkout enabled, validation errors on spending controls, export result, empty usage.
  Components seen: BrandMark, share card (head/sled/window/details/fault/paste form), button primary/secondary/disabled, pill tags, console header nav, data table, summary tile, plan card, details disclosure, destructive panel.
  Throwaway shares created for this run (both revoked): zjMqPymz_D-UauiIoqOQ1A, pxuEsfkwl6qnmUS1ZFHx_g.
  Previous run's share page output moved to the scratchpad (share-prev-run).
