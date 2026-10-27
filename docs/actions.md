# Actions

Every action here is a JavaScript action (`node24`) with a `post` step, which GitHub runs automatically once the job's steps are done -- a composite action cannot have one. None declares `inputs`: settings come from the step's own `env:`.

```yaml
- uses: longht021189/g-bot/.github/actions/checkout@main
  env:
    CHECKOUT_REPOSITORY: git@github.com:owner/repo.git
    CHECKOUT_SSH_KEY: ${{ secrets.CHECKOUT_SSH_KEY }}
```

They are referenced as `longht021189/g-bot/...@main` rather than `./.github/actions/...`, since the repository is not checked out when the first of them (`checkout` itself) runs; GitHub downloads the whole repository at that ref for them, `bin/` included.

Everything an action sets up lives under `$RUNNER_TEMP/g-bot-actions/<name>/`, and its `post` step always removes it: there is no option to keep anything.

## checkout, setup-go, setup-pulumi

Thin wrappers around g-bot's `gha-*` binaries, prebuilt in `bin/<os>-<arch>/` (only `linux-arm64` so far, so the jobs run on `ubuntu-*-arm`). `main.js` and `post.js` only run `bin/<os>-<arch>/<binary> main|post` through `_bin/run.js`; the binary reads its settings from the env, and writes outputs, `PATH` and env through `$GITHUB_OUTPUT`, `$GITHUB_PATH` and `$GITHUB_ENV` itself.

| Action | Stands in for | Binary |
|---|---|---|
| `checkout` | `actions/checkout` | `gha-checkout` |
| `setup-go` | `actions/setup-go` | `gha-setup-go` |
| `setup-pulumi` | `pulumi/actions` (installing the CLI only) | `gha-setup-pulumi` |

Their settings, outputs and `post` steps are documented with the binaries, in g-bot's `docs/` on the `dev` branch:

- `checkout`: `CHECKOUT_REPOSITORY` (required), `CHECKOUT_REF`, `CHECKOUT_PATH`, `CHECKOUT_SSH_KEY` (base64 of a 32-byte Ed25519 seed; make one with `bin/darwin-arm64/gha-ssh-keygen`), `CHECKOUT_DEPTH`. No outputs, and no logs but an error, since the repository may be a secret. `post` removes the key and the checkout.
- `setup-go`: `SETUP_GO_VERSION` (default `stable`). Outputs `go-version`, `goroot`; sets `GOPATH`, `GOCACHE`, `GOMODCACHE`, `GOTOOLCHAIN=local`. `post` removes the toolchain and every cache.
- `setup-pulumi`: `SETUP_PULUMI_VERSION` (default `latest`). Outputs `pulumi-version`; sets `PULUMI_HOME`, `PULUMI_SKIP_UPDATE_CHECK`. `post` removes the CLI, its plugins and `PULUMI_HOME`.

## build-chaos

Builds `cmd/chaos` of a chaos checkout for each target -- chaos is pure Go (`CGO_ENABLED=0`), so one runner cross-compiles them all -- and pushes the binaries to the chaos repository itself, on a branch named after the commit they were built from: `bin/<first 12 characters of the commit>`. The chaos repository is private, so the binaries are as private as its code, and nothing goes to the run's artifacts. Needs Go on `PATH` (`setup-go`), and the checkout made with a key that may push (`checkout` keeps it set up for git until its `post`).

| Env | Required | |
|---|---|---|
| `BUILD_CHAOS_SOURCE` | yes | The chaos checkout, relative to `$GITHUB_WORKSPACE`. |
| `BUILD_CHAOS_TARGETS` | no | The targets, `<goos>/<goarch>` separated by spaces; default `linux/arm64 darwin/arm64`. |

Outputs: `branch`, the branch pushed; `commit`, the commit on it.

- `main`: `go build` (`CGO_ENABLED=0`, `-trimpath`, `-ldflags=-s -w`) each target into `chaos-<goos>-<goarch>`; commits them, executable, as one commit with no parent (`chaos <source commit>`), using a separate index and work tree, so the checkout itself is left as it was; then one atomic push that creates (or, rebuilding the same commit, replaces) `bin/<commit>` and deletes every other `bin/*` branch. There is only ever one `bin/*` branch, holding one commit, so the binaries never pile up in the repository's history.
- `post`: removes the work directory.
