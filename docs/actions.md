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

Thin wrappers around g-bot's `gha-*` binaries, prebuilt in `bin/<os>-<arch>/` (`linux-arm64` and `darwin-arm64`; `_bin/run.js` fails on any other runner). `main.js` and `post.js` only run `bin/<os>-<arch>/<binary> main|post` through `_bin/run.js`; the binary reads its settings from the env, and writes outputs, `PATH` and env through `$GITHUB_OUTPUT`, `$GITHUB_PATH` and `$GITHUB_ENV` itself.

| Action | Stands in for | Binary |
|---|---|---|
| `checkout` | `actions/checkout` | `gha-checkout` |
| `setup-go` | `actions/setup-go` | `gha-setup-go` |
| `setup-pulumi` | `pulumi/actions` (installing the CLI only) | `gha-setup-pulumi` |

Their settings, outputs and `post` steps are documented with the binaries, in the chaos repository's `docs/actions/`:

- `checkout`: `CHECKOUT_REPOSITORY` (required), `CHECKOUT_REF`, `CHECKOUT_PATH`, `CHECKOUT_SSH_KEY` (base64 of a 32-byte Ed25519 seed; make one with `bin/darwin-arm64/gha-ssh-keygen`), `CHECKOUT_DEPTH`. No outputs, and no logs but an error, since the repository may be a secret. `post` removes the key and the checkout.
- `setup-go`: `SETUP_GO_VERSION` (default `stable`). Outputs `go-version`, `goroot`; sets `GOPATH`, `GOCACHE`, `GOMODCACHE`, `GOTOOLCHAIN=local`. `post` removes the toolchain and every cache.
- `setup-pulumi`: `SETUP_PULUMI_VERSION` (default `latest`). Outputs `pulumi-version`; sets `PULUMI_HOME`, `PULUMI_SKIP_UPDATE_CHECK`. `post` removes the CLI, its plugins and `PULUMI_HOME`.

## build-chaos

Builds every binary of a chaos checkout for the runner's own platform -- `linux-arm64` on `ubuntu-*-arm`, `darwin-arm64` on an arm64 macOS runner; nothing is cross-compiled -- with the checkout's own `scripts/build.sh` (steps `go pack rust`, natively: see chaos's `docs/running.md`), and adds them to the chaos repository itself, on a branch named after the commit they were built from: `bin/<first 12 characters of the commit>`. The chaos repository is private, so the binaries are as private as its code, and nothing goes to the run's artifacts. Needs Go on `PATH` (`setup-go`), Rust, `make`, a C compiler, CMake, Ninja and clang (GitHub's runners have them), and the checkout made with a key that may push (`checkout` keeps it set up for git until its `post`).

| Env | Required | |
|---|---|---|
| `BUILD_CHAOS_SOURCE` | yes | The chaos checkout, relative to `$GITHUB_WORKSPACE`. |

Outputs: `branch`, the branch pushed; `commit`, the commit on it.

- `main`:
  - Clones r-share and c-share (public, `--depth 1`, their default branch) next to the checkout, and writes the checkout's `.cargo/config.toml` patching r-share to `../r-share`, as on a development machine: chaos's `Cargo.lock` is locked against that patch. Without `VCPKG_ROOT`, clones and bootstraps vcpkg into its work directory.
  - Runs `scripts/build.sh go pack rust` into `<target>/` of its work directory, laid out as an install prefix: `bin/` (`chaos`, the `gha-*` binaries, `mcp-gateway-service`, `mcp-gateway-stdio`, `collect_lambda_logs`), `libexec/chaos/` (`chaos-<name>.zst`, `zstd`) and `chaos.sha256`.
  - Fails before pushing if a file is over GitHub's 100 MiB file limit (the Go binaries are compressed, so none is so far).
  - Commits, as one commit with no parent (`chaos <source commit>`), its `<target>/` and whatever else `bin/<commit>` already holds (the other target, pushed by the other job of the same run), using a separate index and work tree, so the checkout itself is left as it was; then one atomic push, leased on what it read (`--force-with-lease`), that creates or replaces `bin/<commit>` and deletes every other `bin/*` branch. If the other job pushed in between, it starts over, up to five times. There is only ever one `bin/*` branch, holding one commit, so the binaries never pile up in the repository's history.
- `post`: removes the r-share and c-share clones and the work directory.

The `gha-*` binaries in this repository's `bin/` are not updated by it: copy them from the `bin/*` branch by hand (`<target>/bin/gha-*` into `bin/<target>/`).
