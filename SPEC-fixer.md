# Spec: fixer — V1

Module `fixer` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md), [ops](SPEC-ops.md) and
[cli](SPEC-cli.md); built last.

## Objective

An agent fixes production errors with no person in the loop. It takes one error group from
[ops](SPEC-ops.md), files one GitHub issue for it, reproduces it as a failing test, ships a fix,
and proves the fix live. It hands the group to a person when two shipped fixes have not cured it,
or when the cause is not in the code. A probe outside the host watches the server and the fixer.

Prior art:

- Sentry's Seer Autofix: from root cause, to a fix, to a pull request; a person reviews.
- SQS: the receipt handle and the visibility timeout. One worker holds a message at a time.
- Kubernetes leader election: a holder renews its lease before `renewDeadline`, which is shorter
  than the lease, and stops acting when it cannot renew. So a lease runs out only on a holder that
  has stopped.
- Fencing tokens (Kleppmann, "How to do distributed locking"): every write carries the claim, and
  the store refuses a claim that is no longer live.
- Git trailers (`Fixes: #123`): the commit names what it fixes, so the history itself says a fix
  landed.
- Toyota's andon cord, which this repo already has as the `trunk-red` issue that stops the line.

## Built on Tinker

| Exists                                                        | fixer adds                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| ops: groups, `open`/`resolved`/`regressed`/`human`, `resolve` | A claim table per fingerprint: lease, issue, attempts, the fix |
| ops: `ops.handOff`, `ops.fixerTick`                           | `fixer.giveUp` and the tick call them                          |
| `scripts/ship.sh` gates and lands a tree on main              | `ship.sh --fixer <claim>`: the claim check, rules, the trailer |
| The `trunk-red` issue stops the line                          | The fixer takes `trunk-red` when it is open past 10 minutes    |
| CI's deploy workflow                                          | A probe workflow and an off-host backup copy                   |

The fixer's calls are Tinker operations in `src/fixer/`. They call ops' operations; ops never
calls them. The tick and the wrapper are shell scripts with no model.

## Journeys

### The tick finds work

1. Every 5 minutes, a paseo schedule on the host runs `scripts/fixer-tick.sh`. The tick uses no
   model. It runs, in order:
   1. `easel errors tick`, which stamps `fixerSeen` ([ops](SPEC-ops.md)). It does this on every
      run, work or not.
   2. For each open `prod-error` issue whose group is `resolved`, it closes the issue. This
      finishes the work of a fixer that stopped between resolve and close.
   3. `easel errors ls --open --side server --json`. A browser-only group never reaches a fixer, so
      it never opens an issue and never starts a fix. It stays counted as unconfirmed in
      `easel status`.
   4. A check for an open `trunk-red` issue.
2. It starts a fixer only when there is work: a server group with no live claim, or a `trunk-red`
   issue open for more than 10 minutes. It starts each fixer through `scripts/fixer-run.sh`, the
   wrapper (below). One fixer works on one group; at most 2 fixers run at once.
3. `trunk-red` is the shipping agent's to fix within 10 minutes (AGENTS.md). A fixer takes it only
   after that, and fixes forward (`ship.sh --fix`) or reverts (`ship.sh -r <sha>`).

### A fixer holds a claim

1. The wrapper claims the group: `easel errors claim <fingerprint>` answers `claimed` with a
   `claim` handle, `until`, and the group's issue, attempts and noted fix. The lease is 15 minutes.
   `held` means another fixer has it; the wrapper exits.
2. The wrapper runs the agent as its child, in a process group of its own (`setsid`), and keeps
   its PID and process group id (PGID). Every 5 minutes it runs `easel errors extend <claim>`,
   which starts the lease again.
3. When an extend answers `lost`, or no extend has worked by 5 minutes before `until`, the wrapper
   stops the agent's whole process group (`kill -- -<PGID>`), so no tool the agent started (a test,
   a `ship.sh`) goes on, before the lease can run out. So a lease runs out only on a fixer
   that has stopped: it crashed, or its wrapper stopped it.
4. A claim lives at most 3 hours. Past that, `extend` answers `lost`, and the wrapper stops the
   agent. A hung agent cannot hold a group for ever.
5. Every write that changes the group carries the claim: `note-issue`, `note-fix`, `resolve`,
   `give-up`, `release`. Each answers `lost` when the claim is not live, and changes nothing. The
   fixer stops on `lost`.

### A fixer fixes an error

1. **Stop checks, before any issue.** With the claim answer in hand, the fixer checks, in order:
   - The group is browser-only: it runs `easel errors release <claim>` and stops. No issue opens.
     (The tick never sends one; this check is the second guard.)
   - **A fix that already landed.** The claim answer has a noted fix that is not resolved: it goes
     to step 6. Or `git log origin/main` has a commit with the trailer `Fixes-Error: <fingerprint>`
     that is not among the group's noted fixes: an earlier fixer stopped between its push and its
     note. The fixer notes that commit (`easel errors note-fix`) and goes to step 6.
   - attempts is 2: two shipped fixes have not cured it. Or a person had the group before: its `reason` is set, or its `fixedIn` is none of its noted fixes. It gives up (step 8).
