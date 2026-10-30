# Workflows

Both are run by hand (`workflow_dispatch`), `mcp.yml` on `ubuntu-26.04-arm`, `chaos.yml` on one runner per platform (below), each in its own environment holding its secrets.

## Build Chaos (`chaos.yml`)

Builds every chaos binary for both platforms and pushes them to the chaos repository's `bin/<commit>` branch (see `build-chaos` in [actions.md](actions.md)), replacing the one before. One job per platform, each building natively on its own runner, both adding to the same branch: `ubuntu-24.04-arm` for `linux-arm64/`, `macos-latest` (arm64) for `darwin-arm64/`. Runs never overlap (`concurrency`), since each deletes the branch the one before pushed.

| Directory | For |
|---|---|
| `linux-arm64/` | the VM and the runners |
| `darwin-arm64/` | an Apple Silicon Mac |

Each is an install prefix: `bin/` (`chaos`, the `gha-*` binaries, `mcp-gateway-service`, `mcp-gateway-stdio`, `collect_lambda_logs`), `libexec/chaos/` (the Go binaries compressed, and `zstd`), `chaos.sha256`.

Each job:

1. `checkout` the chaos repository into `source`.
2. `setup-go` (`stable`).
3. `build-chaos`: build, push.

The macOS job runs this repository's actions on macOS, so `bin/darwin-arm64/` needs `gha-checkout` and `gha-setup-go` (copy them from `darwin-arm64/bin/` of a `bin/*` branch, or build them on a Mac).

Environment `chaos`:

| Secret | |
|---|---|
| `CHECKOUT_REPOSITORY` | The chaos repository's SSH URL. |
| `CHECKOUT_SSH_KEY` | The base64 private key whose public key is a deploy key there, with write access. |

That key may push any branch, so the chaos repository needs a ruleset on its default branch (restrict updates and deletions, block force pushes) that deploy keys cannot bypass; `bin/*` is left open to it.

r-share and c-share are cloned from GitHub at their default branch: push them before running it, or it builds against what GitHub has.

To get the binaries:

```sh
repo=git@github.com:longht021189/chaos.git
branch=$(git ls-remote --heads "$repo" 'bin/*' | cut -f2)
git clone -q --depth 1 --branch "${branch#refs/heads/}" "$repo" chaos-bin
chaos-bin/darwin-arm64/bin/chaos --help
```

`chaos` runs its binaries from `../libexec/chaos/` next to it, checked against the manifest built into it: keep the prefix as it is (move or copy `darwin-arm64/` whole), with no group or other write. `git log -1 --format=%s` on the branch reads `chaos <source commit>`, the full commit it was built from.

Built on macOS, every binary is signed (ad hoc) as it is linked, which is all an Apple Silicon Mac requires to run it. Fetched with git, they carry no quarantine flag; if one ever does (`xattr -l <file>` shows `com.apple.quarantine`), `xattr -d com.apple.quarantine <file>` clears it.

`linux-arm64/` is built on Ubuntu 24.04, the VM's release (Oracle has no Ubuntu 26.04 image yet): the Rust binaries need the glibc they were built against or newer, so they run there and on newer Ubuntu runners alike.

## Build and Deploy MCP Service (`mcp.yml`)

So far only checks out its source and sets up Go and Pulumi, showing what they set up: the start of building and deploying the MCP service.

Environment `mcp`: `CHECKOUT_REPOSITORY` and `CHECKOUT_SSH_KEY`, as above.

## On a public repository

Every run's logs can be read by anyone, and its artifacts downloaded by anyone signed in to GitHub; neither can be restricted. Secrets are masked in logs, `checkout` logs nothing, and `build-chaos` uploads no artifact: the binaries go to the private chaos repository.
