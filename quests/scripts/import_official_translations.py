#!/usr/bin/env python3
import json
import os
import sqlite3
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = REPO_ROOT / "experiments"
DATA_DIR = REPO_ROOT / "data"

# Unified dictionary mapping text_key/id -> translation
db_translations = {}

def load_db(path, table_name, id_col="Id", content_col="Content"):
    if not path.is_file():
        print(f"Database not found: {path}")
        return
    con = sqlite3.connect(path)
    cur = con.cursor()
    try:
        cur.execute(f"SELECT `{id_col}`, `{content_col}` FROM `{table_name}`")
        rows = cur.fetchall()
        loaded = 0
        for row in rows:
            if row[0]:
                val = row[1]
                if val is not None:
                    db_translations[row[0]] = val
                    loaded += 1
        print(f"Loaded {loaded} keys from {path.name}")
    except Exception as e:
        print(f"Error loading {path.name}: {e}")
    finally:
        con.close()

def clean_translation(text_key, translation, text_en):
    if not translation:
        return None
    translation = translation.strip()
    if not text_en:
        return translation
    text_en_clean = text_en.strip()
    # Safe heuristic: if translation is exactly identical to the English text
    # and it is a multi-word string, it's likely a fallback.
    if translation == text_en_clean and len(text_en_clean.split()) > 2:
        return None
    return translation

def load_glossary():
    path = DATA_DIR / "glossary.json"
    if path.is_file():
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading glossary: {e}")
    return {}

def resolve_speaker(speaker_en, glossary):
    if not speaker_en:
        return ""
    entry = glossary.get(speaker_en)
    if not entry:
        return speaker_en
    id_form = entry.get("indonesian_translation", "") or ""
    if not id_form or id_form == speaker_en:
        return speaker_en
    return id_form

def find_plot_mode(quest_data, state_key):
    for flow in (quest_data.get("flows") or []):
        for st in (flow.get("states") or []):
            if st.get("state_key") == state_key:
                return st.get("plot_mode", "")
    return ""

