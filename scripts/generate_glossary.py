#!/usr/bin/env python3
"""Script to extract a translation glossary from WuWaID categories and speakers.

Finds core game terms, weapons, monsters, skills, map locations, and speaker names
to create a unified glossary JSON file that can be used for local machine translation.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

# Resolve paths dynamically relative to the script's location
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

CATEGORIES_DIR = REPO_ROOT / "export_text_grouped" / "categories"
QUESTS_DIR = REPO_ROOT / "export_text_grouped" / "export_quest_ordered"
OUTPUT_PATH = REPO_ROOT / "data" / "glossary" / "glossary_draft.json"

glossary = {}


def add_entry(en: str, zh: str, category: str, max_len: int = 50) -> None:
    en = en.strip()
    zh = zh.strip()
    if not en or en == "*" or len(en) < 2:
        return
    # Skip full sentences or long descriptions
    if len(en) > max_len or "\n" in en:
        return
    if en not in glossary:
        glossary[en] = {
            "zh": zh,
            "category": category,
            "indonesian_translation": en  # Default to keeping in English
        }


def main() -> int:
    print("=================================================================")
    print("        Wuthering Waves Indonesian Glossary Generator")
    print("=================================================================")

    if not CATEGORIES_DIR.is_dir():
        print(f"ERROR: Categories directory not found at {CATEGORIES_DIR}")
        return 1

    # 1. Process Speaker Names
    if QUESTS_DIR.is_dir():
        print(f"Scanning speaker names from {QUESTS_DIR}...")
        speakers = set()
        try:
            for dirpath, _, files in os.walk(QUESTS_DIR):
                if "dialogue.json" in files:
                    try:
                        with open(Path(dirpath) / "dialogue.json", encoding="utf-8") as f:
                            quest_data = json.load(f)
                            for line in quest_data.get("all_lines", []):
                                for lang in ("en", "zh-Hans", "ja"):
                                    name = line.get(f"speaker_{lang}", "")
                                    if name:
                                        speakers.add(name)
                                        break
                    except Exception as e:
                        print(f"Warning: Could not parse dialogue file in {dirpath}: {e}")
            
            for name in sorted(speakers):
                # Skip placeholders and special tags
                if name and not name.startswith("{") and not name.startswith("?"):
                    add_entry(name, "", "Speaker/NPC")
        except Exception as e:
            print(f"Warning: Could not extract speakers: {e}")
    else:
        print(f"Warning: Quest directory not found at {QUESTS_DIR}. Skipping speakers.")

    # 2. Process Quest Names / Quest Chapter Names
    # These are proper titles and should stay in English for Indonesian output.
    quest_title_count = 0
    quest_category_path = CATEGORIES_DIR / "Quest.json"
    if quest_category_path.is_file():
        print(f"Scanning quest titles from {quest_category_path}...")
        try:
            with quest_category_path.open(encoding="utf-8") as f:
                data = json.load(f)
            for key, value in data.items():
                if not isinstance(value, dict):
                    continue
                if "_QuestName" in key:
                    en = value.get("en", "")
                    zh = value.get("zh-Hans", "")
                    before = len(glossary)
                    add_entry(en, zh, "Quest Name", max_len=100)
                    if len(glossary) > before:
                        quest_title_count += 1
                elif "_ChapterName" in key:
                    en = value.get("en", "")
                    zh = value.get("zh-Hans", "")
                    before = len(glossary)
                    add_entry(en, zh, "Quest Chapter", max_len=100)
                    if len(glossary) > before:
                        quest_title_count += 1
        except Exception as e:
            print(f"Warning: Could not extract quest titles from Quest.json: {e}")

    if QUESTS_DIR.is_dir():
        print(f"Scanning quest titles from {QUESTS_DIR}...")
        try:
            for dirpath, _, files in os.walk(QUESTS_DIR):
                if "dialogue.json" not in files:
                    continue
                try:
                    with open(Path(dirpath) / "dialogue.json", encoding="utf-8") as f:
                        quest_data = json.load(f)
                    quest_name = quest_data.get("quest_name", "")
                    chapter_name = quest_data.get("chapter_name", "")
                    before = len(glossary)
                    add_entry(quest_name, "", "Quest Name", max_len=100)
                    add_entry(chapter_name, "", "Quest Chapter", max_len=100)
                    quest_title_count += len(glossary) - before
                except Exception as e:
                    print(f"Warning: Could not parse dialogue file in {dirpath}: {e}")
        except Exception as e:
            print(f"Warning: Could not extract quest titles from dialogue exports: {e}")
    print(f"Added {quest_title_count} quest title terms.")

    # 3. Define target files and their key patterns
    targets = [
        {
            "file": "Guide.json",
            "patterns": [re.compile(r'.*GroupName$'), re.compile(r'.*Name$')],
            "category": "Core Gameplay Term"
        },
        {
            "file": "Skill.json",
            "patterns": [re.compile(r'.*TagName$'), re.compile(r'.*Name$'), re.compile(r'.*_Title_Text$')],
            "category": "Skill/Stat"
        },
        {
            "file": "Weapon.json",
            "patterns": [re.compile(r'.*WeaponName$')],
            "category": "Weapon"
        },
        {
            "file": "Monster.json",
            "patterns": [re.compile(r'.*Name$')],
            "category": "Monster"
        },
        {
            "file": "Map.json",
            "patterns": [re.compile(r'.*Title$'), re.compile(r'.*Name$')],
            "category": "Location/Map"
        },
        {
            "file": "others.json",
            "patterns": [re.compile(r'.*Name$')],
            "category": "General Term"
        }
    ]

    print("Extracting terms from categories...")
    for target in targets:
        file_path = CATEGORIES_DIR / target["file"]
        if not file_path.is_file():
            continue
        try:
            with file_path.open(encoding="utf-8") as f:
                data = json.load(f)
            for k, v in data.items():
                if any(p.match(k) for p in target["patterns"]):
                    en = v.get("en", "")
                    zh = v.get("zh-Hans", "")
                    if en:
                        add_entry(en, zh, target["category"])
        except Exception as e:
            print(f"Error processing {target['file']}: {e}")

    # Write output
    try:
        with OUTPUT_PATH.open("w", encoding="utf-8") as f:
            json.dump(glossary, f, ensure_ascii=False, indent=2)
        print(f"Glossary generation complete! Extracted {len(glossary)} terms.")
        print(f"Saved to: {OUTPUT_PATH}")
    except Exception as e:
        print(f"ERROR: Could not save glossary: {e}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
