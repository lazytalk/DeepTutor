#!/usr/bin/env python3
"""Re-apply the Kaiwen brand layer on top of a (possibly fresh upstream) tree.

Idempotent: run it after every upstream merge. Locale/persona conflicts are
resolved by taking upstream's version and re-running this script; structural
edits below are skipped when already present and warned about when neither
the old nor the new form matches (upstream refactored the spot — port by hand).

Usage: python scripts/apply_rebrand.py [--check]
  --check  report what would change without writing (exit 1 if any).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = "Kaiwen Crane Tutor"
LOGO_ALT = "Kaiwen Education"

# (relative path, old, new) — structural brand edits, applied verbatim.
STRUCTURAL = [
    ("web/app/layout.tsx", 'title: "DeepTutor",', f'title: "{BRAND}",'),
    ("web/app/(auth)/login/page.tsx", "\n          DeepTutor\n", f"\n          {BRAND}\n"),
    ("web/app/(auth)/register/page.tsx", "\n          DeepTutor\n", f"\n          {BRAND}\n"),
    ("web/features/chat/components/ChatWorkspace.tsx",
     '                      src="/brand/black-logo.png"\n'
     '                      alt="DeepTutor"\n'
     '                      width={40}\n'
     '                      height={40}\n'
     '                      className="h-10 w-10 select-none dark:invert"\n',
     '                      src="/brand/kaiwen-animated.webp"\n'
     f'                      alt="{LOGO_ALT}"\n'
     '                      width={395}\n'
     '                      height={336}\n'
     '                      className="h-10 w-auto select-none"\n'),
    ("web/components/chat/home/SessionLoadingView.tsx",
     '          src="/brand/black-logo.png"\n'
     '          alt="DeepTutor"\n'
     '          width={32}\n'
     '          height={32}\n'
     '          className="h-8 w-8 select-none dark:invert"\n',
     '          src="/brand/kaiwen-animated.webp"\n'
     f'          alt="{LOGO_ALT}"\n'
     '          width={395}\n'
     '          height={336}\n'
     '          className="h-9 w-auto select-none"\n'),
    ("web/components/layout/AppShell.tsx",
     '                src="/brand/color-word.png"\n'
     '                alt="DeepTutor"\n'
     '                width={1200}\n'
     '                height={310}\n',
     '                src="/brand/color-word.png"\n'
     f'                alt="{LOGO_ALT}"\n'
     '                width={1200}\n'
     '                height={116}\n'),
    ("web/components/sidebar/SidebarShell.tsx",
     '              src="/brand/color-word.png"\n'
     '              alt="DeepTutor"\n'
     '              width={1200}\n'
     '              height={310}\n'
     '              priority\n'
     '              className="h-[22px] w-auto',
     '              src="/brand/color-word.png"\n'
     f'              alt="{LOGO_ALT}"\n'
     '              width={1200}\n'
     '              height={116}\n'
     '              priority\n'
     '              className="h-[14px] w-auto'),
    ("web/components/sidebar/SidebarShell.tsx",
     'aria-label="DeepTutor" className="dt-rail-brand"',
     f'aria-label="{BRAND}" className="dt-rail-brand"'),
    ("apps/desktop/src/index.html", "<title>Open DeepTutor</title>", f"<title>{BRAND}</title>"),
    ("apps/desktop/src/index.html", 'alt="">Open DeepTutor</span>', f'alt="">{BRAND}</span>'),
    ("apps/desktop/src/index.html",
     '<img class="mark" src="../assets/mark.png" alt="">',
     '<img class="mark" src="../assets/kaiwen-animated.webp" alt="">'),
    ("apps/desktop/src/index.html", 'alt="DeepTutor"', f'alt="{LOGO_ALT}"'),
    ("apps/desktop/src/shell.css", ".mark { width: 56px; height: 56px;", ".mark { width: auto; height: 56px;"),
    ("apps/desktop/src/main.mjs", "app.setName('Open DeepTutor');", f"app.setName('{BRAND}');"),
    ("apps/desktop/src/main.mjs", "{ label: 'Open DeepTutor',", "{ label: '" + BRAND + "',"),
    ("apps/desktop/src/main.mjs", "title: 'Open DeepTutor',", "title: '" + BRAND + "',"),
    ("apps/desktop/src/main.mjs", "dialog.showErrorBox('Open DeepTutor',", "dialog.showErrorBox('" + BRAND + "',"),
    ("apps/desktop/src/platform.mjs", "'Open DeepTutor for ", "'" + BRAND + " for "),
]


# Whole-file token renames (display content only; keys/URLs/identifiers are
# lowercase or structural and unaffected by the case-sensitive token).
TOKEN_FILES = [
    ("web/app/(workspace)/co-writer/sampleTemplate.ts", True),
    ("web/app/(utility)/avatar-preview/page.tsx", False),
]


def _rename_str(value: str) -> str:
    """Rename the brand token but never inside URLs (repo links must survive)."""
    import re

    urls: list[str] = []

    def stash(match):
        urls.append(match.group(0))
        return f"\x00URL{len(urls) - 1}\x00"

    protected = re.sub(r"https?://[^\s\"'<>)]+", stash, value)
    renamed = protected.replace("DeepTutor", BRAND)
    for index, url in enumerate(urls):
        renamed = renamed.replace(f"\x00URL{index}\x00", url)
    return renamed


def rename_values(obj, counter):
    if isinstance(obj, str):
        if "DeepTutor" in obj:
            counter[0] += 1
            return _rename_str(obj)
        return obj
    if isinstance(obj, dict):
        return {k: rename_values(v, counter) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rename_values(v, counter) for v in obj]
    return obj


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    changes = 0
    warnings = []

    for path in sorted(ROOT.glob("web/locales/*/app.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        counter = [0]
        out = {k: rename_values(v, counter) for k, v in data.items()}
        if counter[0]:
            changes += counter[0]
            if not args.check:
                path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{path.relative_to(ROOT)}: {counter[0]} values")

    for path in sorted(ROOT.glob("deeptutor/agents/*/prompts/*/*.yaml")):
        text = path.read_text(encoding="utf-8")
        if "DeepTutor" in text:
            changes += text.count("DeepTutor")
            if not args.check:
                path.write_text(text.replace("DeepTutor", BRAND), encoding="utf-8")
            print(f"{path.relative_to(ROOT)}: persona")

    for rel, anchors in TOKEN_FILES:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        if "DeepTutor" in text:
            changes += text.count("DeepTutor")
            if not args.check:
                text = text.replace("DeepTutor", BRAND)
                if anchors:
                    text = text.replace("#deeptutor-", "#kaiwen-crane-tutor-")
                path.write_text(text, encoding="utf-8")
            print(f"{rel}: token rename")

    for rel, old, new in STRUCTURAL:
        path = ROOT / rel
        if not path.is_file():
            warnings.append(f"missing file: {rel}")
            continue
        text = path.read_text(encoding="utf-8")
        if old in text:
            changes += text.count(old)
            if not args.check:
                path.write_text(text.replace(old, new), encoding="utf-8")
            print(f"{rel}: structural edit")
        elif new not in text:
            warnings.append(f"neither form present (upstream refactor?): {rel}: {old[:60]!r}")

    for w in warnings:
        print("WARN:", w)
    print(f"{'would change' if args.check else 'changed'}: {changes}")
    return 1 if args.check and changes else 0


if __name__ == "__main__":
    raise SystemExit(main())
