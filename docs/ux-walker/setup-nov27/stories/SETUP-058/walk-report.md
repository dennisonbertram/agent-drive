# SETUP-058 walk report: Forget and clean up a mount
Status: partial.
1. `mounts forget nosuch`: "No mount registered as 'nosuch'." Clear. `mounts forget` with no name: "Usage: mounts forget NAME". Clear.
2. `mounts forget coordinator` on an entry left by a failed `connect --persist`: `{"forgotten":"coordinator"}`; `mounts list` then prints `[]`. Works in one command.
3. `mounts service remove coordinator` after forget: "No mount registered as 'coordinator'." Clear.
4. `--help` lists `mounts forget NAME` as "Forget an offline live workspace registration"; there is no disconnect/unmount verb listed.
Not-walkable: refusal while a login service or Finder mountpoint exists (needs Instabox and the Finder app).
## Flow Log
Ideal 2; actual 1 (no service existed). No hesitation in the steps walked.
