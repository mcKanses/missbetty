## [1.10.1](https://github.com/mcKanses/missbetty/compare/v1.10.0...v1.10.1) (2026-10-10)


### Bug Fixes

* Harden betty update and the daily update check ([cb58b73](https://github.com/mcKanses/missbetty/commit/cb58b730154dc6483571b64c066715ba065829a8))
* Use the platform's path rules for the binary name in betty update ([2c4cd5f](https://github.com/mcKanses/missbetty/commit/2c4cd5fbf57df187ebbe4ed38bd7fc6253ab8c98))

# [1.10.0](https://github.com/mcKanses/missbetty/compare/v1.9.1...v1.10.0) (2026-10-10)


### Bug Fixes

* Show uptime, health and restarts for database domains in status ([d58fc14](https://github.com/mcKanses/missbetty/commit/d58fc14bc61e2acfb4767f7bd30edfe1386f2750))


### Features

* Add betty update to install the latest release ([bbefbad](https://github.com/mcKanses/missbetty/commit/bbefbad86ec09f1853d40ca877dc3f5bc7013aa0))
* Offer new releases once a day after a command ([7160c39](https://github.com/mcKanses/missbetty/commit/7160c39d7df2648e4ed2fce5a399089693c3b4a6))

## [1.9.1](https://github.com/mcKanses/missbetty/compare/v1.9.0...v1.9.1) (2026-10-09)


### Bug Fixes

* Accept the domain as argument in betty unlink and sync the docs ([585be1d](https://github.com/mcKanses/missbetty/commit/585be1d59ac38939ed6e15209a99bc89a68ed17a))
* Detect a running Docker daemon in the Windows installer ([c0bc285](https://github.com/mcKanses/missbetty/commit/c0bc285c20c4c42bd315f2d7e0455acc1f47c675))
* Harden the lock, hosts edits and link against partial failures ([42dbb14](https://github.com/mcKanses/missbetty/commit/42dbb1460519b62cc2e7df5f9378458460be972c))
* Keep relink from overwriting project routes and database domains ([138b246](https://github.com/mcKanses/missbetty/commit/138b246a5d05687f22804cad55b0b06cf5c6dd06))
* Tighten release workflow permissions and publishing ([376d1c5](https://github.com/mcKanses/missbetty/commit/376d1c554e494327c0338dcf381eba7ea1827c2e))

# [1.9.0](https://github.com/mcKanses/missbetty/compare/v1.8.0...v1.9.0) (2026-10-09)


### Features

* Route PostgreSQL connections by domain ([39b4ae2](https://github.com/mcKanses/missbetty/commit/39b4ae278fd3426e161638d6876c6e9196b13a5e)), closes [#143](https://github.com/mcKanses/missbetty/issues/143)

# [1.8.0](https://github.com/mcKanses/missbetty/compare/v1.7.5...v1.8.0) (2026-10-08)


### Features

* Verify the release signature in the installers when cosign is available ([9a54124](https://github.com/mcKanses/missbetty/commit/9a541247d26b64242643b0fdaf6a116c9c328219))

## [1.7.5](https://github.com/mcKanses/missbetty/compare/v1.7.4...v1.7.5) (2026-10-08)


### Bug Fixes

* Install on Intel Macs and run Homebrew as the invoking user ([d022660](https://github.com/mcKanses/missbetty/commit/d022660a6939772937e9b611d79817002e900c90))
* Let install.ps1 run without Administrator rights ([7c6ce90](https://github.com/mcKanses/missbetty/commit/7c6ce90b7901566041805d5c9b8a174b8f0a7c72))

## [1.7.4](https://github.com/mcKanses/missbetty/compare/v1.7.3...v1.7.4) (2026-09-28)


### Bug Fixes

* Always confirm the mkcert CA is trusted and keep underscores in cert names ([f10e3a5](https://github.com/mcKanses/missbetty/commit/f10e3a563bb99e8cdf51c1334ebe1dd9f6307796)), closes [#173](https://github.com/mcKanses/missbetty/issues/173)
* Edit hosts entries in one batched step, elevating with domain names only ([a1670fd](https://github.com/mcKanses/missbetty/commit/a1670fdf03a984ec465ea711ec2680db1be903dd))
* Keep betty link from overwriting a same-named project route file ([235aa6b](https://github.com/mcKanses/missbetty/commit/235aa6bd1c27909d376afe8e5ab7a8e1dff50928))
* Report unexpected errors cleanly and tell lock I/O errors from a busy lock ([ee0bc26](https://github.com/mcKanses/missbetty/commit/ee0bc26c3c0a09f9fc06e5acbb802345ca5d2766))

## [1.7.3](https://github.com/mcKanses/missbetty/compare/v1.7.2...v1.7.3) (2026-09-28)


### Bug Fixes

* Create the proxy network before betty link starts the proxy ([cd09953](https://github.com/mcKanses/missbetty/commit/cd09953a84a19dee3b5b0aea66bccab81b59090e))
* Explain that project domains have no container when relinking ([d16a44c](https://github.com/mcKanses/missbetty/commit/d16a44cb43fa7d6708c07e548d784c3b59af2227))
* Inspect only containers when resolving a link target ([234293e](https://github.com/mcKanses/missbetty/commit/234293e825de5ea767b78f750912cc69dc9d3c29))
* Keep project origin metadata and guard project stop and link files ([b196889](https://github.com/mcKanses/missbetty/commit/b196889c73722f108c374c035f020de95a89d9bf))
* Keep the hosts file's line endings and stop adding blank lines ([42463f7](https://github.com/mcKanses/missbetty/commit/42463f74658894b853a1658c417eab9ba71f59b7))
* Write the Windows hosts file from an elevated shell instead of widening its ACL ([ca18334](https://github.com/mcKanses/missbetty/commit/ca18334d9e1d1ff77e641de86d183caa8523ec78))

## [1.7.2](https://github.com/mcKanses/missbetty/compare/v1.7.1...v1.7.2) (2026-09-27)


### Bug Fixes

* Clean up after Ctrl+C in project load and guard same-named projects ([0d3b964](https://github.com/mcKanses/missbetty/commit/0d3b964cbd7a18d82dc5cb3968f37c8cf644e54b))
* Honor unlink --all --yes, ignore commented hosts lines, map [::1] ([7f47a42](https://github.com/mcKanses/missbetty/commit/7f47a42e215e51004f5aca0a2bb9232ba8b118ae))
* Identify relink routes by file and router, not by file alone ([9c4eb9b](https://github.com/mcKanses/missbetty/commit/9c4eb9bb5cd26444240e2728a48dedfeea02353b))
* Keep the other project domains when relinking one of them ([fc36d7d](https://github.com/mcKanses/missbetty/commit/fc36d7dc135b736950e40ce4c694ddeb1dd6da79))
* Match hosts entries to remove only in the active part of the line ([06786ca](https://github.com/mcKanses/missbetty/commit/06786ca28e03f258f96197150c4cf2797a2fd06d))
* Prepare the certs directory and check conflicts before side effects ([1ab8151](https://github.com/mcKanses/missbetty/commit/1ab8151ac86e9635c9e690f5b2b2572b35ebdd0a))
* Reject invalid ports and sanitize the project unlink name ([026750a](https://github.com/mcKanses/missbetty/commit/026750a31848827d8a808d4bdd83fba3be7f705f))
* Respect the auto-approve answer when project create starts the project ([d0850b7](https://github.com/mcKanses/missbetty/commit/d0850b7c84e786994b8838f1987f99f9fce1639d))
* Tie the command lock to its owner's PID ([589be4a](https://github.com/mcKanses/missbetty/commit/589be4a4c9a922254570b58098c758d77e81aa52))

## [1.7.1](https://github.com/mcKanses/missbetty/compare/v1.7.0...v1.7.1) (2026-09-26)


### Bug Fixes

* Await async command actions so BettyError reaches the central handler ([34e5575](https://github.com/mcKanses/missbetty/commit/34e5575b340dab3adf67cb5ff89b51e87d391eaf))
* Drop the www prefix from the LinkedIn link ([7543c14](https://github.com/mcKanses/missbetty/commit/7543c14de3edb55dab0fde1eff08151a0c94f51e))
* Exclude the generated CHANGELOG.md from markdown lint ([4640314](https://github.com/mcKanses/missbetty/commit/4640314be48d1bc3d6ec34d4f38183e01e2ffe4c))
* Fail relink on an unknown target instead of opening the picker ([9bce6da](https://github.com/mcKanses/missbetty/commit/9bce6dac1afb0e58fd76fe04847a7edfc31fc520))
* Hold the lock only while project load changes routes ([b7ae472](https://github.com/mcKanses/missbetty/commit/b7ae472eb8ab89b42a195d99e836c23b4673bca5))
* Keep accepting underscores in domains ([68f9213](https://github.com/mcKanses/missbetty/commit/68f9213fc2dcf9de926f4e00d1a8caf59a6e4878)), closes [#141](https://github.com/mcKanses/missbetty/issues/141)
* Link only running containers and route to their canonical name ([6d099c8](https://github.com/mcKanses/missbetty/commit/6d099c8f96b8fd002d2ef105ee8ea7130ea5836a)), closes [#139](https://github.com/mcKanses/missbetty/issues/139)
* Point the LinkedIn link at the current profile URL ([e932e75](https://github.com/mcKanses/missbetty/commit/e932e7595dce0fe14e12837b2e4c210e9a21456c))
* Remove the old hosts entry when relink changes the domain ([c5f9c04](https://github.com/mcKanses/missbetty/commit/c5f9c04ccd21c2dc2518e6b15ca0bfe9eb6d3ad6))
* Route to the container by name so an IP change needs no relink ([ac9be29](https://github.com/mcKanses/missbetty/commit/ac9be29aeef3d9465b396821be35b183d3b78fa8))
* Show the configured proxy ports in URLs and messages ([7e36e0e](https://github.com/mcKanses/missbetty/commit/7e36e0ee330e8865a90f80ee80d5252502036ba2))
* Validate domains and keep hosts entries out of the shell ([2aae0a4](https://github.com/mcKanses/missbetty/commit/2aae0a4847eed345844e5eca56f1d75c4a458b50))

# [1.7.0](https://github.com/mcKanses/missbetty/compare/v1.6.1...v1.7.0) (2026-06-28)


### Bug Fixes

* Address code review findings across routing, hosts and CI ([b71b747](https://github.com/mcKanses/missbetty/commit/b71b7474e9f06add0b819250ed73ccf43db6f346))
* Detect domain conflicts on the normalized route name ([a3a5e08](https://github.com/mcKanses/missbetty/commit/a3a5e08b8653d2404a85741a1e77ecf56d302ed8))


### Features

* Add a file lock for Betty's shared state ([6521f54](https://github.com/mcKanses/missbetty/commit/6521f5488bdd6ed5ffed9a3a37e3c4c95fac2057))
* Lock the route-mutating commands against concurrent runs ([c589414](https://github.com/mcKanses/missbetty/commit/c589414b04916eb8ac50994c11d59bb11238535f))
* Make the proxy HTTP/HTTPS host ports configurable ([5e8b8fb](https://github.com/mcKanses/missbetty/commit/5e8b8fb13e20926013ad20157953ae5dcb5aa90a))
* Prune the link state store on unlink ([37e90cd](https://github.com/mcKanses/missbetty/commit/37e90cd0a8275e7e77927a459d17a350f518442e))
* Support httpPort and httpsPort in the config command ([f810cf6](https://github.com/mcKanses/missbetty/commit/f810cf6c2dce708a52b2e0be0c06b6076a2d7bed))
* Track route containers in a links.json state store ([9e44446](https://github.com/mcKanses/missbetty/commit/9e4444689a462fc1393aa671127aa30fe9fb2670))
* Write the Windows hosts file directly under WSL ([da3030e](https://github.com/mcKanses/missbetty/commit/da3030e0e62f98a20dc53621a8d38f373f274bf6))

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
