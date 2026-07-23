# ProjMan2 field app — dev Makefile
# Run from this dir:  cd ~/Documents/Dev/Projman2/app && make run-dev
#
# The phone can't reach `localhost` — it must hit the Mac's LAN IP. LAN_IP is
# auto-detected; override any of these on the command line:
#   make run-dev DEVICE=<udid>
#   make run-dev LAN_IP=10.1.1.20
#   make run-dev API_BASE_URL=http://10.1.1.20:4100/api/v1

# ── Devices (from `flutter devices`) ─────────────────────────────────────────
IPHONE_XS   = 00008020-00166CC42E6A002E
IPHONE_NEW  = 00008101-00111C191146001E   # "vphan" (wireless)
IPHONE_PROX = 00008020-0005642E1198003A   # (wireless)
IPAD        = 7f0447624251c8af3ca9080641c3fe43ab7d1ff8
DEVICE     ?= $(IPHONE_XS)

# ── Server endpoint ──────────────────────────────────────────────────────────
# LAN_IP: this Mac on the wifi/ethernet the phone shares. API_BASE_URL is derived
# from it but can be overridden wholesale.
LAN_IP       ?= $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
API_PORT     ?= 4100
API_BASE_URL ?= http://$(LAN_IP):$(API_PORT)/api/v1

DART_DEFINES = --dart-define=API_BASE_URL=$(API_BASE_URL)

.DEFAULT_GOAL := help

# ── Run ──────────────────────────────────────────────────────────────────────
.PHONY: run-dev
run-dev: ## Build + run on DEVICE (default iPhone XS) against the LAN server
	@echo "▶ $(DEVICE)  →  $(API_BASE_URL)"
	flutter run -d $(DEVICE) $(DART_DEFINES)

.PHONY: run-phone
run-phone: DEVICE = $(IPHONE_NEW)   ## Run on the "vphan" phone (wireless)
run-phone: run-dev

.PHONY: run-ipad
run-ipad: DEVICE = $(IPAD)          ## Run on the iPad (wireless)
run-ipad: run-dev

.PHONY: run-mac
run-mac: ## Run on macOS desktop (uses localhost, not the LAN IP)
	flutter run -d macos --dart-define=API_BASE_URL=http://localhost:$(API_PORT)/api/v1

# ── Android ──────────────────────────────────────────────────────────────────
# ProjMan2 is SINGLE-VARIANT — unlike ftpos (maoi/banoi) there are no android
# productFlavors, so NO `--flavor` and NO icon regen. `run-dev` already works for
# a physical Android phone (just pass its DEVICE=). The one real iOS-vs-Android
# difference: a physical device uses the LAN IP, but an Android EMULATOR reaches
# this Mac's server via the special 10.0.2.2 alias, not the LAN IP.
.PHONY: run-android
run-android: ## Run on a physical Android device — pass DEVICE=<android-udid>
	flutter run -d $(DEVICE) $(DART_DEFINES)

.PHONY: run-android-emu
run-android-emu: ## Run on an Android emulator (host server via 10.0.2.2)
	flutter run --dart-define=API_BASE_URL=http://10.0.2.2:$(API_PORT)/api/v1

# ── Install-only (avoids the CONFIGURATION_BUILD_DIR debug-attach hang) ───────
.PHONY: install-dev
install-dev: ## Build with the LAN endpoint + install to DEVICE, no debug session — then tap the app
	flutter build ios --debug $(DART_DEFINES)
	flutter install -d $(DEVICE)
	@echo "✅ Installed. Unlock the phone, trust the profile if asked, tap ProjMan2."

# ── Housekeeping ─────────────────────────────────────────────────────────────
.PHONY: devices
devices: ## List connected devices + their UDIDs
	flutter devices

.PHONY: analyze
analyze: ## Static analysis (must be clean before a run)
	flutter analyze

.PHONY: pods
pods: ## Reinstall iOS CocoaPods
	cd ios && pod install

.PHONY: clean
clean: ## flutter clean + pub get
	flutter clean && flutter pub get

.PHONY: config
config: ## Print the resolved device + endpoint this Makefile will use
	@echo "DEVICE       = $(DEVICE)"
	@echo "LAN_IP       = $(LAN_IP)"
	@echo "API_BASE_URL = $(API_BASE_URL)"

.PHONY: help
help: ## Show this help
	@echo "ProjMan2 app — make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Override: make run-dev DEVICE=<udid> | LAN_IP=10.1.1.20 | API_BASE_URL=<url>"
