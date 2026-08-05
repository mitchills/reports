# Without .PHONY, `make build` sees the build/ DIRECTORY, decides the target is
# already up to date, and silently does nothing — so `make encrypt` re-encrypts
# stale pages and the change you just made never reaches the client.
.PHONY: build encrypt encrypt-show preview scaffold

# CLIENT=<slug> limits build+encrypt to ONE client. Updating a single client's
# numbers used to rebuild and re-encrypt all ~30 (slow, and two people publishing
# at once would clobber each other's docs/). Both scripts already took a single
# client — only the Makefile didn't pass it through.
#
#   make encrypt CLIENT=gladesville   # one client
#   make encrypt                      # all of them (release / shell change)
#
# ⛔ Use the full rebuild after ANY change to src/*/index.html or docs/assets/*,
# since those are shared and a single-client build leaves the other 29 stale.

build:
	python3 scripts/build.py $(CLIENT)

encrypt: build
	python3 scripts/encrypt/encrypt_public.py $(if $(CLIENT),--client $(CLIENT))

encrypt-show:
	python3 scripts/encrypt/encrypt_public.py --show

preview:
	python3 -m http.server 8765 --directory docs

scaffold:
	python3 scripts/scaffold.py
