## Standalone SEA Binary (Experimental)

The devcontainer CLI can be built as a single self-contained executable using Node.js SEA (Single Executable Applications). This binary embeds:

- The compiled CLI JavaScript bundle
- The `node-pty` native addon (extracted to a temporary directory at runtime)

### Usage

Download the platform/arch specific binary (naming: `devcontainer.<platform>-<arch>`) and place it on your PATH. Example:

```
chmod +x devcontainer.linux-x64
./devcontainer.linux-x64 --version
```

### Current Status

| Aspect | Status |
| ------ | ------ |
| Supported OS | Linux (initial) |
| Architectures | x64 (arm64 planned) |
| Feature Parity | Near-complete; interactive TTY via embedded `node-pty` |
| Updates | Manual download (no auto-update yet) |

### Runtime Extraction

The embedded `node-pty` binary is written to a temporary directory and a transient `node_modules` path is injected into the module resolution paths. No persistent files are written.

### Integrity / Licensing

The binary includes all runtime dependencies already listed in the project’s ThirdPartyNotices. Verify integrity with a checksum:

```
shasum -a 256 devcontainer.linux-x64
```

### Building Locally

You need Node.js 20+. Then run:

```
yarn
yarn build:sea
dist/sea/devcontainer.linux-x64 --help
```

### Limitations & Future Work

- Additional platforms (macOS, Windows) & arm64 builds
- Automated release artifact generation
- Size optimizations (stripping, optional compression)
