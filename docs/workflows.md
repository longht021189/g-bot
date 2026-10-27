# Workflows

Both are run by hand (`workflow_dispatch`), on `ubuntu-26.04-arm`, each in its own environment holding its secrets.

## Build Chaos (`chaos.yml`)

Builds chaos and uploads it, encrypted, as one artifact per target, each kept for a day. A matrix builds both on the same arm64 runner, cross-compiling:

| Target | For | Artifact |
|---|---|---|
| `linux/arm64` | the VM and the runners | `chaos-linux-arm64` |
| `darwin/arm64` | an Apple Silicon Mac | `chaos-darwin-arm64` |

1. `checkout` the chaos repository into `source`.
2. `setup-go` (`stable`).
3. `build-chaos` for the matrix's target: build, tar, gpg.
4. `actions/upload-artifact@v7` of the encrypted file.

Environment `chaos`:

| Secret | |
|---|---|
| `CHECKOUT_REPOSITORY` | The chaos repository's SSH URL. |
| `CHECKOUT_SSH_KEY` | The base64 private key whose public key is a deploy key there. |
| `CHAOS_ARTIFACT_PASSPHRASE` | The passphrase the artifact is encrypted with. |

To use the artifact:

```sh
unzip chaos-darwin-arm64.zip                     # GitHub zips every artifact
gpg -d chaos-darwin-arm64.tar.gz.gpg | tar -xz   # gpg: brew install gnupg
./chaos --help
```

Go signs a darwin/arm64 binary (ad hoc) as it links it, even cross-compiling, which is all an Apple Silicon Mac requires to run it. Unpacked from the terminal as above, it carries no quarantine flag; if one ever does (`xattr -l chaos` shows `com.apple.quarantine`), `xattr -d com.apple.quarantine chaos` clears it.

## Build and Deploy MCP Service (`mcp.yml`)

So far only checks out its source and sets up Go and Pulumi, showing what they set up: the start of building and deploying the MCP service.

Environment `mcp`: `CHECKOUT_REPOSITORY` and `CHECKOUT_SSH_KEY`, as above.

## On a public repository

Every run's logs can be read by anyone, and its artifacts downloaded by anyone signed in to GitHub; neither can be restricted. Secrets are masked in logs, `checkout` logs nothing, and `build-chaos` only lets the encrypted file out.
