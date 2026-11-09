# Xiaohe OCR

## 0.1.0 — 2026-10-27

- Added bounded, app-owned image recognition with bundled Android Chinese ML Kit and iOS Vision adapters.
- Return original-file SHA-256, ordered text lines, normalized positions and native confidence when available.
- Preserve Android ML Kit reflection registrars in release builds and check the actual R8 output.
- Android offline printed/blank image checks are recorded in the app's OCR validation document; iOS native compilation and runtime validation remain pending.

Scaffolded from the Expo SDK 58 local module template; retained template license applies alongside the third-party terms documented in README.md.
