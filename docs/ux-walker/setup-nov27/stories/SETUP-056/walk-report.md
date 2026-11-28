# SETUP-056 walk report: Instabox CLI is missing
Status: partial (walkable on this host; no Instabox installed).

1. `connect coordinator <mp> --sandbox m_7f3a1234 --root /workspace/project --persist` printed only: "Could not find an executable Instabox CLI in PATH or ~/.local/bin." Exit 1. The message does not say what Instabox is or how to install it.
2. `mounts list` afterwards shows the entry registered (wakeOnAccess true). Rerun of the same command: "A mount named 'coordinator' is already registered." with no pointer to `mounts forget coordinator`.
3. Docs search: /docs/cli and --help use "Instabox" without a definition or link; /docs/sandboxes has no mention.
4. `mounts forget coordinator` removed the entry (`{"forgotten":"coordinator"}`).
Not-walkable: installing Instabox and rerunning.

## Flow Log
Ideal 3; actual blocked at step 1, plus 1 extra step (forget) the message does not mention. Hesitations: what Instabox is. Re-entry blocked by leftover registration.
