# Vendored dependencies

## cubiomes

- Source: https://github.com/Cubitect/cubiomes
- Commit: e61f90580cbdd883214a8054670dacae655e59c0
- License: MIT (see cubiomes/LICENSE) — copyright notice must be retained in
  all distributions, including the compiled WASM artifact we ship.
- Policy: wrap, never modify, never reimplement world generation. Update only
  by re-vendoring a newer pinned commit and re-running the determinism test.
