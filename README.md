# g-bot

The `main` branch holds g-bot's GitHub Actions: the actions other workflows use, the workflows themselves, and the prebuilt binaries the actions run. g-bot's own code lives on `dev`; the `gha-*` binaries' code lives in the chaos repository (`cmd/gha-*`).

| Path | What |
|---|---|
| `.github/actions/` | `checkout`, `setup-go`, `setup-pulumi`, `build-chaos`: see [docs/actions.md](docs/actions.md). |
| `.github/workflows/` | `chaos.yml`, `mcp.yml`: see [docs/workflows.md](docs/workflows.md). |
| `bin/linux-arm64/` | The `gha-*` binaries the actions run, built from the chaos repository. |
| `bin/darwin-arm64/` | `gha-ssh-keygen`, a local tool making `checkout`'s SSH key. |
