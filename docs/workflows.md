# Workflows

Both are run by hand (`workflow_dispatch`), on `ubuntu-26.04-arm`, each in its own environment holding its secrets.

## Build Chaos (`chaos.yml`)

Builds chaos for linux/arm64 and uploads it, encrypted, as the run's artifact `chaos-linux-arm64`, kept for a day.

1. `checkout` the chaos repository into `source`.
2. `setup-go` (`stable`).
3. `build-chaos`: build, tar, gpg.
4. `actions/upload-artifact@v7` of the encrypted file.

Environment `chaos`:

| Secret | |
|---|---|
| `CHECKOUT_REPOSITORY` | The chaos repository's SSH URL. |
| `CHECKOUT_SSH_KEY` | The base64 private key whose public key is a deploy key there. |
| `CHAOS_ARTIFACT_PASSPHRASE` | The passphrase the artifact is encrypted with. |

To use the artifact:

```sh
unzip chaos-linux-arm64.zip                     # GitHub zips every artifact
gpg -d chaos-linux-arm64.tar.gz.gpg | tar -xz   # gpg: brew install gnupg
```

## Build and Deploy MCP Service (`mcp.yml`)

So far only checks out its source and sets up Go and Pulumi, showing what they set up: the start of building and deploying the MCP service.

Environment `mcp`: `CHECKOUT_REPOSITORY` and `CHECKOUT_SSH_KEY`, as above.

## On a public repository

Every run's logs can be read by anyone, and its artifacts downloaded by anyone signed in to GitHub; neither can be restricted. Secrets are masked in logs, `checkout` logs nothing, and `build-chaos` only lets the encrypted file out.
