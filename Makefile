# Without .PHONY, `make build` sees the build/ DIRECTORY, decides the target is
# already up to date, and silently does nothing — so `make encrypt` re-encrypts
# stale pages and the change you just made never reaches the client.
.PHONY: build encrypt encrypt-show preview scaffold

build:
	python3 scripts/build.py

encrypt: build
	python3 scripts/encrypt/encrypt_public.py

encrypt-show:
	python3 scripts/encrypt/encrypt_public.py --show

preview:
	python3 -m http.server 8765 --directory docs

scaffold:
	python3 scripts/scaffold.py