def main():
    print("Loading official Indonesian localization databases...")
    load_db(DB_DIR / "lang_multi_text.db", "MultiText")
    load_db(DB_DIR / "lang_multi_text_1sthalf.db", "MultiText_ID_1sthalf")
    load_db(DB_DIR / "lang_multi_text_1sthalf_new.db", "MultiText")
    load_db(DB_DIR / "lang_multi_text_2ndhalf.db", "MultiText_ID_2ndhalf")
    print(f"Total localized keys in memory: {len(db_translations)}")

    glossary = load_glossary()
    print(f"Loaded glossary with {len(glossary)} terms")

    new_memories = []  # list of (text_key, text_id, source_text_en, source_speaker_en, from_quest)

    # 1. Migrate Quests
    quests_dir = DATA_DIR / "quests"
    quests_id_dir = DATA_DIR / "quests_id"
    quests_id_dir.mkdir(parents=True, exist_ok=True)

    quest_files = sorted(list(quests_dir.glob("*.json")))
    print(f"Processing {len(quest_files)} quests...")

    quests_translated_count = 0
    lines_translated_count = 0

    for q_file in quest_files:
        try:
            with q_file.open("r", encoding="utf-8") as f:
                quest_data = json.load(f)
        except Exception as e:
            print(f"Error loading {q_file.name}: {e}")
            continue

        qid = quest_data.get("quest_id")
        if not qid:
            continue

        out_path = quests_id_dir / f"{qid}.json"
        existing_states = {}
        if out_path.is_file():
            try:
                with out_path.open("r", encoding="utf-8") as f:
                    existing_data = json.load(f)
                existing_states = existing_data.get("states", {})
            except Exception:
                pass

        # Group lines in all_lines by state_key
        all_lines = quest_data.get("all_lines", []) or []
        by_state = {}
        for line in all_lines:
            sk = line.get("state_key")
            if sk:
                by_state.setdefault(sk, []).append(line)

        output_states = {}
        quest_has_translations = False

        for sk, state_lines in by_state.items():
            plot_mode = find_plot_mode(quest_data, sk)
            out_lines = []

            # Keep a lookup for existing lines in this state
            existing_lines_lookup = {}
            if sk in existing_states and isinstance(existing_states[sk], dict):
                for el in existing_states[sk].get("lines", []):
                    existing_lines_lookup[el.get("id")] = el

            for line in state_lines:
                lid = line.get("id")
                tk = line.get("text_key", "")
                text_en = line.get("text_en", "")
                speaker_en = line.get("speaker_en", "")

                existing_line = existing_lines_lookup.get(lid, {})

                # Check if we have an official translation for the main line text
                trans = None
                if tk in db_translations:
                    trans = clean_translation(tk, db_translations[tk], text_en)

                if trans is not None:
                    text_id = trans
                    quest_has_translations = True
                    lines_translated_count += 1
                    new_memories.append((tk, text_id, text_en, speaker_en, int(qid)))
                else:
                    text_id = existing_line.get("text_id", "")

                # Resolve speaker
                speaker_id = resolve_speaker(speaker_en, glossary)

                # Process options
                out_options = []
                for opt in (line.get("options") or []):
                    opt_tk = opt.get("text_key", "")
                    opt_text_en = opt.get("text_en", "")

                    # Find existing option translation
                    existing_opt_id = ""
                    for eo in existing_line.get("options", []):
                        if eo.get("text_key") == opt_tk:
                            existing_opt_id = eo.get("text_id", "")
                            break

                    opt_trans = None
                    if opt_tk in db_translations:
                        opt_trans = clean_translation(opt_tk, db_translations[opt_tk], opt_text_en)

                    if opt_trans is not None:
                        opt_text_id = opt_trans
                        quest_has_translations = True
                        new_memories.append((opt_tk, opt_text_id, opt_text_en, "", int(qid)))
                    else:
                        opt_text_id = existing_opt_id

                    out_options.append({
                        "text_key": opt_tk,
                        "text_id": opt_text_id
                    })

                out_line = dict(line)
                out_line["text_id"] = text_id
                out_line["speaker_id"] = speaker_id
                out_line["options"] = out_options
                out_line["from_memory"] = False
                out_line["flags"] = []
                out_line["source_text_en"] = text_en
                out_line["source_speaker_en"] = speaker_en

                out_lines.append(out_line)

            output_states[sk] = {
                "plot_mode": plot_mode,
                "lines": out_lines
            }

        if quest_has_translations or existing_states:
            output_payload = {
                "quest_id": int(qid),
                "quest_name": quest_data.get("quest_name", ""),
                "chapter_id": quest_data.get("chapter_id", 0),
                "chapter_name": quest_data.get("chapter_name", ""),
                "translated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "model": "Official Import",
                "states": output_states
            }
            try:
                with out_path.open("w", encoding="utf-8") as f:
                    json.dump(output_payload, f, ensure_ascii=False, indent=2)
                quests_translated_count += 1
            except Exception as e:
                print(f"Error writing to {out_path.name}: {e}")

    print(f"Quests: created/updated {quests_translated_count} files, imported {lines_translated_count} lines")

    # 2. Migrate Categories
    categories_dir = DATA_DIR / "categories"
    categories_id_dir = DATA_DIR / "categories_id"
    categories_id_dir.mkdir(parents=True, exist_ok=True)

    category_files = sorted(list(categories_dir.glob("*.json")))
    print(f"Processing {len(category_files)} categories...")

    categories_translated_count = 0
    cat_keys_translated_count = 0

    for cat_file in category_files:
        if cat_file.name.startswith("_"):
            continue
        cat_name = cat_file.stem
        try:
            with cat_file.open("r", encoding="utf-8") as f:
                cat_data = json.load(f)
        except Exception as e:
            print(f"Error loading {cat_file.name}: {e}")
            continue

        out_path = categories_id_dir / f"{cat_name}.json"
        existing_keys = {}
        if out_path.is_file():
            try:
                with out_path.open("r", encoding="utf-8") as f:
                    existing_data = json.load(f)
                for k, v in existing_data.items():
                    if isinstance(v, dict) and v.get("id"):
                        existing_keys[k] = v["id"]
            except Exception:
                pass

        output_cat = {}
        cat_has_translations = False

        for k, v in cat_data.items():
            if not isinstance(v, dict):
                continue
            text_en = v.get("en", "")
            
            trans = None
            if k in db_translations:
                trans = clean_translation(k, db_translations[k], text_en)

            if trans is not None:
                text_id = trans
                cat_has_translations = True
                cat_keys_translated_count += 1
                new_memories.append((k, text_id, text_en, "", cat_name))
            else:
                text_id = existing_keys.get(k, "")

            out_v = dict(v)
            out_v["id"] = text_id
            output_cat[k] = out_v

        if cat_has_translations or existing_keys:
            try:
                with out_path.open("w", encoding="utf-8") as f:
                    json.dump(output_cat, f, ensure_ascii=False, indent=2)
                categories_translated_count += 1
            except Exception as e:
                print(f"Error writing to {out_path.name}: {e}")

    print(f"Categories: created/updated {categories_translated_count} files, imported {cat_keys_translated_count} keys")

    # 3. Update Translation Memory
    memory_path = DATA_DIR / "_translation_memory.json"
    memory_data = {
        "version": 1,
        "model": "Official Import",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": {}
    }

    if memory_path.is_file():
        try:
            with memory_path.open("r", encoding="utf-8") as f:
                loaded_mem = json.load(f)
                if isinstance(loaded_mem, dict) and loaded_mem.get("version") == 1:
                    memory_data = loaded_mem
        except Exception as e:
            print(f"Error loading existing translation memory: {e}")

    entries = memory_data.setdefault("entries", {})
    added_mem_count = 0
    for text_key, text_id, source_text_en, source_speaker_en, from_quest in new_memories:
        if text_key not in entries or entries[text_key].get("text_id") != text_id:
            entries[text_key] = {
                "text_id": text_id,
                "source_text_en": source_text_en,
                "source_speaker_en": source_speaker_en,
                "from_quest": from_quest
            }
            added_mem_count += 1

    memory_data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    memory_data["model"] = "Official Import"
    try:
        with memory_path.open("w", encoding="utf-8") as f:
            json.dump(memory_data, f, ensure_ascii=False, indent=2)
        print(f"Translation Memory: Added/updated {added_mem_count} entries. Total size: {len(entries)}")
    except Exception as e:
        print(f"Error saving translation memory: {e}")

if __name__ == "__main__":
    main()
