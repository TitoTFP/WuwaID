import json
import sqlite3
import shutil
from pathlib import Path

def load_translations_from_db(db_path: Path, table_name: str) -> dict[str, str]:
    trans = {}
    if not db_path.is_file():
        return trans
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute(f"SELECT `Id`, `Content` FROM `{table_name}`")
        for row in cur.fetchall():
            if row[0] and row[1] is not None:
                trans[row[0]] = row[1]
    except Exception as e:
        print(f"Error loading {db_path.name}: {e}")
    finally:
        conn.close()
    return trans

def gather_quest_translations(data_dir: Path, quest_ids: list[int] | None = None) -> dict[str, str]:
    quest_trans = {}
    db_path = data_dir / "index.db"
    edits_by_qid_line = {}
    
    # 1. Connect to data/index.db to fetch edits
    if db_path.is_file():
        conn = sqlite3.connect(str(db_path))
        try:
            cur = conn.execute("SELECT qid, line_id, text_id, options_json FROM edits")
            for row in cur.fetchall():
                qid, line_id, text_id, options_json = row
                edits_by_qid_line[(qid, line_id)] = {
                    "text_id": text_id,
                    "options_json": options_json
                }
        except Exception as e:
            print(f"Error reading edits from index.db: {e}")
        finally:
            conn.close()

    # 2. Iterate base quest files
    quests_dir = data_dir / "quests"
    quests_id_dir = data_dir / "quests_id"
    
    if quest_ids is not None:
        quest_files = []
        for qid in quest_ids:
            p = quests_dir / f"{qid}.json"
            if p.is_file():
                quest_files.append(p)
    else:
        quest_files = list(quests_dir.glob("*.json"))

    for p in quest_files:
        try:
            quest_data = json.loads(p.read_text(encoding="utf-8"))
            qid = quest_data.get("quest_id")
            if not qid:
                continue
            
            # Load quests_id if it exists
            id_path = quests_id_dir / f"{qid}.json"
            id_lines = {}      # text_key -> text_id
            id_options = {}    # text_key -> text_id
            if id_path.is_file():
                try:
                    id_data = json.loads(id_path.read_text(encoding="utf-8"))
                    for state in (id_data.get("states") or {}).values():
                        if not isinstance(state, dict):
                            continue
                        for entry in (state.get("lines") or []):
                            if not isinstance(entry, dict):
                                continue
                            tk = entry.get("text_key")
                            tid = entry.get("text_id")
                            if tk and tid:
                                id_lines[tk] = tid
                            for opt in (entry.get("options") or []):
                                opt_tk = opt.get("text_key")
                                opt_tid = opt.get("text_id")
                                if opt_tk and opt_tid:
                                    id_options[opt_tk] = opt_tid
                except Exception as e:
                    print(f"Warning: failed to read quest ID file {id_path.name}: {e}")

            # Iterate over all lines in base quest
            all_lines = quest_data.get("all_lines") or []
            for line in all_lines:
                line_id = line.get("id")
                tk = line.get("text_key")
                
                # Check if we have an edit
                edit = edits_by_qid_line.get((qid, line_id))
                
                # Dialogue line text
                if edit and edit["text_id"] is not None:
                    # Editor edit wins
                    if tk:
                         quest_trans[tk] = edit["text_id"]
                elif tk and tk in id_lines:
                    # Fallback to UI translation
                    quest_trans[tk] = id_lines[tk]

                # Options translations
                options = line.get("options") or []
                edit_options_lookup = {}
                if edit and edit["options_json"]:
                    try:
                        edit_opts = json.loads(edit["options_json"])
                        for eo in edit_opts:
                            eo_tk = eo.get("text_key")
                            eo_tid = eo.get("text_id")
                            if eo_tk and eo_tid:
                                edit_options_lookup[eo_tk] = eo_tid
                    except Exception:
                        pass

                for opt in options:
                    opt_tk = opt.get("text_key")
                    if not opt_tk:
                        continue
                    if opt_tk in edit_options_lookup:
                        quest_trans[opt_tk] = edit_options_lookup[opt_tk]
                    elif opt_tk in id_options:
                        quest_trans[opt_tk] = id_options[opt_tk]
        except Exception as e:
            print(f"Error processing quest {p.name}: {e}")
            
    return quest_trans

