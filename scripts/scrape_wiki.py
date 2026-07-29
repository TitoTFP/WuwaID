#!/usr/bin/env python3
"""Script to scrape terms from the Wuthering Waves Wiki and enrich glossary_draft.json.

Queries categories (Resonators, NPCs, Weapons, Monsters, Locations, Factions, Items, Terminology)
from the Fandom Wiki, matches them against local translation dictionaries to retrieve Chinese names,
and merges the new terms into a copy of glossary_draft.json.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Resolve paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
CATEGORIES_DIR = REPO_ROOT / "export_text_grouped" / "categories"
QUESTS_DIR = REPO_ROOT / "export_text_grouped" / "export_quest_ordered"
GLOSSARY_PATH = REPO_ROOT / "data" / "glossary" / "glossary_draft.json"

ADDITIONS_PATH = REPO_ROOT / "data" / "glossary" / "glossary_wiki_additions.json"
MERGED_PATH = REPO_ROOT / "data" / "glossary" / "glossary_draft_merged.json"

WIKI_API_URL = "https://wutheringwaves.fandom.com/api.php"

# Wiki Categories to scrape and their mapped glossary categories
TARGET_CATEGORIES = {
    "Category:Resonators": "Speaker/NPC",
    "Category:NPCs": "Speaker/NPC",
    "Category:Weapons": "Weapon",
    "Category:Echoes": "Monster",
    "Category:Enemies": "Monster",
    "Category:Locations": "Location/Map",
    "Category:Factions": "Core Gameplay Term",
    "Category:Terminology": "Core Gameplay Term",
    "Category:Items": "General Term",
}


def build_local_index() -> dict[str, dict[str, str]]:
    """Index local text files to map English terms to their Chinese translations."""
    print("Building local translation index...")
    local_index = {}

    # 1. Index categories
    if CATEGORIES_DIR.is_dir():
        for file_path in CATEGORIES_DIR.glob("*.json"):
            try:
                with file_path.open(encoding="utf-8") as f:
                    data = json.load(f)
                for key, val in data.items():
                    if isinstance(val, dict):
                        en = val.get("en", "").strip()
                        zh = val.get("zh-Hans", "").strip()
                        if en and zh:
                            # Save with lower case key for matching, keep original values
                            en_lower = en.lower()
                            if en_lower not in local_index:
                                local_index[en_lower] = {
                                    "en": en,
                                    "zh": zh,
                                    "source": file_path.name
                                }
            except Exception as e:
                print(f"Warning: Failed to parse {file_path.name}: {e}")

    # 2. Index dialogue speakers
    if QUESTS_DIR.is_dir():
        for dirpath, _, files in os.walk(QUESTS_DIR):
            if "dialogue.json" in files:
                try:
                    with open(Path(dirpath) / "dialogue.json", encoding="utf-8") as f:
                        quest_data = json.load(f)
                        for line in quest_data.get("all_lines", []):
                            en = line.get("speaker_en", "").strip()
                            zh = line.get("speaker_zh-Hans", "").strip()
                            if en and zh:
                                en_lower = en.lower()
                                if en_lower not in local_index:
                                    local_index[en_lower] = {
                                        "en": en,
                                        "zh": zh,
                                        "source": "dialogue.json"
                                    }
                except Exception as e:
                    pass

    print(f"Local index built with {len(local_index)} unique terms.")
    return local_index


def fetch_category_members(category_name: str) -> list[str]:
    """Fetch all page titles in a wiki category using the MediaWiki API."""
    print(f"Fetching members for {category_name}...")
    members = []
    cmcontinue = None

    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category_name,
            "cmlimit": "500",
            "cmnamespace": "0",  # Main articles only
            "format": "json"
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue

        query_string = urllib.parse.urlencode(params)
        url = f"{WIKI_API_URL}?{query_string}"

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "WuwaID Glossary Scraper/1.0 (nozomi@gemini)"}
        )

        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode("utf-8"))

            if "query" in data and "categorymembers" in data["query"]:
                for item in data["query"]["categorymembers"]:
                    title = item.get("title", "").strip()
                    if title:
                        members.append(title)

            # Check for pagination
            if "continue" in data and "cmcontinue" in data["continue"]:
                cmcontinue = data["continue"]["cmcontinue"]
                # Slight rate limiting delay between page loads
                time.sleep(0.2)
            else:
                break
        except Exception as e:
            print(f"Error fetching {category_name}: {e}")
            break

    print(f"Found {len(members)} pages in {category_name}.")
    return members


def main() -> int:
    print("=================================================================")
    print("           Wuthering Waves Wiki Scraper & Glossary Merger")
    print("=================================================================")

    # Load existing glossary
    existing_glossary = {}
    if GLOSSARY_PATH.is_file():
        try:
            with GLOSSARY_PATH.open(encoding="utf-8") as f:
                existing_glossary = json.load(f)
            print(f"Loaded existing glossary with {len(existing_glossary)} terms.")
        except Exception as e:
            print(f"Error loading {GLOSSARY_PATH}: {e}")
            return 1
    else:
        print(f"Warning: glossary_draft.json not found at {GLOSSARY_PATH}. Starting empty.")

    # Create lowercase lookups for existing glossary to avoid duplicates
    existing_lower = {k.lower(): k for k in existing_glossary.keys()}

    # Build local translation mapping index
    local_index = build_local_index()

    # Scrape all targeted wiki categories
    scraped_terms: dict[str, str] = {}  # term -> mapped category
    for wiki_cat, glossary_cat in TARGET_CATEGORIES.items():
        titles = fetch_category_members(wiki_cat)
        for title in titles:
            # Skip generic wiki hub pages or templates
            if title.lower() in ("resonator", "tacet discord", "npc", "bosses", "item", "location"):
                continue
            # Store first category mapping found or keep it
            if title not in scraped_terms:
                scraped_terms[title] = glossary_cat
        # Sleep to avoid slamming the server
        time.sleep(0.5)

    print(f"Scraped {len(scraped_terms)} unique terms from wiki.")

    # Compare and match terms
    additions = {}
    merged_glossary = dict(existing_glossary)  # copy original

    matched_local_count = 0
    unmatched_count = 0
    updated_zh_count = 0

    for term, category in scraped_terms.items():
        term_lower = term.lower()
        
        # Check if already in glossary
        if term_lower in existing_lower:
            orig_key = existing_lower[term_lower]
            existing_entry = merged_glossary[orig_key]
            
            # Enrichment: If the existing entry doesn't have a Chinese translation, let's see if we can find it now
            if not existing_entry.get("zh") and term_lower in local_index:
                match = local_index[term_lower]
                existing_entry["zh"] = match["zh"]
                updated_zh_count += 1
            continue

        # Try to find Chinese translation and exact casing in local index
        if term_lower in local_index:
            match = local_index[term_lower]
            exact_en = match["en"]
            zh_trans = match["zh"]
            source = match["source"]
            matched_local_count += 1
        else:
            exact_en = term
            zh_trans = ""
            source = "Wiki Only"
            unmatched_count += 1

        # Add entry
        entry = {
            "zh": zh_trans,
            "category": category,
            "indonesian_translation": exact_en  # Default to English
        }
        
        # Save to additions and merged
        additions[exact_en] = entry
        merged_glossary[exact_en] = entry

    # Sort merged glossary alphabetically by English key for clean diffing
    sorted_merged = {k: merged_glossary[k] for k in sorted(merged_glossary.keys())}
    sorted_additions = {k: additions[k] for k in sorted(additions.keys())}

    # Save files
    try:
        with ADDITIONS_PATH.open("w", encoding="utf-8") as f:
            json.dump(sorted_additions, f, ensure_ascii=False, indent=2)
        print(f"Saved {len(sorted_additions)} new additions to: {ADDITIONS_PATH}")
    except Exception as e:
        print(f"Error saving additions file: {e}")

    try:
        with MERGED_PATH.open("w", encoding="utf-8") as f:
            json.dump(sorted_merged, f, ensure_ascii=False, indent=2)
        print(f"Saved merged glossary ({len(sorted_merged)} total terms) to: {MERGED_PATH}")
    except Exception as e:
        print(f"Error saving merged glossary file: {e}")

    print("\nScraping & Mapping Summary:")
    print(f"  - Scraped Wiki Terms: {len(scraped_terms)}")
    print(f"  - New Terms Added: {len(sorted_additions)}")
    print(f"    - Matched locally (Chinese found): {matched_local_count}")
    print(f"    - Unmatched (Wiki-only / placeholders): {unmatched_count}")
    print(f"  - Existing Terms Enriched with Chinese: {updated_zh_count}")
    print(f"  - Merged Glossary Size: {len(sorted_merged)}")
    print("=================================================================")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
