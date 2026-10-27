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

Builds `cmd/chaos` of a chaos checkout for the runner's platform and encrypts it right away, so only the encrypted file ever leaves the runner: a public repository's artifacts can be downloaded by anyone signed in to GitHub. Needs Go on `PATH` (`setup-go`) and `gpg` (already on GitHub's Ubuntu runners).

| Env | Required | |
|---|---|---|
| `BUILD_CHAOS_SOURCE` | yes | The chaos checkout, relative to `$GITHUB_WORKSPACE`. |
| `BUILD_CHAOS_PASSPHRASE` | yes | The passphrase to encrypt with, from a secret: long and random, e.g. `openssl rand -base64 32`. |

Output `path`: the encrypted file, `chaos-<os>-<arch>.tar.gz.gpg`.

- `main`: `go build` (`CGO_ENABLED=0`, `-trimpath`, `-ldflags=-s -w`), `tar -cz` (an artifact's zip would drop the executable bit), then `gpg --symmetric` (AES-256, SHA-512 S2K at the maximum count, with gpg's integrity check, so a tampered file or a wrong passphrase fails loudly). The passphrase goes in on stdin, never on the command line. The binary and the tarball are deleted before the step ends.
- `post`: removes the work directory, the encrypted file included.

To decrypt: `gpg -d chaos-<os>-<arch>.tar.gz.gpg | tar -xz`.
