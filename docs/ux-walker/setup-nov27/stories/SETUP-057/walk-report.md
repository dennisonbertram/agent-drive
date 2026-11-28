# SETUP-057 walk report: Sandbox is asleep and wake is off
Status: partial.
1. `mounts wake coordinator off` (registered entry, no service): "Could not find an executable Instabox CLI in PATH or ~/.local/bin." Exit 1; docs say the command "does not call Instabox". `mounts service status coordinator` fails the same way even though it only reads state.
2. `mounts wake coordinator maybe`: "Usage: mounts wake NAME on|off". Clear.
3. `connect fg <mp> --sandbox m_9999 --root /workspace/x --no-wake-on-access` saved `wakeOnAccess:false` in the printed JSON before failing on the missing Finder app.
Not-walkable: Finder behaviour for a sleeping sandbox, wake timeout errors, service restart.
## Flow Log
Ideal 3; none completed. Hesitation: copy contradicts docs.
