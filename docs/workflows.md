# Workflows

Both are run by hand (`workflow_dispatch`), on `ubuntu-26.04-arm`, each in its own environment holding its secrets.

## Build Chaos (`chaos.yml`)

Builds chaos and pushes it to the chaos repository's `bin/<commit>` branch (see `build-chaos` in [actions.md](actions.md)), replacing the one before. One job, cross-compiling both targets; runs never overlap (`concurrency`), since each deletes the branch the one before pushed.

| File | For |
|---|---|
| `chaos-linux-arm64` | the VM and the runners |
| `chaos-darwin-arm64` | an Apple Silicon Mac |

1. `checkout` the chaos repository into `source`.
2. `setup-go` (`stable`).
3. `build-chaos`: build both, push.

Environment `chaos`:

| Secret | |
|---|---|
| `CHECKOUT_REPOSITORY` | The chaos repository's SSH URL. |
| `CHECKOUT_SSH_KEY` | The base64 private key whose public key is a deploy key there, with write access. |

That key may push any branch, so the chaos repository needs a ruleset on its default branch (restrict updates and deletions, block force pushes) that deploy keys cannot bypass; `bin/*` is left open to it.

To get the binary:

```sh
repo=git@github.com:longht021189/chaos.git
branch=$(git ls-remote --heads "$repo" 'bin/*' | cut -f2)
git clone -q --depth 1 --branch "${branch#refs/heads/}" "$repo" chaos-bin
cp chaos-bin/chaos-darwin-arm64 ./chaos && rm -rf chaos-bin
./chaos --help
```

`git log -1 --format=%s` on the branch reads `chaos <source commit>`, the full commit it was built from.

Go signs a darwin/arm64 binary (ad hoc) as it links it, even cross-compiling, which is all an Apple Silicon Mac requires to run it. Fetched with git, it carries no quarantine flag; if one ever does (`xattr -l chaos` shows `com.apple.quarantine`), `xattr -d com.apple.quarantine chaos` clears it.

## Build and Deploy MCP Service (`mcp.yml`)

So far only checks out its source and sets up Go and Pulumi, showing what they set up: the start of building and deploying the MCP service.

Environment `mcp`: `CHECKOUT_REPOSITORY` and `CHECKOUT_SSH_KEY`, as above.

## On a public repository

Every run's logs can be read by anyone, and its artifacts downloaded by anyone signed in to GitHub; neither can be restricted. Secrets are masked in logs, `checkout` logs nothing, and `build-chaos` uploads no artifact: the binaries go to the private chaos repository.