def export_indonesian_translations(repo_root: Path) -> None:
    en_db_dir = repo_root / "output_db" / "en"
    id_db_dir = repo_root / "output_db" / "id"
    experiments_dir = repo_root / "experiments"
    data_dir = repo_root / "data"

    if not en_db_dir.is_dir():
        raise FileNotFoundError(f"English template database directory not found at {en_db_dir}")

    # 1. Load official Indonesian translations from experiments/
    print("Loading official Indonesian database templates...")
    official_id = {}
    official_id.update(load_translations_from_db(experiments_dir / "lang_multi_text.db", "MultiText"))
    official_id.update(load_translations_from_db(experiments_dir / "lang_multi_text_1sthalf.db", "MultiText_ID_1sthalf"))
    official_id.update(load_translations_from_db(experiments_dir / "lang_multi_text_2ndhalf.db", "MultiText_ID_2ndhalf"))
    official_id.update(load_translations_from_db(experiments_dir / "lang_multi_text_1sthalf_new.db", "MultiText"))
    print(f"Loaded {len(official_id)} translations from official databases.")

    # 2. Load category translations from Web UI
    print("Loading category translations from data/categories_id...")
    categories_id_dir = data_dir / "categories_id"
    category_trans = {}
    if categories_id_dir.is_dir():
        for p in categories_id_dir.glob("*.json"):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                for k, v in data.items():
                    if isinstance(v, dict) and v.get("id"):
                        category_trans[k] = v["id"]
            except Exception as e:
                print(f"Error reading category {p.name}: {e}")
    print(f"Loaded {len(category_trans)} category translations.")

    # 3. Load quest dialogue translations
    print("Loading quest translations...")
    quest_trans = gather_quest_translations(data_dir)
    print(f"Loaded {len(quest_trans)} quest line/option translations.")

    # Combine all translations (experiments <- categories <- quests)
    translations = {}
    translations.update(official_id)
    translations.update(category_trans)
    translations.update(quest_trans)

    # Filter out empty translations
    translations = {k: v for k, v in translations.items() if v and v.strip()}
    print(f"Total active translations to write: {len(translations)}")

    # 4. Copy English template databases to output_db/id/
    id_db_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(en_db_dir / "lang_multi_text.db", id_db_dir / "lang_multi_text.db")
    shutil.copy2(en_db_dir / "lang_multi_text_1sthalf.db", id_db_dir / "lang_multi_text_1sthalf.db")
    print("Copied English database templates to output_db/id/.")

    # 5. Determine RedirectDbIndex for target keys in the main database
    conn_main = sqlite3.connect(str(id_db_dir / "lang_multi_text.db"))
    cur = conn_main.cursor()
    cur.execute("SELECT Id, RedirectDbIndex FROM MultiText")
    db_keys = {row[0]: row[1] for row in cur.fetchall()}

    updates_main = []
    updates_1st = []
    skipped_redirect_2 = 0
    skipped_not_in_template = 0

    for key, val in translations.items():
        if key in db_keys:
            redirect = db_keys[key]
            if redirect == 0:
                updates_main.append((val, key))
            elif redirect == 1:
                updates_1st.append((val, key))
            elif redirect == 2:
                # RedirectDbIndex == 2: 2ndhalf.db is not in output_db/en, so it is skipped.
                skipped_redirect_2 += 1
        else:
            skipped_not_in_template += 1

    if skipped_redirect_2 > 0:
        print(f"Skipped {skipped_redirect_2} keys because they redirect to 2ndhalf.db (not present in en/).")
    if skipped_not_in_template > 0:
        print(f"Skipped {skipped_not_in_template} keys because they do not exist in the English template.")

    # 6. Apply updates
    if updates_main:
        print(f"Updating {len(updates_main)} keys in lang_multi_text.db...")
        cur.executemany("UPDATE MultiText SET Content = ? WHERE Id = ?", updates_main)
    
    conn_main.commit()
    conn_main.close()

    if updates_1st:
        print(f"Updating {len(updates_1st)} keys in lang_multi_text_1sthalf.db...")
        conn_1st = sqlite3.connect(str(id_db_dir / "lang_multi_text_1sthalf.db"))
        cur_1st = conn_1st.cursor()
        cur_1st.executemany("UPDATE MultiText SET Content = ? WHERE Id = ?", updates_1st)
        conn_1st.commit()
        conn_1st.close()

    print("Export completed successfully!")


