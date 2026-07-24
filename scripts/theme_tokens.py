# Single source of truth for the site-wide light/dark theme token system.
# Run: python3 scripts/theme_tokens.py
# It (1) prints/writes the CSS var block to inject into app/globals.css,
# and (2) writes token_map.json used by apply_theme_tokens.py for the
# mechanical color -> var(--token) substitution pass.

import json

# ---- Neutral text tiers (color: usage) ----
TEXT_TOKENS = {
    "text-1": {"dark": "#f5f5f5", "light": "#18140f",
               "members": ["#f5f5f5", "#f0f0f0", "#e5e5e5", "#e8e8e8", "#f5f5f0"]},
    "text-2": {"dark": "#c8c8c8", "light": "#3d372f",
               "members": ["#c8c8c8", "#c0c0c0", "#cfcfcf", "#d0d0d0", "#d4d4d4", "#c7c4bc"]},
    "text-3": {"dark": "#8a8a8a", "light": "#655e53",
               "members": ["#8a8a8a", "#a0a0a0", "#a8a8a8", "#aaa", "#aaaaaa", "#9a9a9a", "#999"]},
    "text-4": {"dark": "#6a6a6a", "light": "#7d7669",
               "members": ["#555", "#666", "#6a6a6a", "#6b7280", "#777", "#5c5c63", "#888"]},
}

# ---- Neutral surface tiers (background:/backgroundColor: usage) ----
SURFACE_TOKENS = {
    "surface-1": {"dark": "#141414", "light": "#ffffff", "members": ["#141414"]},
    "surface-2": {"dark": "#0f0f0f", "light": "#faf8f4",
                  "members": ["#0f0f0f", "#101010", "#111", "#0e0e0e"]},
    "surface-3": {"dark": "#0d0d0d", "light": "#f5f2ec", "members": ["#0d0d0d"]},
    "surface-4": {"dark": "#1a1a1a", "light": "#efece3",
                  "members": ["#1a1a1a", "#1a1a1d", "#141418", "#161616"]},
    "surface-5": {"dark": "#2a2a2a", "light": "#e2ddd1",
                  "members": ["#2a2a2a", "#333", "#333333", "#3a3a3a", "#3a3a40", "#444"]},
}

# ---- Status / accent colors (mostly color:, some background:) ----
# One CSS var PER distinct source hex, so dark-mode rendering is pixel-identical
# to today (no consolidation), light value chosen for contrast on white/cream.
STATUS_TOKENS = {
    # greens (success)
    "st-4ade80": {"dark": "#4ade80", "light": "#15803d"},
    "st-86efac": {"dark": "#86efac", "light": "#16a34a"},
    "st-7cfc9b": {"dark": "#7CFC9B", "light": "#178a4c"},
    "st-80c878": {"dark": "#80c878", "light": "#1f7a42"},
    "st-22c55e": {"dark": "#22c55e", "light": "#16803d"},
    "st-10b981": {"dark": "#10b981", "light": "#0e7a52"},
    "st-34d399": {"dark": "#34d399", "light": "#0f9d6c"},
    "st-6ee7b7": {"dark": "#6ee7b7", "light": "#12946b"},
    "st-bbeeaa": {"dark": "#bea", "light": "#15803d"},
    # reds (danger)
    "st-fca5a5": {"dark": "#fca5a5", "light": "#b91c1c"},
    "st-f87171": {"dark": "#f87171", "light": "#b91c1c"},
    "st-ef4444": {"dark": "#ef4444", "light": "#b91c1c"},
    "st-ff8a8a": {"dark": "#ff8a8a", "light": "#c0392b"},
    "st-ff8080": {"dark": "#ff8080", "light": "#c0392b"},
    "st-c53030": {"dark": "#c53030", "light": "#b91c1c"},
    # ambers / oranges (warning + brand accent)
    "st-ffb84d": {"dark": "#ffb84d", "light": "#8a5109"},
    "st-f59e0b": {"dark": "#f59e0b", "light": "#92400e"},
    "st-fbbf24": {"dark": "#fbbf24", "light": "#92400e"},
    "st-f97316": {"dark": "#f97316", "light": "#9a3412"},
    "st-fde68a": {"dark": "#fde68a", "light": "#854d0e"},
    "st-ffd599": {"dark": "#ffd599", "light": "#7c3d0a"},
    # dark amber/red/green/pink TINTED backgrounds -> pale tinted bg in light
    "st-tint-amber-1": {"dark": "#1f1410", "light": "#fbf1de"},
    "st-tint-amber-2": {"dark": "#1f1c14", "light": "#fbf1de"},
    "st-tint-amber-3": {"dark": "#16140d", "light": "#fbf1de"},
    "st-tint-amber-4": {"dark": "#2a1f05", "light": "#fbf1de"},
    "st-tint-amber-5": {"dark": "#2a1d05", "light": "#fbf1de"},
    "st-tint-amber-6": {"dark": "#1a1400", "light": "#fdf6dc"},
    "st-tint-amber-7": {"dark": "#5a3d00", "light": "#fef3d9"},
    "st-tint-green-1": {"dark": "#0f1a12", "light": "#eaf7ee"},
    "st-tint-pink-1": {"dark": "#1a0f16", "light": "#fdeef5"},
    "st-tint-red-1": {"dark": "#3a1414", "light": "#fdecec"},
    "st-tint-red-2": {"dark": "#2a0a0a", "light": "#fce4e4"},
    # purples
    "st-c084fc": {"dark": "#c084fc", "light": "#7c3aed"},
    "st-8b5cf6": {"dark": "#8b5cf6", "light": "#6d28d9"},
    "st-a78bfa": {"dark": "#a78bfa", "light": "#7c3aed"},
    "st-c4b5fd": {"dark": "#c4b5fd", "light": "#6d28d9"},
    # pinks
    "st-f472b6": {"dark": "#f472b6", "light": "#be185d"},
    "st-ec4899": {"dark": "#ec4899", "light": "#9d174d"},
    # blues
    "st-60a5fa": {"dark": "#60a5fa", "light": "#1d4ed8"},
    "st-3b82f6": {"dark": "#3b82f6", "light": "#1e40af"},
}

