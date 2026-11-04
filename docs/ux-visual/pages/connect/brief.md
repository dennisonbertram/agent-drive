# Brief: /connect (Agent Drive device pairing)
App: Agent Drive gives each AI agent its own portable, client-side encrypted drive. Users sign in on the web console and manage agents, drives, keys.
Page: /connect, a standalone card where a signed-in human enters or confirms the XXXX-XXXX code an agent's CLI (`agent-drive login`) printed, then approves or denies that agent. One focused job, done in under 30 seconds.
Persona: a developer who just ran `agent-drive login` in a terminal and opened the link; also possibly a non-expert pasting a code. Needs to be sure the code matches their terminal and what approving grants.
States: code entry, bad format, not found/expired, rate-limited, waiting request for a new drive, reconnect to an existing drive, approve error, approved, denied, long agent/machine names.
Viewports: 1440x900, 1920x1080, 768x1024, 375x812.
Style: T1 "Rack": warm aluminium ground with dot grid, smoked-glass code display, one signal orange for LEDs/readouts/primary action, Space Grotesk + IBM Plex Mono.
