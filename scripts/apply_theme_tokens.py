#!/usr/bin/env python3
"""Mechanical color-literal -> CSS var(--token) substitution pass.

Excludes files that are already theme-aware by other means, or that are
explicitly out of scope for this feature (door capacity kiosks).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")

EXCLUDE_DIRS = {
    os.path.join(APP_DIR, "capacity"),  # kiosk screens - explicitly out of scope
}
EXCLUDE_FILES = {
    os.path.join(APP_DIR, "bananas", "calendar", "CalendarClient.js"),   # already theme-aware
    os.path.join(APP_DIR, "bananas", "calendar", "TeamEventModal.js"),   # already theme-aware
    os.path.join(APP_DIR, "components", "CosmosBackground.js"),          # handled manually
}

with open(os.path.join(ROOT, "scripts", "token_map.json")) as f:
    TOKEN_MAP = json.load(f)

HEX_TO_VAR = TOKEN_MAP["hex_to_var"]
ALPHA_TO_VAR = TOKEN_MAP["alpha_to_var"]

# Property keys treated as "foreground-ish" for rgba(255,255,255,X) purposes.
FG_PROPS = {"color", "borderColor", "border", "boxShadow", "stroke", "fill", "stopColor"}
BG_PROPS = {"background", "backgroundColor"}
ALL_PROPS = FG_PROPS | BG_PROPS

# Matches: <prop>: '<anything-not-quote>rgba(255,255,255,ALPHA)<anything-not-quote>'
RGBA_WHITE_RE = re.compile(
    r"(?P<prop>" + "|".join(ALL_PROPS) + r")(?P<sep>\s*:\s*)(?P<q>['\"`])"
    r"(?P<pre>[^'\"`]*?)rgba\(\s*255,\s*255,\s*255,\s*(?P<alpha>[0-9.]+)\s*\)(?P<post>[^'\"`]*?)"
    r"(?P=q)"
)


def rgba_white_sub(m):
    prop = m.group("prop")
    alpha = m.group("alpha")
    # normalize alpha string to match token_map keys (e.g. "0.10" -> "0.1")
    alpha_key = alpha
    if alpha_key not in ALPHA_TO_VAR:
        # try stripping trailing zeros
        try:
            alpha_key = str(float(alpha))
            if alpha_key.endswith(".0"):
                alpha_key = alpha_key[:-2]
        except ValueError:
            alpha_key = alpha
    if alpha_key not in ALPHA_TO_VAR:
        return m.group(0)  # unknown alpha, leave untouched (shouldn't happen)

    var_name = ALPHA_TO_VAR[alpha_key]
    if prop in BG_PROPS and float(alpha) >= 0.5:
        return m.group(0)  # opaque button/pill surface - leave unchanged in both themes

    replacement = f"var(--{var_name})"
    return f"{m.group('prop')}{m.group('sep')}{m.group('q')}{m.group('pre')}{replacement}{m.group('post')}{m.group('q')}"


def build_hex_regex():
    # Longest-first so e.g. "#ffb84d" doesn't get pre-empted by a shorter key.
    keys = sorted(HEX_TO_VAR.keys(), key=len, reverse=True)
    escaped = [re.escape(k) for k in keys]
    pattern = "(" + "|".join(escaped) + r")(?![0-9a-fA-F])"
    return re.compile(pattern, re.IGNORECASE)


HEX_RE = build_hex_regex()


def hex_sub(m):
    hex_val = m.group(1).lower()
    var_name = HEX_TO_VAR.get(hex_val)
    if not var_name:
        return m.group(0)
    return f"var(--{var_name})"


def should_process(path):
    if path in EXCLUDE_FILES:
        return False
    for d in EXCLUDE_DIRS:
        if path.startswith(d + os.sep):
            return False
    return True


def process_file(path):
    with open(path, "r") as f:
        content = f.read()
    original = content

    content = RGBA_WHITE_RE.sub(rgba_white_sub, content)
    content = HEX_RE.sub(hex_sub, content)

    if content != original:
        with open(path, "w") as f:
            f.write(content)
        return True
    return False


def main():
    changed = []
    for dirpath, dirnames, filenames in os.walk(APP_DIR):
        # prune excluded dirs from walk
        dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d) not in EXCLUDE_DIRS]
        for fn in filenames:
            if not fn.endswith(".js"):
                continue
            full = os.path.join(dirpath, fn)
            if not should_process(full):
                continue
            if process_file(full):
                changed.append(os.path.relpath(full, ROOT))

    print(f"Modified {len(changed)} files:")
    for c in sorted(changed):
        print(" ", c)


if __name__ == "__main__":
    main()