# Distinct alpha values found in rgba(255,255,255, A) usage across the codebase.
ALPHAS = ["0.025", "0.03", "0.04", "0.05", "0.06", "0.07", "0.08", "0.1", "0.12",
          "0.15", "0.2", "0.25", "0.3", "0.35", "0.4", "0.45", "0.5", "0.55",
          "0.6", "0.62", "0.7", "0.78", "0.85", "0.92", "0.95"]


def alpha_token_name(a: str) -> str:
    return "fg-a" + a.replace("0.", "").replace(".", "")


def build_css() -> str:
    lines = []
    lines.append("/* ============================================================")
    lines.append("   THEME TOKENS (site-wide light/dark)")
    lines.append("   data-theme=\"dark\" (default) / data-theme=\"light\" on <html>")
    lines.append("   ============================================================ */")
    lines.append(":root {")
    lines.append("  /* base surfaces (existing) */")
    lines.append("  --bg-dark: #0a0a0a;   /* starfield backdrop - stays dark in both themes */")
    lines.append("  --bg-card: #141414;")
    lines.append("  --text-light: #f5f5f5;")
    lines.append("  --text-muted: #8a8a8a;")
    lines.append("  --border-subtle: rgba(255, 255, 255, 0.06);")
    lines.append("")
    lines.append("  /* semantic aliases used by new components */")
    lines.append("  --text-primary: var(--text-light);")
    lines.append("  --text-secondary: #c8c8c8;")
    lines.append("  --bg-elevated: #1a1a1a;")
    lines.append("")
    lines.append("  /* neutral text tiers */")
    for name, t in TEXT_TOKENS.items():
        lines.append(f"  --{name}: {t['dark']};")
    lines.append("")
    lines.append("  /* neutral surface tiers */")
    for name, t in SURFACE_TOKENS.items():
        lines.append(f"  --{name}: {t['dark']};")
    lines.append("")
    lines.append("  /* status / accent colors (dark-mode = original literal value) */")
    for name, t in STATUS_TOKENS.items():
        lines.append(f"  --{name}: {t['dark']};")
    lines.append("")
    lines.append("  /* translucent white -> flips to translucent near-black in light mode */")
    for a in ALPHAS:
        lines.append(f"  --{alpha_token_name(a)}: rgba(255, 255, 255, {a});")
    lines.append("}")
    lines.append("")
    lines.append('[data-theme="light"] {')
    lines.append("  --text-primary: var(--text-1);")
    lines.append("  --text-secondary: var(--text-2);")
    lines.append("  --bg-card: var(--surface-1);")
    lines.append("  --bg-elevated: var(--surface-4);")
    lines.append("  --border-subtle: rgba(10, 10, 10, 0.08);")
    lines.append("")
    for name, t in TEXT_TOKENS.items():
        lines.append(f"  --{name}: {t['light']};")
    for name, t in SURFACE_TOKENS.items():
        lines.append(f"  --{name}: {t['light']};")
    for name, t in STATUS_TOKENS.items():
        lines.append(f"  --{name}: {t['light']};")
    for a in ALPHAS:
        lines.append(f"  --{alpha_token_name(a)}: rgba(10, 10, 10, {a});")
    lines.append("}")
    return "\n".join(lines) + "\n"


def build_token_map():
    """hex-literal -> css var name, for the mechanical substitution script."""
    hex_to_var = {}
    for name, t in list(TEXT_TOKENS.items()) + [(k, v) for k, v in SURFACE_TOKENS.items()]:
        pass
    for name, t in TEXT_TOKENS.items():
        for m in t["members"]:
            hex_to_var[m.lower()] = name
    for name, t in SURFACE_TOKENS.items():
        for m in t["members"]:
            hex_to_var[m.lower()] = name
    for name, t in STATUS_TOKENS.items():
        hex_to_var[t["dark"].lower()] = name
    alpha_map = {a: alpha_token_name(a) for a in ALPHAS}
    return {"hex_to_var": hex_to_var, "alpha_to_var": alpha_map}


if __name__ == "__main__":
    css = build_css()
    with open("scripts/_generated_theme_vars.css", "w") as f:
        f.write(css)
    tm = build_token_map()
    with open("scripts/token_map.json", "w") as f:
        json.dump(tm, f, indent=2)
    print(f"Wrote scripts/_generated_theme_vars.css ({len(css.splitlines())} lines)")
    print(f"Wrote scripts/token_map.json ({len(tm['hex_to_var'])} hex entries, {len(tm['alpha_to_var'])} alpha entries)")
