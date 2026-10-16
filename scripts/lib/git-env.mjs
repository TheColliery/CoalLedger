// CWK-133/C-4 -- a fixture or real-repo git spawn in THIS room's own scripts must never
// inherit an ambient GIT_* override. Inside a LINKED WORKTREE a git hook exports an
// ABSOLUTE GIT_DIR (the worktree's own admin dir) and an ABSOLUTE GIT_INDEX_FILE -- both
// override `cwd` AND any GIT_CEILING_DIRECTORIES a spawn tries to impose. Measured
// elsewhere in this flock (CoalFace, 2026-09-23): `GIT_DIR=<abs> git init -q .` in an
// EMPTY fixture dir created NO fixture `.git` and flipped the REAL enclosing repository's
// `core.bare` to `true`. Full incident: TheColliery/scratchpad/dispatch/
// r5-coalface.return.md, "INCIDENT during leg (c0) set-up".
//
// Ported from CoalFace `0a614ae` / CoalTipple `scripts/lib/git-env.mjs` (the exemplars
// named in this room's build order) -- the SHAPE transfers (strip the whole GIT_* family,
// never a hand list; set a ceiling); re-verified against THIS room's own git spawns below
// rather than taken on trust.
//
// Deleting the WHOLE `GIT_*` family, not a hand-maintained list, is the point -- a list
// rots; the family is what git actually reads (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
// GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, and anything else a future git version adds under
// the same prefix).
//
// `ceilingDir` is the one directory a spawn is never allowed to walk up past (ordinarily
// its own parent) -- belt-and-suspenders on top of the GIT_* strip.
export function gitEnv(ceilingDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CEILING_DIRECTORIES = ceilingDir;
  return env;
}
