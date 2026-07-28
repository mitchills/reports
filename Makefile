build:
	python3 scripts/build.py

encrypt: build
	python3 scripts/encrypt/encrypt_public.py

encrypt-show:
	python3 scripts/encrypt/encrypt_public.py --show

preview:
	python3 -m http.server 8765 --directory docs
