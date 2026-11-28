# SETUP-001 walk report (pass with findings)

Steps: 1 landing (screenshots/step-1.png) hero, copy panel, geometry 0 overflow (wrappedControls list is a false positive; no wrap visible). 2 click "Copy prompt" -> button becomes "Copied" (step-2.png); layout shifts (code line unwraps, button narrows). Clipboard read blocked by browser so copied text not verified. 3 mobile 390px (mobile-check.png): no overflow, copy button stacks under code.
Flow Log: specified 3, needed 3. Hesitation: hero says "Free to start... you approve it in your account" but nothing says an account is needed first or that sign-up happens in the middle. Button says "Copy prompt" on landing, story/console say "Copy". Hero line hardcodes agentdrive.xyz even on this host.
