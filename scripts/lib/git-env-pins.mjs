// This room's pins for the canon git-spawn census (scripts/lib/git-env-census.mjs, adopted by blob id from the .github canon, 09a commit B).
// A pin is { rel, blob, why }: it hides ONE file from the census while the file's git blob id (line endings read as LF) equals `blob`, so the first edited byte re-arms
// the census on that file. Each row below was MEASURED one at a time against the real file (scratchpad/09a/pins-measure.mjs): with the pin out, the census refuses
// exactly that file, and the findings quoted in `why` are the reason it stays. A file this room can fix is fixed, never pinned (verify.mjs and verify.test.mjs were
// fixed in the same commit; secret-gate.test.mjs came out of the list when the canon rewrote it to named keys, and secret-scan.test.mjs came out when the room took Bankfire's source copy a0319dcd, 09b).
// Dev-only: nothing in the shipped plugin imports this file, so it is a BUILD_ONLY lib.
export const ROOM_GIT_ENV_PINS = [
  {
    rel: 'scripts/lib/git-env.test.mjs',
    blob: '1deb23098a7905c64451c4bcb9c909b2c321742f',
    why: 'the hazard proof: three spawns (the fixture half, the bare-flip capability probe and the victim half) feed a deliberately poisoned, unguarded GIT_DIR to reproduce the real incident (CWK-133); the census refuses all three (lines 99, 120, 144), which is the point of the test',
  },
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '856956a1cca6f716e5507f6c23ac90ed34cbbe5f',
    why: 'the canon secret gate, byte equal to the .github canon: it keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES by design (commit mode reads the commit\'s own index, which a hook names through that variable), so its gitEnv() copies process.env minus the other GIT_ names; the census refuses its two spawns (lines 57 and 60) and the canon pins the same blob',
  },
];
