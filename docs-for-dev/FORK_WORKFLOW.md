# Kaiwen fork workflow

This checkout is a fork: `origin` = `lazytalk/DeepTutor` (ours),
`upstream` = `HKUDS/DeepTutor`. Goal: ship our own features **and** keep
receiving upstream releases with minimal merge pain.

## Branch model

| Branch | Role | Rule |
| --- | --- | --- |
| `upstream-mirror` | tracks `upstream/main` | never commit here |
| `main` | integration: upstream + our delta | all our work lands here, tagged per deploy |
| `fix/*`, `feat/*` | short-lived topic branches | merge into `main` via PR/commit |

Our delta stays in three layers, smallest-conflict first:

1. **Brand layer** — mechanical token renames + logo assets. Reproducible with
   `python scripts/apply_rebrand.py` (idempotent). Locale JSON keys are `t()`
   identifiers: rename **values only**, never keys.
2. **Fix layer** — small bug fixes. Prefer an upstream PR; once upstream ships
   the fix, delete ours. Production-only hotfixes are forbidden (see below).
3. **Feature layer** — new capabilities/tools as **plugins** in their own
   directories (`docs-for-dev/PLUGINS.md`, `MODULES.md`), registered via the
   registries/bootstrap. Plugin files are new files: upstream merges never
   conflict with them. Touch core only when no hook exists, and upstream such
   hooks as PRs when possible.

## Sync ritual (per upstream release)

```sh
git fetch upstream --tags
git checkout main && git merge v1.7.X          # or upstream/main between releases
# conflict rules:
#   web/locales/**, persona yamls  -> take upstream, then: python scripts/apply_rebrand.py
#   brand assets                  -> keep ours unless upstream intentionally rebranded
#   core files                    -> resolve by hand, review the upstream changelog
python scripts/apply_rebrand.py --check        # must report 0 after resolution
.venv/bin/python -m pytest deeptutor -x -q     # subset at minimum
npm --prefix web run build
git tag kaiwen-v1.7.X && git push origin main --tags
```

## Deploy discipline

- Production (`kwedeeptutor.kaiweneducation.com`, `ssh appstage`) deploys **only
  from a `kaiwen-*` tag**. The host checkout `/srv/deeptutor/upstream-pr` is
  reset to the tag at deploy time; **never edit it in place** — that is how the
  v1.7.2 + untracked-hotfix drift happened.
- Build = overlay Dockerfile `FROM <current prod image>` + `COPY web/` + changed
  python dirs + `npm ci --legacy-peer-deps --include=dev` (the prod image sets
  `NODE_ENV=production`, which otherwise skips tailwindcss) + `npm run build` +
  standalone rearrange. See `/srv/deeptutor/custom-image/Dockerfile.rebrand`.
- Since the four production overlays (dashscope HTTP ASR, visualize
  `book_block_id`, book animation timeout, LLM factory `StreamOutcome`) were
  ported into `main` on 2026-11-24, **new builds must NOT re-apply the
  `custom-image/{dashscope.py,book-html-fix,hotfix-mastery-shared-book}` COPY
  layers** — they would regress the evolved 1.7.4 files.
- Swap containers with the recovery-script pattern
  (`/srv/deeptutor/recovery/deploy-*.py`): inspect → recreate with identical
  env/ports/mounts → health probe → auto-rollback. Keep the renamed old
  container until the next deploy succeeds.
- In-container maintenance runs as `docker exec -u 1000:1000` (uid ownership).

## Rollback

`docker stop deeptutor && docker rm deeptutor && docker rename <backup> deeptutor
&& docker network connect <net> deeptutor && docker start deeptutor` — backup
names and pre-swap state JSONs live in `/srv/deeptutor/recovery/`.
