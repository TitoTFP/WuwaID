import json
from pathlib import Path

def main():
    repo_root = Path(".")
    data_dir = repo_root / "data"
    glossary_path = data_dir / "glossary.json"
    
    if not glossary_path.is_file():
        print(f"Glossary file not found at {glossary_path}")
        return
        
    glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
    
    # Filter glossary to active terms
    glossary_active = {}
    for en, val in glossary.items():
        id_trans = val.get("indonesian_translation", "").strip()
        if id_trans:
            glossary_active[en] = id_trans
            
    print(f"Loaded {len(glossary_active)} active glossary terms.")
    
    # 1. Update Speakers Category
    print("\nProcessing Speakers Category...")
    speaker_base_path = data_dir / "categories" / "Speaker.json"
    speaker_id_path = data_dir / "categories_id" / "Speaker.json"
    
    spk_updated = 0
    if speaker_base_path.is_file() and speaker_id_path.is_file():
        try:
            spk_base = json.loads(speaker_base_path.read_text(encoding="utf-8"))
            spk_id = json.loads(speaker_id_path.read_text(encoding="utf-8"))
            modified = False
            
            for key, val in spk_base.items():
                if not isinstance(val, dict):
                    continue
                en_name = val.get("en", "")
                if en_name in glossary_active:
                    expected_id = glossary_active[en_name]
                    actual_id_data = spk_id.get(key)
                    
                    if isinstance(actual_id_data, dict):
                        actual_id = actual_id_data.get("id", "").strip()
                        if actual_id != expected_id:
                            actual_id_data["id"] = expected_id
                            modified = True
                            spk_updated += 1
                    elif isinstance(actual_id_data, str):
                        if actual_id_data.strip() != expected_id:
                            spk_id[key] = expected_id
                            modified = True
                            spk_updated += 1
                            
            if modified:
                speaker_id_path.write_text(json.dumps(spk_id, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"Updated {spk_updated} speakers in Speaker.json")
        except Exception as e:
            print(f"Error updating Speaker category: {e}")
            
    # 2. Update other Categories
    print("\nProcessing other Categories...")
    categories_dir = data_dir / "categories"
    categories_id_dir = data_dir / "categories_id"
    
    cat_files_updated = 0
    cat_keys_updated = 0
    
    for p in categories_dir.glob("*.json"):
        if p.name == "Speaker.json" or p.name.startswith("_"):
            continue
        id_path = categories_id_dir / p.name
        if not id_path.is_file():
            continue
            
        try:
            cat_base = json.loads(p.read_text(encoding="utf-8"))
            cat_id = json.loads(id_path.read_text(encoding="utf-8"))
            modified = False
            file_keys_updated = 0
            
            for key, val in cat_base.items():
                text_en = ""
                if isinstance(val, dict):
                    text_en = val.get("en", "")
                elif isinstance(val, str):
                    text_en = val
                if not text_en:
                    continue
                    
                if text_en in glossary_active:
                    expected_id = glossary_active[text_en]
                    val_id = cat_id.get(key)
                    
                    if isinstance(val_id, dict):
                        actual_id = val_id.get("id", "").strip()
                        if actual_id != expected_id:
                            val_id["id"] = expected_id
                            modified = True
                            file_keys_updated += 1
                    elif isinstance(val_id, str):
                        if val_id.strip() != expected_id:
                            cat_id[key] = expected_id
                            modified = True
                            file_keys_updated += 1
                            
            if modified:
                id_path.write_text(json.dumps(cat_id, ensure_ascii=False, indent=2), encoding="utf-8")
                cat_files_updated += 1
                cat_keys_updated += file_keys_updated
                print(f"Updated {file_keys_updated} keys in category file {p.name}")
        except Exception as e:
            print(f"Error updating category {p.name}: {e}")
            
    print(f"Total Category Updates: {cat_keys_updated} keys across {cat_files_updated} files.")
    
    # 3. Update Quests
    print("\nProcessing Quests...")
    quests_dir = data_dir / "quests"
    quests_id_dir = data_dir / "quests_id"
    
    quest_files_updated = 0
    quest_lines_updated = 0
    quest_speakers_updated = 0
    quest_options_updated = 0
    
    for p in quests_dir.glob("*.json"):
        id_path = quests_id_dir / p.name
        if not id_path.is_file():
            continue
            
        try:
            q_base = json.loads(p.read_text(encoding="utf-8"))
            q_id = json.loads(id_path.read_text(encoding="utf-8"))
            modified = False
            
            # Map quest_id lines for lookup and modification
            id_lines = {}
            for state in (q_id.get("states") or {}).values():
                for entry in (state.get("lines") or []):
                    lid = entry.get("id")
                    if lid is not None:
                        id_lines[lid] = entry
                        
            all_lines = q_base.get("all_lines") or []
            for line in all_lines:
                lid = line.get("id")
                if lid not in id_lines:
                    continue
                line_id_data = id_lines[lid]
                
                # Check Speaker
                speaker_en = line.get("speaker_en", "")
                speaker_id = line_id_data.get("speaker_id", "").strip()
                if speaker_en in glossary_active:
                    expected_spk_id = glossary_active[speaker_en]
                    if speaker_id != expected_spk_id:
                        line_id_data["speaker_id"] = expected_spk_id
                        modified = True
                        quest_speakers_updated += 1
                        
                # Check Line text
                text_en = line.get("text_en", "")
                text_id = line_id_data.get("text_id", "").strip()
                if text_en in glossary_active:
                    expected_text_id = glossary_active[text_en]
                    if text_id != expected_text_id:
                        line_id_data["text_id"] = expected_text_id
                        modified = True
                        quest_lines_updated += 1
                        
                # Check Options
                options = line.get("options") or []
                id_options = {o.get("text_key"): o for o in line_id_data.get("options", []) if o.get("text_key")}
                for opt in options:
                    opt_tk = opt.get("text_key")
                    opt_text_en = opt.get("text_en", "")
                    
                    if opt_tk in id_options:
                        opt_id_data = id_options[opt_tk]
                        opt_text_id = opt_id_data.get("text_id", "").strip()
                        if opt_text_en in glossary_active:
                            expected_opt_id = glossary_active[opt_text_en]
                            if opt_text_id != expected_opt_id:
                                opt_id_data["text_id"] = expected_opt_id
                                modified = True
                                quest_options_updated += 1
                                
            if modified:
                id_path.write_text(json.dumps(q_id, ensure_ascii=False, indent=2), encoding="utf-8")
                quest_files_updated += 1
                
        except Exception as e:
            print(f"Error updating quest {p.name}: {e}")
            
    print(f"Total Quest Updates: {quest_files_updated} files updated.")
    print(f"  - {quest_speakers_updated} speaker name fields updated.")
    print(f"  - {quest_lines_updated} line dialogue fields updated.")
    print(f"  - {quest_options_updated} option choice fields updated.")
    
    print("\nGlossary exact replacement complete!")

if __name__ == "__main__":
    main()