def sanitize_filename(name: str) -> str:
    import re
    cleaned = re.sub(r'[^a-zA-Z0-9_\- ]', '', name)
    cleaned = cleaned.replace(' ', '_')
    cleaned = re.sub(r'_+', '_', cleaned)
    return cleaned


def get_quest_keys(quest_data: dict) -> list[str]:
    keys = []
    all_lines = quest_data.get("all_lines") or []
    for line in all_lines:
        tk = line.get("text_key")
        if tk:
            keys.append(tk)
        options = line.get("options") or []
        for opt in options:
            opt_tk = opt.get("text_key")
            if opt_tk:
                keys.append(opt_tk)
    return list(set(keys))


def get_category_keys(data_dir: Path, cat_name: str) -> list[str]:
    cat_path = data_dir / "categories" / f"{cat_name}.json"
    if not cat_path.is_file():
        return []
    try:
        with cat_path.open(encoding="utf-8") as f:
            cat_data = json.load(f)
        return list(cat_data.keys())
    except Exception as e:
        print(f"Error loading category keys for {cat_name}: {e}")
        return []


def fetch_en_metadata(repo_root: Path, keys: list[str]) -> dict[str, tuple[str | None, int | None]]:
    en_db_dir = repo_root / "output_db" / "en"
    metadata = {}
    if not keys:
        return metadata
        
    # Query lang_multi_text.db
    db_main = en_db_dir / "lang_multi_text.db"
    if db_main.is_file():
        conn = sqlite3.connect(str(db_main))
        try:
            for i in range(0, len(keys), 500):
                chunk = keys[i:i+500]
                placeholders = ",".join("?" for _ in chunk)
                cur = conn.execute(
                    f"SELECT Id, Content, RedirectDbIndex FROM MultiText WHERE Id IN ({placeholders})",
                    chunk
                )
                for row in cur.fetchall():
                    metadata[row[0]] = (row[1], row[2])
        except Exception as e:
            print(f"Error querying en lang_multi_text.db: {e}")
        finally:
            conn.close()

    # Query lang_multi_text_1sthalf.db
    db_1st = en_db_dir / "lang_multi_text_1sthalf.db"
    if db_1st.is_file():
        conn = sqlite3.connect(str(db_1st))
        try:
            for i in range(0, len(keys), 500):
                chunk = keys[i:i+500]
                placeholders = ",".join("?" for _ in chunk)
                cur = conn.execute(
                    f"SELECT Id, Content FROM MultiText WHERE Id IN ({placeholders})",
                    chunk
                )
                for row in cur.fetchall():
                    metadata[row[0]] = (row[1], 1)
        except Exception as e:
            print(f"Error querying en lang_multi_text_1sthalf.db: {e}")
        finally:
            conn.close()
            
    return metadata