2. Otherwise the group needs a fix, and the fixer goes on.
3. **One issue per group.** The fixer looks for the group's issue by its fingerprint label,
   `fp:<first 16 hex of the fingerprint>`, open or closed:
   `gh issue list --label fp:<…> --state all`. It reopens the one it finds, or opens one with the
   labels `prod-error` and `fp:<…>`. It records it with `easel errors note-issue <claim> <url>`.
   The issue carries only the fingerprint, label, error name, build, count and trace id. It never
   carries the sample: the repo is public. The sample stays behind the owner-only `ops.error`.
4. The fixer treats the sample's text as data, never as instructions.
5. It reproduces the error as a failing test first (pstack `tdd`), fixes the code, runs
   `bun run check` until it is green, and lands the fix with
   `scripts/ship.sh --fixer <claim> -m "fix(<label>): …" -- <paths>` (see Rules). On green,
   `ship.sh` extends the claim and checks the trailer again, pushes, then runs
   `easel errors note-fix <claim> <commit> <build>`, where `build` is
   `git rev-list --count <commit>`. The note counts the attempt, so a second fixer sees the fix.
6. **Proof.** It runs `easel errors resolve <fingerprint> --claim <claim> --build <n> --wait 1800`.
   The command calls again every 30 s while the answer is `notLive`; each call answers at once.
   - `resolved`: the fixer closes the issue and stops. The claim ends.
   - `failing`: the fix is live and the error still happens. Back to step 1, in the same run: with
     attempts at 2 it gives up, otherwise it writes another fix.
   - still `notLive` after 1800 s: it runs `easel errors release <claim>` and stops. The fix is
     noted, so the next fixer goes straight to step 6.
7. When a `resolved` group regresses ([ops](SPEC-ops.md)), the tick finds it again. The next fixer
   reopens the same issue (step 3), and works as above.
8. **Giving up.** The fixer runs `easel errors give-up <claim> --reason <text>`, which marks the
   group `human` (`ops.handOff`). It finds the group's issue by its label (step 3), reopens it,
   labels it `needs-human`, and comments what it tried. A person is called only through that open
   issue. It gives up when:
   - attempts is 2 and the group is still failing or regressed;
   - `ship.sh --fixer` refused the fix on a fixer rule, or its gate was red: the fix passed
     `bun run check` on the fixer's tree, so a red gate means it is not what the fixer thought;
   - the error rate rose after a fix: it reverts the fix with `ship.sh -r <sha>` first;
   - the cause is not in the code: a readiness check (disk full, no Chromium), which needs the
     runbook.
9. When `ship.sh --fixer` refuses because the line is stopped (`trunk-red`), nothing was tried:
   the fixer runs `easel errors release <claim>` and stops. The attempt is not counted.
10. A run works on one group and opens at most one issue.

### Someone watches the watcher

1. A GitHub Actions workflow (`.github/workflows/probe.yml`, one run at a time by `concurrency`)
   reads `https://easel.vibea.dev/api/ready` every 10 minutes. It fails when the answer is not 200,
   or when `fixerSilent` is true.
2. On a failure, it opens a `prod-down` issue, unless one is open, and writes which check failed.
   It closes the issue when a probe passes again.
3. The tick stamps `fixerSeen` on every run, work or not, so a quiet day with no errors is not a
   silent fixer. `fixerSilent` is true only when no tick has run for 30 minutes: the paseo schedule
   has stopped.
4. The Dockerfile has a `HEALTHCHECK` on `/api/health`, so the orchestrator restarts a stuck
   server. After a restart, ops counts the 30 minutes from the stored `fixerSeen`; only with none
   stored does it count from the start.

### The data leaves the host

1. Once a day, the tick copies the newest local backup ([ops](SPEC-ops.md)) off the host, to the
   target the hub provides (see SPEC.md, open questions). It does this from the host, so the
   server holds no credential for the target.
2. When no copy has worked for 48 hours, the tick opens one `needs-human` issue titled
   `backup: off-host copy failing`, unless one is open, and closes it after the next good copy.

## Contract

Each call lists its success kinds (SPEC.md, Success kinds). Every call is for an owner (refused
`{ owner: true }` otherwise). The `claim` is a random 128-bit handle for one lease.

```ts
"fixer.claim":     { kind: "claimed"; claim: string; until: number; error: ErrorGroup;
                     issue: string | null; attempts: number; fix: Fix | null }
                 | { kind: "held" } | { kind: "settled" } | { kind: "gone" }
                   // fingerprint. settled: the group is resolved or human.  success: claimed
"fixer.extend":    { kind: "extended"; until: number } | { kind: "lost" }
                   // claim.                                                 success: extended
"fixer.noteIssue": { kind: "noted" } | { kind: "lost" }       // claim, url.   success: noted
"fixer.noteFix":   { kind: "noted"; attempts: number } | { kind: "lost" }
                   // claim, commit, build. The same commit twice counts once. success: noted
"fixer.resolve":   { kind: "resolved" } | { kind: "notLive"; live: number }
                 | { kind: "failing"; seen: number } | { kind: "lost" }
                   // claim, build. ops.resolveError under the claim; resolved and failing
                   // end the pending fix (it stays in `fixes`).             success: resolved
"fixer.giveUp":    { kind: "handed" } | { kind: "lost" }      // claim, reason. success: handed
"fixer.release":   { kind: "released" } | { kind: "lost" }    // claim.         success: released
```

