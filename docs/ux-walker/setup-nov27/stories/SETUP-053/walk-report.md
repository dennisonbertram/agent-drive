# SETUP-053 walk report: Linux FUSE mount
Status: not-walkable. The Studio is macOS arm64; no Linux FUSE, /dev/fuse or fusermount. Docs (/docs/cli, "Linux requirements and unmounting") list the requirements and the Ctrl+C / fusermount3 -u steps clearly. The error text for missing fusermount remains unverified. Note the docs copy for macOS (mountpoint is symlink-free, may not exist) versus Linux (empty directory ok) differs; see SETUP-055 finding F-SETUP-055-02.
## Flow Log
Specified 5 steps; none walkable.