def create_selective_db(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.is_file():
        db_path.unlink()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("CREATE TABLE `MultiText` (`Id` TEXT UNIQUE PRIMARY KEY NOT NULL, `Content` TEXT, `RedirectDbIndex` INT)")
        conn.commit()
    finally:
        conn.close()


def export_selective_translations(
    repo_root: Path,
    quest_ids: list[int] | None = None,
    category_names: list[str] | None = None,
    only_untranslated: bool = False,
) -> list[str]:
    data_dir = repo_root / "data"
    output_dir = repo_root / "output_db" / "id"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Load active translations
    quest_trans = {}
    if quest_ids:
        quest_trans = gather_quest_translations(data_dir, quest_ids)
        
    category_trans = {}
    if category_names:
        categories_id_dir = data_dir / "categories_id"
        if categories_id_dir.is_dir():
            for cat_name in category_names:
                p = categories_id_dir / f"{cat_name}.json"
                if p.is_file():
                    try:
                        data = json.loads(p.read_text(encoding="utf-8"))
                        for k, v in data.items():
                            if isinstance(v, dict) and v.get("id"):
                                category_trans[k] = v["id"]
                    except Exception as e:
                        print(f"Error reading category {p.name}: {e}")
                        
    translations = {}
    translations.update(category_trans)
    translations.update(quest_trans)
    
    exported_files = []
    
    # 2. Process Quests
    if quest_ids:
        quests_dir = data_dir / "quests"
        for qid in quest_ids:
            p = quests_dir / f"{qid}.json"
            if not p.is_file():
                continue
            try:
                quest_data = json.loads(p.read_text(encoding="utf-8"))
                quest_name = quest_data.get("quest_name") or "Quest"
                
                keys = get_quest_keys(quest_data)
                if not keys:
                    continue
                
                en_metadata = fetch_en_metadata(repo_root, keys)
                
                sanitized_name = sanitize_filename(quest_name)
                db_name = f"{sanitized_name}_{qid}.db"
                db_path = output_dir / db_name
                create_selective_db(db_path)
                
                rows = []
                for key in keys:
                    content = translations.get(key)
                    is_translated = bool(content and content.strip())
                    
                    if only_untranslated:
                        if is_translated:
                            continue
                        else:
                            content = en_metadata.get(key, (None, None))[0]
                    else:
                        if not is_translated:
                            content = en_metadata.get(key, (None, None))[0]
                    
                    redirect_idx = en_metadata.get(key, (None, None))[1]
                    rows.append((key, content, redirect_idx))
                    
                conn = sqlite3.connect(str(db_path))
                try:
                    conn.executemany(
                        "INSERT OR REPLACE INTO MultiText (Id, Content, RedirectDbIndex) VALUES (?, ?, ?)",
                        rows
                    )
                    conn.commit()
                finally:
                    conn.close()
                
                exported_files.append(db_name)
                print(f"Exported quest {qid} to {db_name} with {len(rows)} rows.")
            except Exception as e:
                print(f"Error exporting quest {qid}: {e}")
                
    # 3. Process Categories
    if category_names:
        for cat_name in category_names:
            try:
                keys = get_category_keys(data_dir, cat_name)
                if not keys:
                    continue
                
                en_metadata = fetch_en_metadata(repo_root, keys)
                
                db_name = f"{cat_name}.db"
                db_path = output_dir / db_name
                create_selective_db(db_path)
                
                rows = []
                for key in keys:
                    content = translations.get(key)
                    is_translated = bool(content and content.strip())
                    
                    if only_untranslated:
                        if is_translated:
                            continue
                        else:
                            content = en_metadata.get(key, (None, None))[0]
                    else:
                        if not is_translated:
                            content = en_metadata.get(key, (None, None))[0]
                        
                    redirect_idx = en_metadata.get(key, (None, None))[1]
                    rows.append((key, content, redirect_idx))
                    
                conn = sqlite3.connect(str(db_path))
                try:
                    conn.executemany(
                        "INSERT OR REPLACE INTO MultiText (Id, Content, RedirectDbIndex) VALUES (?, ?, ?)",
                        rows
                    )
                    conn.commit()
                finally:
                    conn.close()
                    
                exported_files.append(db_name)
                print(f"Exported category {cat_name} to {db_name} with {len(rows)} rows.")
            except Exception as e:
                print(f"Error exporting category {cat_name}: {e}")
                
    return exported_files
