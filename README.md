# SynVolt

SynVolt is a Windows desktop interface for Synapse Z, built with Tauri, React and TypeScript. Synapse Z and a valid license are required; SynVolt does not replace them.

## Development

Install Node.js, Rust, and the Windows prerequisites for Tauri. Run `npm ci` and then `npm run tauri dev`.

The original Synapse Z installer is not included. To build the current installer integration, supply your own authorized `src-tauri/resources/SynInstallerV2.exe`. The bundled Luau language server is also excluded; provide the Windows x64 binary at `src-tauri/binaries/luau-lsp-x86_64-pc-windows-msvc.exe`. Review the applicable third-party licenses before redistributing either file.

The optional ScriptBlox and RScripts proxy projects are included in `synvolt-scriptblox` and `synz-rscripts`. The RScripts API key belongs in a server-side secret, never in this repository. Proxy and updater endpoints in the app configuration point to the current maintainer's services and may need to be configured for your deployment.

## Feedback

SynVolt is still new and may contain bugs. Report issues on GitHub or DM `doozyed_d` on Discord.