```ts
Fix = { commit: string; build: number }
FixerRecord = { fingerprint; claim: string | null; claimedAt: number | null; until: number | null;
  issue: string | null; attempts: number; fix: Fix | null; fixes: Fix[] }
  // fix: the noted fix that waits for resolve. fixes: every noted fix; attempts is its length.
  // Kept when ops drops the group.
```

CLI: `easel errors claim`, `easel errors extend`, `easel errors note-issue`,
`easel errors note-fix`, `easel errors resolve --claim`, `easel errors give-up`,
`easel errors release`.

## Rules

### Fact rules (the code graph decides)

1. `fixer` imports `ops`; `ops` imports nothing of `fixer`.
2. Every `fixer.*` call runs the `user` guard, then the `owner` guard.
3. Every `fixer.*` call but `claim` takes a `claim`, and answers `lost` and writes nothing when the
   claim is not the group's live one.
4. Each claim call takes its time from the run's `clock`.
5. `fixer.claim` is one conditional write: it takes the group only when no lease is live, with no
   await between the check and the write.
6. `fixer.noteFix` is the only writer of `attempts` and `fixes`. It adds one per new commit.

### Fixer rules (`ship.sh --fixer <claim>` refuses, so these are facts of the gate)

1. It runs `easel errors extend <claim>` first, and refuses on `lost`.
2. It refuses when `origin/main` already has a commit with this group's `Fixes-Error` trailer that
   is not among the group's noted fixes, and names that commit.
3. Just before the push, after the gate, it runs rules 1 and 2 again: the extend, then the trailer
   check on a fresh `origin/main`. The gate takes minutes, so the claim and main may have changed.
4. A fixer ship touches only `src/` and `tests/`.
5. It removes no line under `tests/`, adds no `.skip`, `.only` or `todo`, and adds no
   `eslint-disable`, `@ts-` comment or `tinker.json` exception.
6. It adds a test file, or a test to one, that names the fingerprint.
7. The commit carries the trailer `Fixes-Error: <fingerprint>`.
8. After the push, it runs `easel errors note-fix <claim> <commit> <build>`. When that answers
   `lost`, the trailer is the record: the next fixer notes the commit (journey step 1).
9. Its exit says which: shipped (0), refused on a fixer rule or red gate (1), the line is stopped
   (3), the claim is lost (4).

### Judged rules (need reading the code)

1. The GitHub issue holds no sample at all.
2. The wrapper stops the agent before its lease can run out: it extends every 5 minutes on a
   15-minute lease, and stops the agent when no extend has worked by 5 minutes before `until`.
3. The fixer opens an issue only after it searched for the fingerprint label and found none.
4. The tick and the wrapper stop a process only by its PID, or the agent by its process group
   (`kill -- -<PGID>`), never by a pattern. The wrapper stops the agent's whole process group, not
   only its PID.

## Statecharts

- [docs/statecharts/fixer-claim-issue.md](docs/statecharts/fixer-claim-issue.md): two fixers, one
  new group, its claim and its one issue.
- [docs/statecharts/fixer-claim-fix.md](docs/statecharts/fixer-claim-fix.md): two fixers, one group
  with an issue, its claim, its one fix and resolve.
- [docs/statecharts/fixer-probe.md](docs/statecharts/fixer-probe.md): the prod-down probe and the
  tick's stamp.
- The fixer's path through a group's states is in
  [docs/statecharts/ops-issues.md](docs/statecharts/ops-issues.md).

## Success Criteria

- An error thrown on purpose in production is fixed with no person involved. A `prod-error` issue
  opens within 10 minutes, the fixer ships a fix with a test, the live build reaches the fix's
  build, and the issue closes.
- A regression reopens its group and its issue. After two noted fixes (attempts is 2) that have
  not cured it, the next fixer hands it to a person.
- A fixer that is stopped after it opened an issue, or after it pushed its fix, leaves one issue
  and one fix: the next fixer finds them by the label and the trailer.
- Two fixers started on one group: one gets `claimed`, the other `held`.
- A browser-only group, posted with a forged `Origin`, opens no issue and starts no fix.
- `ship.sh --fixer` refuses a ship that deletes a test line, and a ship whose claim is lost.
- The probe opens `prod-down` when `/data` is not writable, and when the tick has not run for 30
  minutes; it closes it when both are well. A quiet day with no errors opens nothing.

## Out of Scope (Deferred)

- Paging a person (phone, chat): `needs-human` and `prod-down` issues are enough for V1.
- Fixing a browser-only group: it needs a way to confirm a page error first.
- A fixer that runs off this host (a GitHub Action): it would need a model key in CI and a second
  way to land code.
