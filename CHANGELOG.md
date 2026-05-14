# Changelog

## [1.6.0](https://github.com/mcKanses/missbetty/compare/v1.5.2...v1.6.0) (2026-05-13)

### Bug Fixes

* Checkbox prompt for multiple missing hosts entries ([#75](https://github.com/mcKanses/missbetty/issues/75)) ([f67f3d2](https://github.com/mcKanses/missbetty/commit/f67f3d25272cadb98fa785e0f365c64c6ac024aa))
* domain conflict detection in betty dev + fail-fast in betty link ([#67](https://github.com/mcKanses/missbetty/issues/67)) ([97cb564](https://github.com/mcKanses/missbetty/commit/97cb564706f4c784f64dbeb02ac3e045cf4e515b))
* Fix README version and update-readme-version workflow ([07b344f](https://github.com/mcKanses/missbetty/commit/07b344f19028473e69fd35a28dc21b1de98aadc6))
* Reliable hosts file management on Windows without repeated UAC prompts ([#71](https://github.com/mcKanses/missbetty/issues/71)) ([c111894](https://github.com/mcKanses/missbetty/commit/c11189412c1fd893b67e422d32861da18d99de3f))
* Show project name and correct protocol in betty status ([#74](https://github.com/mcKanses/missbetty/issues/74)) ([94301a7](https://github.com/mcKanses/missbetty/commit/94301a77fa70453189d6c74bb0e7526b5d589620))
* Windows hosts + multi-domain support for betty dev ([#72](https://github.com/mcKanses/missbetty/issues/72)) ([40a7fc1](https://github.com/mcKanses/missbetty/commit/40a7fc1013817c5032e51acc6233bb37e4f26cb5))

### Features

* betty project command, confirmation prompts & UX improvements ([#76](https://github.com/mcKanses/missbetty/issues/76)) ([6bfcd71](https://github.com/mcKanses/missbetty/commit/6bfcd7166c4df3dfbef52325cd515fa88fe64ae6))
* betty project command, HTTPS workflow, UX improvements & coverage ([528a181](https://github.com/mcKanses/missbetty/commit/528a181dde1cffbda6ad45a4f4997a4bf546f7c5))
* Rename project config file to .betty.yml ([09d097b](https://github.com/mcKanses/missbetty/commit/09d097b1229c24391987c783233605e598815d29))

## [1.5.1](https://github.com/mcKanses/missbetty/compare/v1.5.0...v1.5.1) (2026-05-09)

### Bug Fixes

* Disable release metadata commit hooks ([#57](https://github.com/mcKanses/missbetty/issues/57)) ([f9036e0](https://github.com/mcKanses/missbetty/commit/f9036e07a9b7ae781f175dc30bb3f243ec89f01e))

## [1.5.0](https://github.com/mcKanses/missbetty/compare/v1.4.0...v1.5.0) (2026-05-09)

### Bug Fixes

* align fix/euid-install-sh with development (pipe-compatible root check, CI test) ([441ecb0](https://github.com/mcKanses/missbetty/commit/441ecb007b9f0161b74181a36c28c598958d94ae))
* **ci:** resolve merge conflict and test both install.sh variants ([cc5bbb1](https://github.com/mcKanses/missbetty/commit/cc5bbb14863cce3c93d7d53d3367b87718a38376))
* **ci:** run install.sh with sudo in direct test job ([ea33b6a](https://github.com/mcKanses/missbetty/commit/ea33b6a765a98592f081d01f56436d27b317b9bb))
* Create release metadata pull request ([4821802](https://github.com/mcKanses/missbetty/commit/4821802dd1c541c1513be409527c8ffbe5908739))
* Disable Husky during release commit ([f269df5](https://github.com/mcKanses/missbetty/commit/f269df546228cc9e9638d09afd2c1ced430cf277))

### Features

* Add project dev orchestrator ([a753002](https://github.com/mcKanses/missbetty/commit/a75300230fe9acf681dbc677ba496fa4c047933c))

## [1.1.3](https://github.com/mcKanses/missbetty/compare/v1.1.2...v1.1.3) (2026-05-03)

### Bug Fixes

* synchronize package metadata version after v1.1.2 tag sequence
* harden Windows installer Docker daemon readiness checks and avoid false install failures

## [1.1.0](https://github.com/mcKanses/missbetty/compare/v1.0.1...v1.1.0) (2026-05-03)

### Bug Fixes

* Use absolute GitHub URL for logo in README so it renders on npm ([38ac9b2](https://github.com/mcKanses/missbetty/commit/38ac9b2ee7605a90fee15bcd7a8fd88e3f1b718f))

### Features

* add doctor/setup commands and safe mkcert fallback ([7104d5d](https://github.com/mcKanses/missbetty/commit/7104d5d2dbcc2f3970ef0fd9544a34d116034490))
* add linux arm64 prebuilt release support ([9680e83](https://github.com/mcKanses/missbetty/commit/9680e834c9569b8feedd7d148aca0ebf7a5ea750))
* add no-node binary installation flow ([9181c2b](https://github.com/mcKanses/missbetty/commit/9181c2b48913ef506963a35098e293265015a71f))
* Animate logo with 5 independent cable segments matching SVG structure ([e11e1d6](https://github.com/mcKanses/missbetty/commit/e11e1d667b6bc527c213578c76bf3db42acfc6e6))
* auto-install mkcert in setup workflow ([f770d3d](https://github.com/mcKanses/missbetty/commit/f770d3d47c944b5cbd50b55ca1c0c2f673371394))
* harden binary releases and add uninstall scripts ([a32a27f](https://github.com/mcKanses/missbetty/commit/a32a27ff01b038cfa1a2b90e9a3c354e45597c99))

## 1.0.0 (2026-05-03)

### Bug Fixes

* Add shared TypeScript interfaces for Docker and Traefik types ([1ba5dec](https://github.com/mcKanses/getbetty.dev/commit/1ba5dec643406e0e63f988617ad87b47d6811b49))
* Correct CLI help output and logo rendering ([4775ae2](https://github.com/mcKanses/getbetty.dev/commit/4775ae28ccba159b974c65d8ccfd4ebfd0849115))
* Prevent domain collisions in link and relink ([ad710ff](https://github.com/mcKanses/getbetty.dev/commit/ad710ff1c08e1355999afa316d862c8888e70674))
* Replace destructive Set-Content rewrite with safe AppendAllText in hosts UAC script ([6026798](https://github.com/mcKanses/getbetty.dev/commit/6026798b9434cefbf989040094dc6a7a49f5b620))
* Resolve all ESLint strict TypeScript errors across CLI source files ([03e46a4](https://github.com/mcKanses/getbetty.dev/commit/03e46a4d65ce4327c30a2c03745b874b0bdc1327))
* Restore automatic hosts cleanup on unlink ([ec3fd3c](https://github.com/mcKanses/getbetty.dev/commit/ec3fd3c40ea58ab20aac0a575ad020885eab1893))

### Features

* Add --all flag to unlink for bulk removal ([26a6a58](https://github.com/mcKanses/getbetty.dev/commit/26a6a5803ee133be723ca761a0e99a01a44a0b87))
* Add --open flag to open browser after betty link ([862832b](https://github.com/mcKanses/getbetty.dev/commit/862832ba9b95dc8c7b319fde39176e2dcf851c76))
* Add Betty logo asset set ([8ef2ccf](https://github.com/mcKanses/getbetty.dev/commit/8ef2ccf72e7cdbda11e9970dba1e32b2a0a8aed8))
* Add colored error output helpers ([e1cb4ee](https://github.com/mcKanses/getbetty.dev/commit/e1cb4ee33ab4a055de4314fa0eec78e892ff9deb))
* Add concise operation summaries for routing commands ([3528eca](https://github.com/mcKanses/getbetty.dev/commit/3528ecaa00feac6c9f420086512c70c0877a9ab6))
* Add config list command to show current settings ([00afacb](https://github.com/mcKanses/getbetty.dev/commit/00afacba8e1b7f4813b045e73be9194b3a1f6d03))
* Add configurable domain suffix support ([14f4599](https://github.com/mcKanses/getbetty.dev/commit/14f45996de57dea188d903846fb86c494ea89841))
* Add dry-run preview for link command ([65feee6](https://github.com/mcKanses/getbetty.dev/commit/65feee6ea62c145a7661fdf5b738777b7d04be06))
* Add initial devcontainer config ([ed9a931](https://github.com/mcKanses/getbetty.dev/commit/ed9a9311655a43957a7c881fedb45be97e6caa69))
* Build betty as platform binary with ncc + SEA ([eccc2cd](https://github.com/mcKanses/getbetty.dev/commit/eccc2cdc72e7d3278ac78366fd32f286bb887363))
* Improve command line onboarding ([db8998f](https://github.com/mcKanses/getbetty.dev/commit/db8998f70f1e44bd810a56eef6548cd7504be8fa))
* Introduce switchboard command workflow ([57e9fc4](https://github.com/mcKanses/getbetty.dev/commit/57e9fc43ca5659b536fee5af5b6c11ff0481d3f1))
* Prepare devcontainer ([a9809b3](https://github.com/mcKanses/getbetty.dev/commit/a9809b3c11fca7afecb71342dafe32fc0b0e68ac))
* Read version dynamically from package.json ([f496007](https://github.com/mcKanses/getbetty.dev/commit/f4960071a1b20f0ea5cc0ee1cbf60cff9963b0c4))
* Register --all option for unlink in CLI and tests ([b787da3](https://github.com/mcKanses/getbetty.dev/commit/b787da32885c9bbe735401818f342bc260c28496))
* Skip route selection for single link ([3fa01ca](https://github.com/mcKanses/getbetty.dev/commit/3fa01ca4ac5d1b243c9143b66c4bca2d1f927261))
* Suggest compose subdomains with .dev default ([e71aed4](https://github.com/mcKanses/getbetty.dev/commit/e71aed436620762b8d9fba3faf538411d4c23bd4))
* Suggest domain from container name in link prompt ([d10acb7](https://github.com/mcKanses/getbetty.dev/commit/d10acb7fb8baf6e33310cccf8ba323368fbefcf3))
* Suggest exposed container ports during link ([81ab384](https://github.com/mcKanses/getbetty.dev/commit/81ab384dda69088d8f773fb4e3f728c13fe53650))
* Update and extend logo asset set ([ae36177](https://github.com/mcKanses/getbetty.dev/commit/ae36177634afc166d4352a3a7d2c406e6ab2ebcd))
* Use colored error output across commands ([5e75a4a](https://github.com/mcKanses/getbetty.dev/commit/5e75a4a0409104acb417eeb8fddf63e9c1e8e4c6))
