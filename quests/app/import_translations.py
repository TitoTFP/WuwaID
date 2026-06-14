import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

def load_glossary(repo_root: Path) -> dict:
    path = repo_root / "data" / "glossary.json"
    if path.is_file():
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading glossary: {e}")
    return {}

def resolve_speaker(speaker_en: str, glossary: dict) -> str:
    if not speaker_en:
        return ""
    entry = glossary.get(speaker_en)
    if not entry:
        return speaker_en
    id_form = entry.get("indonesian_translation", "") or ""
    if not id_form or id_form == speaker_en:
        return speaker_en
    return id_form

def find_plot_mode(quest_data: dict, state_key: str) -> str:
    for flow in (quest_data.get("flows") or []):
        for st in (flow.get("states") or []):
            if st.get("state_key") == state_key:
                return st.get("plot_mode", "")
    return ""

def is_untranslated_fallback(translation: str, text_en: str) -> bool:
    if not translation:
        return True
    translation_clean = translation.strip()
    text_en_clean = text_en.strip()
    if translation_clean == text_en_clean and len(text_en_clean.split()) > 2:
        return True
    return False

def import_translations_from_db(repo_root: Path, db_path: Path) -> dict:
    # 1. Load translations from the imported database
    db_translations = {}
    if not db_path.is_file():
        raise FileNotFoundError(f"Database file not found at {db_path}")
    
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute("SELECT `Id`, `Content` FROM `MultiText`")
        for row in cur.fetchall():
            if row[0] and row[1] is not None:
                db_translations[row[0]] = row[1]
    except Exception as e:
        raise ValueError(f"Failed to read from MultiText table: {e}")
    finally:
        conn.close()

    if not db_translations:
        return {
            "success": True,
            "categories_updated": 0,
            "quests_updated": 0,
            "total_keys_imported": 0,
            "skipped_keys": 0,
            "message": "No translations found in the database."
        }

    # 2. Query category keys from index.db
    cat_keys = {} # key -> category_name
    index_db_path = repo_root / "data" / "index.db"
    if index_db_path.is_file():
        conn_idx = sqlite3.connect(str(index_db_path))
        try:
            cur = conn_idx.execute("SELECT key, category FROM category_text_idx")
            for row in cur.fetchall():
                cat_keys[row[0]] = row[1]
        except Exception as e:
            print(f"Warning: failed to query category index: {e}")
        finally:
            conn_idx.close()

    # 3. Scan base quests to map quest keys
    quest_keys = {} # text_key -> qid
    quests_dir = repo_root / "data" / "quests"
    if quests_dir.is_dir():
        for p in quests_dir.glob("*.json"):
            try:
                q_data = json.loads(p.read_text(encoding="utf-8"))
                qid = q_data.get("quest_id")
                if not qid:
                    continue
                for line in q_data.get("all_lines", []):
                    tk = line.get("text_key")
                    if tk:
                        quest_keys[tk] = qid
                    for opt in line.get("options", []):
                        opt_tk = opt.get("text_key")
                        if opt_tk:
                            quest_keys[opt_tk] = qid
            except Exception as e:
                print(f"Warning: failed to map quest {p.name}: {e}")

    # 4. Group updates
    cat_updates = {} # category_name -> {key: content}
    quest_updates = {} # qid -> {key: content}
    skipped_count = 0

    for key, val in db_translations.items():
        if key in cat_keys:
            cat_name = cat_keys[key]
            cat_updates.setdefault(cat_name, {})[key] = val
        elif key in quest_keys:
            qid = quest_keys[key]
            quest_updates.setdefault(qid, {})[key] = val
        else:
            skipped_count += 1

    glossary = load_glossary(repo_root)
    new_memories = [] # list of (text_key, text_id, source_text_en, source_speaker_en, from_quest)

    # 5. Process category updates
    categories_dir = repo_root / "data" / "categories"
    categories_id_dir = repo_root / "data" / "categories_id"
    categories_id_dir.mkdir(parents=True, exist_ok=True)
    
    categories_updated_count = 0
    cat_keys_imported_count = 0

    for cat_name, updates in cat_updates.items():
        cat_file = categories_dir / f"{cat_name}.json"
        if not cat_file.is_file():
            continue
        try:
            cat_base = json.loads(cat_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Error loading base category {cat_name}: {e}")
            continue

        out_path = categories_id_dir / f"{cat_name}.json"
        existing_keys = {}
        if out_path.is_file():
            try:
                existing_data = json.loads(out_path.read_text(encoding="utf-8"))
                for k, v in existing_data.items():
                    if isinstance(v, dict) and v.get("id"):
                        existing_keys[k] = v["id"]
            except Exception:
                pass

        output_cat = {}
        cat_has_new_trans = False

        for k, v in cat_base.items():
            if not isinstance(v, dict):
                continue
            text_en = v.get("en", "")
            
            # Check if updated in this import
            imported_val = updates.get(k)
            if imported_val is not None:
                # Filter out untranslated English fallbacks
                if is_untranslated_fallback(imported_val, text_en):
                    text_id = existing_keys.get(k, "")
                else:
                    text_id = imported_val.strip()
                    cat_has_new_trans = True
                    cat_keys_imported_count += 1
                    new_memories.append((k, text_id, text_en, "", cat_name))
            else:
                text_id = existing_keys.get(k, "")

            out_v = dict(v)
            out_v["id"] = text_id
            output_cat[k] = out_v

        if cat_has_new_trans or existing_keys:
            try:
                out_path.write_text(json.dumps(output_cat, ensure_ascii=False, indent=2), encoding="utf-8")
                categories_updated_count += 1
            except Exception as e:
                print(f"Error writing category translation {cat_name}: {e}")

    # 6. Process quest updates
    quests_id_dir = repo_root / "data" / "quests_id"
    quests_id_dir.mkdir(parents=True, exist_ok=True)
    
    quests_updated_count = 0
    quest_keys_imported_count = 0

    for qid, updates in quest_updates.items():
        quest_file = quests_dir / f"{qid}.json"
        if not quest_file.is_file():
            continue
        try:
            quest_data = json.loads(quest_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Error loading base quest {qid}: {e}")
            continue

        out_path = quests_id_dir / f"{qid}.json"
        existing_states = {}
        if out_path.is_file():
            try:
                existing_data = json.loads(out_path.read_text(encoding="utf-8"))
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
        quest_has_new_trans = False

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

                # Check if we have an imported translation for the main line
                imported_val = updates.get(tk)
                if imported_val is not None:
                    if is_untranslated_fallback(imported_val, text_en):
                        text_id = existing_line.get("text_id", "")
                    else:
                        text_id = imported_val.strip()
                        quest_has_new_trans = True
                        quest_keys_imported_count += 1
                        new_memories.append((tk, text_id, text_en, speaker_en, int(qid)))
                else:
                    text_id = existing_line.get("text_id", "")

                speaker_id = existing_line.get("speaker_id") or resolve_speaker(speaker_en, glossary)

                # Process options
                out_options = []
                for opt in (line.get("options") or []):
                    opt_tk = opt.get("text_key", "")
                    opt_text_en = opt.get("text_en", "")

                    existing_opt_id = ""
                    for eo in existing_line.get("options", []):
                        if eo.get("text_key") == opt_tk:
                            existing_opt_id = eo.get("text_id", "")
                            break

                    opt_imported = updates.get(opt_tk)
                    if opt_imported is not None:
                        if is_untranslated_fallback(opt_imported, opt_text_en):
                            opt_text_id = existing_opt_id
                        else:
                            opt_text_id = opt_imported.strip()
                            quest_has_new_trans = True
                            quest_keys_imported_count += 1
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

        if quest_has_new_trans or existing_states:
            output_payload = {
                "quest_id": int(qid),
                "quest_name": quest_data.get("quest_name", ""),
                "chapter_id": quest_data.get("chapter_id", 0),
                "chapter_name": quest_data.get("chapter_name", ""),
                "translated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "model": "DB Import",
                "states": output_states
            }
            try:
                out_path.write_text(json.dumps(output_payload, ensure_ascii=False, indent=2), encoding="utf-8")
                quests_updated_count += 1
            except Exception as e:
                print(f"Error writing quest ID file {qid}: {e}")

    # 7. Update Translation Memory
    if new_memories:
        memory_path = repo_root / "data" / "_translation_memory.json"
        memory_data = {
            "version": 1,
            "model": "DB Import",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "entries": {}
        }
        if memory_path.is_file():
            try:
                memory_data = json.loads(memory_path.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"Error loading translation memory: {e}")

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
        try:
            memory_path.write_text(json.dumps(memory_data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Added {added_mem_count} entries to translation memory.")
        except Exception as e:
            print(f"Error saving translation memory: {e}")

    # 8. Rebuild index database using subprocess
    print("Rebuilding FTS search index...")
    try:
        subprocess.run([sys.executable, "scripts/build_index.py"], cwd=str(repo_root), check=True)
        print("Search index rebuilt successfully.")
    except Exception as e:
        print(f"Error rebuilding search index: {e}")

    return {
        "success": True,
        "categories_updated": categories_updated_count,
        "quests_updated": quests_updated_count,
        "total_keys_imported": cat_keys_imported_count + quest_keys_imported_count,
        "skipped_keys": skipped_count
    }
