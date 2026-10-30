# g-bot

The `main` branch holds g-bot's GitHub Actions: the actions other workflows use, the workflows themselves, and the prebuilt binaries the actions run. g-bot's code (`mcp-gateway-service`, `mcp-gateway-stdio`, `collect_lambda_logs`) and the `gha-*` binaries' live in the chaos repository, in `cmd/`.

| Path | What |
|---|---|
| `.github/actions/` | `checkout`, `setup-go`, `setup-pulumi`, `build-chaos`: see [docs/actions.md](docs/actions.md). |
| `.github/workflows/` | `chaos.yml`, `mcp.yml`: see [docs/workflows.md](docs/workflows.md). |
| `bin/linux-arm64/` | The `gha-*` binaries the actions run, built from the chaos repository. |
| `bin/darwin-arm64/` | The same for macOS runners (`chaos.yml`'s macOS job), and `gha-ssh-keygen`, a local tool making `checkout`'s SSH key. |
