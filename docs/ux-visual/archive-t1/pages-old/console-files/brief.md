# Brief: console-files

App: Agent Drive, an encrypted file drive for AI agents. The operator console (/console) is where a human sees which drives (one per agent) exist, browses file paths, loads the drive key locally to decrypt and download, and checks key backup status. Files are encrypted client-side; file names and metadata are visible.
Page: Files view of the console, an app surface (should fit one screen at >=1280x800, long lists scroll inside the table panel).
Persona: a developer/operator who just connected a CLI agent and wants to confirm files arrived, then download one. Not a cryptographer.
Design: "T1 Rack": warm aluminium ground, black ink, one signal orange for LEDs and the primary action, Space Grotesk + IBM Plex Mono, drive bay strip of smoked-glass chips.
States: onboarding (no drives), empty drive, populated (10 files, long paths, emoji/CJK name), key not loaded vs loaded, backup warning vs backed up, loading, filter and no-match, 3 drives in bay strip.
Viewports: 1440x900, 1920x1080, 768x1024, 375x812.
