# Local BizOS runtime — Agency and E-commerce

This folder contains the source closure of the local sidecar used by the LeadFactory-enabled BizOS build. It includes no cloud model credentials or private cloud engine. The cockpit, skills and notes are copied from this repository when building; the runtime is AGPL-3.0-only, with Apache-2.0 attributions preserved in NOTICE and licenses/. Both business kits retain their MIT licences.

## Build and test

Use Node.js 22 or newer. Electron is a compile-time type dependency here; this command skips its binary download:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build
npm test
```

The desktop shell is distributed with the corresponding sources alongside the application release. See [the BizOS guide](../../../docs/BIZOS.md). Starting this sidecar alone does not provide the desktop chat interface.

A model and external accounts are supplied by the user. Inference through a personal remote provider is not offline inference. Profiles and client databases must never be added to this repository.

## Source scope and repeatable assets

`source-manifest.json` identifies the 77 source files copied from the local
sidecar source closure, including type-only dependencies. No legacy Electron
application entrypoint or private cloud engine is included. Electron is needed
only to resolve the existing computer-host types; its binary is not used by
this runtime.

Build this folder inside the full kit checkout: `kit:sync` reads the repository
root three levels above. It copies only the public cockpit, template, skills,
notes and MIT notices into ignored generated folders. The source archive needs
these sibling files; this folder alone is not a standalone kit distribution.

The generated kit manifest hashes every copied file. Its `syncedAt` uses
`SOURCE_DATE_EPOCH` (Unix seconds; default `0`) so repeated builds of the same
inputs do not drift with wall-clock time. `sourceCommit` is provenance metadata
when Git metadata exists, or `null` in a source archive; compare file hashes
when verifying archive and checkout builds.

`npm test` runs isolated template installation and binding, permissions, shared cockpits and
real-sidecar-process tests, with temporary profiles and scripted model drivers.
Build first so the sidecar-process test is exercised. These tests do not call a
paid model, test real user credentials or validate a signed desktop installer.
